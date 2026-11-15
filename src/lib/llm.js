// Asks a model for rare answers and streams them back one line at a time.
import { LineParser } from "./game.js";

// Claude models that accept the server-side refusal fallback.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-2", "claude-sonnet-5-5"]);
// Claude models that accept `speed: "fast"` on the Claude API.
const FAST_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-2"]);
// Claude models that can answer with no thinking phase, and the setting that does it.
// Thinking delays the first answer, and this task is recall, not reasoning.
const NO_THINKING = {
  "claude-haiku-5-5": { type: "disabled" },
  "claude-sonnet-5-5": { type: "between_tools" },
};

// The reasoning setting of each model: [shortest wait, deep search].
// The deep setting is for the search of the RARE list (`options.deep`).
// A model that is not in a table gets no setting, so the provider default applies.
const OPENAI_EFFORT = {
  "gpt-6-luna": ["none", "high"],
  "gpt-6.1-sol": ["low", "high"],
  "gpt-6-astra": ["low", "high"],
};
const GEMINI_THINKING = {
  "gemini-3.8-flash": ["low", "high"],
  "gemini-3.5-flash-lite": ["minimal", "high"],
  "gemini-3.1-flash-lite": ["minimal", "high"],
  "gemini-3.1-pro-preview": ["low", "high"],
};

export class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The RARE list: the most obscure answers that are still real.
export const SYSTEM = `You find the most obscure correct answers for Krillion, a word game.

The game shows a category prompt, for example "Name a noodle dish". The player types one answer. The game scores the answer by how seldom people read or write it. The top tiers, "Deep Cut" and "One in a Krillion", go only to answers that almost nobody knows. A well-known answer scores almost nothing, and so does the famous "obscure" trivia answer that every quiz player gives.

The answer set comes from specialist reference sources: full Wikipedia lists and categories, unabridged dictionaries, field guides, gazetteers, catalogues, and encyclopedias. It goes very deep. An answer must be a real member of the category that such a source documents under the name you give. An invented answer scores nothing.

Your target is the bottom of those long reference lists: the entries that only a specialist in the field knows. Before you write, think of where such entries are:
- a narrow sub-field, a small region, a minority language, or an early or forgotten period;
- the technical, archaic, dialect, or regional term, not the everyday word;
- the minor member of a group (a small species, a village, a short-lived maker, a lesser work, a secondary figure) that has its own article or dictionary entry.

Test each answer before you write it: would a well-read person who is not a specialist in this field know it? If yes, it is too common. Discard it and go deeper. Do not give an answer because it feels clever. Give it because it is truly seldom written.

Rules:
1. Each answer is real and satisfies every condition in the prompt, exclusions included.
2. Each answer is a specific named thing with an established name. Do not make a rare answer by adding adjectives to a common one.
3. If you are not sure that an item exists, omit it. Obscure and real is the goal. Obscure and invented is worthless.

Output format: one answer on each line, rarest first, in the form
answer | reason in six words or fewer
Use the standard reference name. Do not add numbers, bullets, headings, or other text.`;

// The FAST list: any correct answer, as soon as possible.
export const FAST_SYSTEM = `You help a player of Krillion, a word game.

The game shows a category prompt, for example "Name a noodle dish". The player types one answer. The game accepts the answer only if it is on a list that the author compiled from dictionaries, Wikipedia lists, and encyclopedias.

The player needs many correct answers as fast as possible. Rarity does not matter. List answers that are certainly real, that certainly satisfy every condition in the prompt (exclusions included), and that every reference source lists. Prefer short answers that are quick to type. Do not invent anything.

Output format: one answer on each line, in the form
answer | reason in four words or fewer
Use the most standard name. Start with the first answer immediately. Do not add numbers, bullets, headings, or other text.`;

// The category check. A second look removes answers that do not fit the prompt.
export const VERIFY_SYSTEM = `You check answers for Krillion, a category word game.

For each answer, decide if it is a real, documented thing that satisfies every condition in the prompt, exclusions included.
- ok: you know that it is real and that it fits.
- no: it is invented, it belongs to a different category, or it satisfies only part of the prompt.
- unsure: you cannot tell. Many answers are obscure on purpose. Do not reject an answer only because it is obscure.

Output one line for each answer, in the same order, in the form
answer | ok
or
answer | no
or
answer | unsure
Copy each answer exactly. Do not add other text.`;

