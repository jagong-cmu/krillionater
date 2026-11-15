// Service worker. Holds the API key, calls Claude, and stores results.
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, streamCandidates, verifyAnswers } from "./lib/llm.js";
import { SETTING_KEYS, resolveSettings } from "./lib/providers.js";
import { includesAnswer, mergeCands, normalize, sameAnswer } from "./lib/game.js";

// "p3" starts the stored lists again: the RARE search changed.
const recKey = (prompt) => `p4:${normalize(prompt)}`;
const emptyRec = (prompt) => ({ prompt, cands: [], results: {}, invalid: [] });

async function getSettings() {
  return resolveSettings(await chrome.storage.local.get(SETTING_KEYS));
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
  if (error instanceof ProviderError) {
    const { status } = error;
    if (status === 401 || status === 403) {
      return { code: "auth", message: "The API key is not valid for this model." };
    }
    if (status === 429) return { code: "rate", message: "Rate limit or no credit. Try again in a moment." };
    return { code: "api", message: `API error ${status}: ${error.message}`.slice(0, 200) };
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return { code: "network", message: "Cannot connect to the API." };
  }
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

// The largest FAST list for one request. A short list arrives sooner.
const FAST_MAX = 30;
// The number of RARE answers that the fastest model gives while the selected model works.
const WEAK_COUNT = 6;
// The longest wait of the RARE search for the FAST list, in milliseconds.
const COMMON_WAIT_MS = 800;
// Splits the stored candidates. `q` marks the FAST list. `w` marks a RARE
// answer from the fastest model. `rare` holds the answers of the selected model.
const split = (cands) => ({
  fast: cands.filter((c) => c.q),
  rare: cands.filter((c) => !c.q && !c.w),
});

// Makes the two lists for a prompt at the same time:
// - FAST: the fastest model gives any correct answers at once.
// - RARE: the selected model searches for the rarest answers. The fastest
//   model does the same search also, so the list has answers in a few seconds.
//   The answers of the selected model go above them.
// `want` is { rare, fast }: the number of answers for each list. 0 skips the list.
function startJob(prompt, mode, want, avoid, rec, settings) {
  const { provider, info, apiKey, model, fast } = settings;
  const key = recKey(prompt);
  const job = { ports: new Set(), items: [], bad: [] };
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
  const rareHave = split(rec.cands).rare.map((c) => c.answer);
  const fastHave = split(rec.cands).fast.map((c) => c.answer);
  const blocked = [...avoid, ...rec.invalid];
  const known = Object.values(rec.results);

  // An answer goes in one list only. The RARE list does not take an answer
  // that the FAST list has: that answer is common. An answer of the selected
  // model replaces the same answer of the fastest model.
  // kind: "q" (FAST list), "w" (RARE, fastest model), "" (RARE, selected model).
  const accept = (cand, kind) => {
    if (includesAnswer(blocked, cand.answer) || includesAnswer(job.bad, cand.answer)) return;
    const item = kind ? { ...cand, [kind]: true } : cand;
    const replaces = (c) => !kind && c.w && sameAnswer(c.answer, cand.answer);
    const i = job.items.findIndex((c) => sameAnswer(c.answer, cand.answer));
    if (i >= 0) {
      if (!replaces(job.items[i])) return;
      job.items[i] = item;
    } else {
      const stored = rec.cands.find((c) => sameAnswer(c.answer, cand.answer));
      if (stored && !replaces(stored)) return;
      job.items.push(item);
    }
    send({ type: "cands", items: [item] });
  };
  const kindOf = (c) => (c.q ? "q" : c.w ? "w" : "");

  job.done = (async () => {
    try {
      if (!apiKey) {
        send({ type: "error", code: "nokey", message: `Add your ${info.name} API key.` });
        return;
      }
      const client =
        provider === "anthropic" ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) : null;
      const base = { provider, apiKey, client, prompt, mode, known };

      // Checks that the answers of one list fit the prompt. A wrong answer
      // leaves the list. A failure of the check leaves the answers as they are.
      const check = async (checker, kind) => {
        const pending = job.items.filter((c) => kindOf(c) === kind && !c.v).map((c) => c.answer);
        if (!pending.length) return;
        await verifyAnswers({ ...base, model: checker }, pending, (answer, ok) => {
          const i = job.items.findIndex((c) => sameAnswer(c.answer, answer));
          if (i < 0 || kindOf(job.items[i]) !== kind) return;
          if (ok) {
            job.items[i] = { ...job.items[i], v: true };
            send({ type: "cands", items: [job.items[i]] });
          } else {
            const [bad] = job.items.splice(i, 1);
            job.bad.push(bad.answer);
            send({ type: "bad", answers: [bad.answer] });
          }
        }).catch(() => {});
      };

      const stages = [];
      let fastStream = Promise.resolve();
      if (want.fast > 0) {
        const options = {
          ...base,
          play: "fast",
          model: info.quickModel,
          count: Math.min(want.fast, FAST_MAX),
          avoid: [...rec.cands.map((c) => c.answer), ...blocked],
        };
        fastStream = streamCandidates(options, (cand) => accept(cand, "q"));
        stages.push(fastStream.then(() => check(info.quickModel, "q")));
      }
      if (want.rare > 0) {
        // The RARE search waits a short time for the FAST list. It gets the
        // answers that are there as the level that its answers must be far below.
        await Promise.race([
          fastStream.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, COMMON_WAIT_MS)),
        ]);
        const common = [...fastHave, ...job.items.filter((c) => c.q).map((c) => c.answer)];
        const rare = { ...base, common, avoid: [...rareHave, ...blocked] };
        stages.push(
          streamCandidates({ ...rare, model, fast, count: want.rare }, (cand) => accept(cand, ""))
            .then(() => check(model, "")),
        );
        if (info.quickModel !== model) {
          stages.push(
            streamCandidates(
              { ...rare, model: info.quickModel, count: Math.min(want.rare, WEAK_COUNT) },
              (cand) => accept(cand, "w"),
            )
              .then(() => check(info.quickModel, "w"))
              .catch(() => {}),
          );
        }
      }
      const failed = (await Promise.allSettled(stages)).find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
    } catch (error) {
      send({ type: "error", ...describeError(error) });
    } finally {
      if (job.items.length || job.bad.length) {
        await updateRec(prompt, (r) => {
          r.cands = mergeCands(r.cands, job.items);
          for (const answer of job.bad) {
            if (!includesAnswer(r.invalid, answer)) r.invalid.push(answer);
          }
        });
      }
      jobs.delete(key);
      send({ type: "done" });
    }
  })();
  return job;
}

