// Asks Claude for rare answers and streams them back one line at a time.
import { LineParser } from "./game.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (default)" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2 (most capable, slower)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest)" },
];

// Models that accept the server-side refusal fallback.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-2", "claude-sonnet-5-5"]);
// Models that accept `speed: "fast"` on the Claude API.
const FAST_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-2"]);

const SYSTEM = `You help a player of Krillion, a word game.

The game shows a category prompt, for example "Name a noodle dish". The player types one answer. The game checks the answer against a curated answer set, then scores it by rarity. An answer that people seldom read or write scores high. A common answer scores low.

How the game validates answers: the author compiles each answer set from dictionaries, Wikipedia lists, encyclopedias, and similar reference sources. The game rejects an answer that no such source lists, and a rejected answer scores nothing. The spelling must be close to a standard name or a known alias.

The tiers, from lowest to highest: Plankton (the obvious answer), Too Clever (the pick that everyone believes is obscure), Schooler, Rare, Deep Cut, One in a Krillion.

List answers that meet all three conditions:
1. The answer is real and satisfies every condition in the prompt, exclusions included.
2. Reference sources document the answer under the name that you give.
3. The answer is as obscure as conditions 1 and 2 permit.

Aim for the deep cut of a specialist: a regional variety, a minor historical figure who has a Wikipedia article, a little-known species with an established common name, a small place, a forgotten work. Avoid the famous "trivia" answer. Do not invent anything. If you are not sure that an item exists and fits the prompt, omit it.

Output format: one answer on each line, best first, in the form
answer | reason in six words or fewer
Use the most standard name. Do not add numbers, bullets, headings, or other text.`;

export function buildUserMessage({ prompt, mode, count, avoid = [], known = [] }) {
  const parts = [`Prompt: ${JSON.stringify(prompt)}`, `Give ${count} answers.`];
  if (mode === "party") {
    parts.push(
      "This is a multiplayer round with a short timer, and no player can repeat an answer. " +
        "Each answer must be safe to accept and quick to type (20 characters or fewer when possible). " +
        "Put the rarest answers first.",
    );
  } else {
    parts.push(
      "The player has about 25 seconds and wants the highest tier. " +
        "Order the answers by expected score: weigh obscurity against the risk of rejection.",
    );
  }
  if (avoid.length) parts.push(`Do not use these answers: ${avoid.join("; ")}`);
  if (known.length) {
    parts.push(
      "Results from earlier plays of this prompt (answer -> tier). Use them to calibrate:\n" +
        known.map((k) => `${k.answer} -> ${k.tier}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}

export function buildRequest({ model, fast, prompt, mode, count, avoid, known }) {
  const params = {
    model,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage({ prompt, mode, count, avoid, known }) }],
    // Low effort keeps the wait short. The game clock is the limit here.
    output_config: { effort: "low" },
  };
  if (fast && FAST_MODELS.has(model)) params.speed = "fast";
  const useFallback = FALLBACK_MODELS.has(model);
  if (useFallback) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return { params, useFallback };
}

// Calls onCand({ answer, note }) for each answer as soon as its line is complete.
export async function streamCandidates(client, options, onCand) {
  const { params, useFallback } = buildRequest(options);
  const stream = useFallback
    ? client.beta.messages.stream(params)
    : client.messages.stream(params);
  const parser = new LineParser();
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      for (const cand of parser.push(event.delta.text)) onCand(cand);
    }
  }
  for (const cand of parser.flush()) onCand(cand);
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new Error("The model declined this prompt.");
  }
}
