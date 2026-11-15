// Service worker. Holds the API key, calls Claude, and stores results.
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, streamCandidates } from "./lib/llm.js";
import { includesAnswer, mergeCands, normalize, sameAnswer } from "./lib/game.js";

const recKey = (prompt) => `p:${normalize(prompt)}`;
const emptyRec = (prompt) => ({ prompt, cands: [], results: {}, invalid: [] });

async function getSettings() {
  const s = await chrome.storage.local.get(["apiKey", "model", "fast"]);
  return { apiKey: s.apiKey ?? "", model: s.model ?? DEFAULT_MODEL, fast: !!s.fast };
}

async function loadRec(prompt) {
  const key = recKey(prompt);
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? emptyRec(prompt);
}

// Runs one read-modify-write at a time for each prompt record.
const locks = new Map();
function updateRec(prompt, change) {
  const key = recKey(prompt);
  const run = (locks.get(key) ?? Promise.resolve()).then(async () => {
    const rec = await loadRec(prompt);
    change(rec);
    await chrome.storage.local.set({ [key]: rec });
    return rec;
  });
  locks.set(key, run.catch(() => {}));
  return run;
}

function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return { code: "auth", message: "The API key is not valid." };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { code: "auth", message: "The API key cannot use this model." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { code: "rate", message: "Rate limit. Try again in a moment." };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { code: "network", message: "Cannot connect to the Claude API." };
  }
  if (error instanceof Anthropic.APIError) {
    return { code: "api", message: `API error ${error.status}: ${error.message}` };
  }
  return { code: "error", message: String(error?.message ?? error) };
}

// One generation job for each prompt. More than one port can listen to a job.
const jobs = new Map();

function startJob(prompt, mode, count, avoid, rec) {
  const key = recKey(prompt);
  const job = { ports: new Set(), items: [] };
  jobs.set(key, job);
  const send = (msg) => {
    for (const port of job.ports) {
      try {
        port.postMessage(msg);
      } catch {
        job.ports.delete(port);
      }
    }
  };
  const taken = [...rec.cands.map((c) => c.answer), ...avoid, ...rec.invalid];
  const known = Object.values(rec.results);

  job.done = (async () => {
    try {
      const { apiKey, model, fast } = await getSettings();
      if (!apiKey) {
        send({ type: "error", code: "nokey", message: "Add your Claude API key." });
        return;
      }
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      await streamCandidates(
        client,
        { model, fast, prompt, mode, count, avoid: taken, known },
        (cand) => {
          if (includesAnswer(taken, cand.answer)) return;
          if (job.items.some((c) => sameAnswer(c.answer, cand.answer))) return;
          job.items.push(cand);
          send({ type: "cands", items: [cand] });
        },
      );
    } catch (error) {
      send({ type: "error", ...describeError(error) });
    } finally {
      if (job.items.length) {
        await updateRec(prompt, (r) => {
          r.cands = mergeCands(r.cands, job.items);
        });
      }
      jobs.delete(key);
      send({ type: "done" });
    }
  })();
  return job;
}

async function handleSuggest(port, { prompt, mode, want, avoid = [] }) {
  const rec = await loadRec(prompt);
  port.postMessage({
    type: "state",
    cands: rec.cands,
    results: rec.results,
    invalid: rec.invalid,
  });
  let job = jobs.get(recKey(prompt));
  if (job) {
    if (job.items.length) port.postMessage({ type: "cands", items: job.items });
    job.ports.add(port);
    return;
  }
  const blocked = [...avoid, ...rec.invalid];
  const unused = rec.cands.filter((c) => !includesAnswer(blocked, c.answer));
  if (unused.length >= want) {
    port.postMessage({ type: "done" });
    return;
  }
  job = startJob(prompt, mode, want, avoid, rec);
  job.ports.add(port);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "suggest") return;
  port.onMessage.addListener((msg) => {
    if (msg.type === "suggest") {
      handleSuggest(port, msg).catch((error) => {
        port.postMessage({ type: "error", ...describeError(error) });
        port.postMessage({ type: "done" });
      });
    }
  });
  port.onDisconnect.addListener(() => {
    for (const job of jobs.values()) job.ports.delete(port);
  });
});

// Prepares answers for a list of prompts before the clock starts.
async function prewarm(prompts) {
  const { apiKey } = await getSettings();
  if (!apiKey) return;
  for (const prompt of prompts) {
    const rec = await loadRec(prompt);
    if (rec.cands.length >= 8 || jobs.has(recKey(prompt))) continue;
    await startJob(prompt, "solo", 12, [], rec).done;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "result") {
    updateRec(msg.prompt, (r) => {
      r.results[normalize(msg.answer)] = { answer: msg.answer, tier: msg.tier };
    });
  } else if (msg.type === "invalid") {
    updateRec(msg.prompt, (r) => {
      if (!includesAnswer(r.invalid, msg.answer)) r.invalid.push(msg.answer);
    });
  } else if (msg.type === "prewarm") {
    prewarm(msg.prompts);
  } else if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});