export function buildUserMessage({ prompt, mode, play, count, avoid = [], known = [], common = [] }) {
  const parts = [`Prompt: ${JSON.stringify(prompt)}`, `Give ${count} answers.`];
  if (play === "fast") {
    parts.push(
      mode === "party"
        ? "This is a multiplayer round, and no player can repeat an answer. Give varied answers, so that some remain when other players take the obvious ones."
        : "The player has a few seconds. Put the most certain answers first, then give varied answers.",
    );
  } else {
    parts.push(
      "Take the time that you need. Rarity is the only goal: each answer must be one that almost nobody would think of." +
        (mode === "party" ? " This is a multiplayer round, and no player can repeat an answer." : ""),
    );
    if (common.length) {
      parts.push(
        "A different list already has these common answers. Do not give them. " +
          `Every answer that you give must be far more obscure than all of them: ${common.join("; ")}`,
      );
    }
  }
  if (avoid.length) parts.push(`Do not use these answers: ${avoid.join("; ")}`);
  if (known.length) {
    parts.push(
      "Results from earlier plays of this prompt (answer -> tier). The tiers from lowest to highest are " +
        "plankton, tooclever, schooler, rare, deepcut, krillion. An answer below deepcut shows what is too common:\n" +
        known.map((k) => `${k.answer} -> ${k.tier}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}

// The Claude API request.
const systemOf = (options) => options.system ?? (options.play === "fast" ? FAST_SYSTEM : SYSTEM);
const userOf = (options) => options.user ?? buildUserMessage(options);

export function buildRequest(options) {
  const { model, fast, deep } = options;
  const params = {
    model,
    max_tokens: 8000,
    system: systemOf(options),
    messages: [{ role: "user", content: userOf(options) }],
    // Low effort keeps the wait short. The search of the RARE list uses high effort:
    // that list puts rarity before speed.
    output_config: { effort: deep ? "high" : "low" },
  };
  if (!deep && NO_THINKING[model]) params.thinking = NO_THINKING[model];
  if (fast && FAST_MODELS.has(model)) params.speed = "fast";
  const useFallback = FALLBACK_MODELS.has(model);
  if (useFallback) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return { params, useFallback };
}

// The OpenAI Chat Completions request. `tuned: false` omits the reasoning setting.
export function buildOpenAIRequest(options, tuned = true) {
  const body = {
    model: options.model,
    stream: true,
    messages: [
      { role: "system", content: systemOf(options) },
      { role: "user", content: userOf(options) },
    ],
  };
  const effort = OPENAI_EFFORT[options.model]?.[options.deep ? 1 : 0];
  if (tuned && effort) body.reasoning_effort = effort;
  return body;
}

// The Gemini generateContent request. `tuned: false` omits the thinking setting.
export function buildGeminiRequest(options, tuned = true) {
  const body = {
    systemInstruction: { parts: [{ text: systemOf(options) }] },
    contents: [{ role: "user", parts: [{ text: userOf(options) }] }],
  };
  const level = GEMINI_THINKING[options.model]?.[options.deep ? 1 : 0];
  if (tuned && level) body.generationConfig = { thinkingConfig: { thinkingLevel: level } };
  return body;
}

// Yields the JSON payload of each server-sent event in a fetch response.
async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // A partial or non-JSON line. Ignore it.
      }
    }
    if (done) return;
  }
}

async function errorMessage(response) {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text).error?.message || text;
  } catch {
    return text || response.statusText;
  }
}

// Sends the request. If the provider rejects the tuned request (HTTP 400),
// sends it one more time with no reasoning setting.
async function postStream(send) {
  let response = await send(true);
  if (response.status === 400) {
    const first = await errorMessage(response);
    if (/api key/i.test(first)) throw new ProviderError(401, first);
    response = await send(false);
  }
  if (!response.ok) throw new ProviderError(response.status, await errorMessage(response));
  return response;
}

async function streamOpenAI(options, onText) {
  const response = await postStream((tuned) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify(buildOpenAIRequest(options, tuned)),
    }),
  );
  for await (const event of sseEvents(response)) {
    const text = event.choices?.[0]?.delta?.content;
    if (text) onText(text);
  }
}

async function streamGemini(options, onText) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    `${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse`;
  const response = await postStream((tuned) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify(buildGeminiRequest(options, tuned)),
    }),
  );
  for await (const event of sseEvents(response)) {
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (part.text && !part.thought) onText(part.text);
    }
  }
}

// `options.client` is the Anthropic SDK client. The caller makes it, so this
// file does not import the SDK.
async function streamClaude(options, onText) {
  const { params, useFallback } = buildRequest(options);
  const stream = useFallback
    ? options.client.beta.messages.stream(params)
    : options.client.messages.stream(params);
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onText(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("The model declined this prompt.");
}

const STREAMERS = { anthropic: streamClaude, openai: streamOpenAI, gemini: streamGemini };

// Calls onCand({ answer, note }) for each answer as soon as its line is complete.
// options: { provider, apiKey, client, model, fast, deep, prompt, mode, play, count, avoid, known }
export async function streamCandidates(options, onCand) {
  const parser = new LineParser();
  await STREAMERS[options.provider](options, (text) => {
    for (const cand of parser.push(text)) onCand(cand);
  });
  for (const cand of parser.flush()) onCand(cand);
}

// Checks that each answer fits the prompt. Calls onVerdict(answer, ok) for each
// answer that the model judges. `ok` is true or false.
export async function verifyAnswers(options, answers, onVerdict) {
  const request = {
    ...options,
    deep: false,
    system: VERIFY_SYSTEM,
    user: `Prompt: ${JSON.stringify(options.prompt)}\n\nAnswers:\n${answers.join("\n")}`,
  };
  await streamCandidates(request, ({ answer, note }) => {
    if (/^ok\b/i.test(note)) onVerdict(answer, true);
    else if (/^no\b/i.test(note)) onVerdict(answer, false);
  });
}