// Returns the lists that do not have sufficient stored answers.
function missing(rec, want, blocked = []) {
  const have = split(rec.cands.filter((c) => !includesAnswer(blocked, c.answer)));
  return {
    rare: have.rare.length < want.rare ? want.rare : 0,
    fast: have.fast.length < Math.min(want.fast, FAST_MAX) ? want.fast : 0,
  };
}

async function handleSuggest(port, { prompt, mode, want, avoid = [] }) {
  const [rec, settings] = await Promise.all([loadRec(prompt), getSettings()]);
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
  const need = missing(rec, want, [...avoid, ...rec.invalid]);
  if (!need.rare && !need.fast) {
    port.postMessage({ type: "done" });
    return;
  }
  job = startJob(prompt, mode, need, avoid, rec, settings);
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
// Three prompts run at the same time, in the order of the list.
async function prewarm(prompts) {
  const settings = await getSettings();
  if (!settings.apiKey) return;
  const queue = prompts.slice();
  const worker = async () => {
    for (let prompt = queue.shift(); prompt; prompt = queue.shift()) {
      if (jobs.has(recKey(prompt))) continue;
      const rec = await loadRec(prompt);
      const need = missing(rec, { rare: 6, fast: 5 }, rec.invalid);
      if (!need.rare && !need.fast) continue;
      const want = { rare: need.rare && 8, fast: need.fast && 10 };
      await startJob(prompt, "solo", want, [], rec, settings).done;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
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
