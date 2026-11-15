// Pure game logic. No DOM and no chrome APIs, so node can test it.

export const TIER_SCORE = {
  krillion: 100,
  deepcut: 85,
  rare: 60,
  schooler: 30,
  tooclever: 15,
  plankton: 10,
};

// A candidate with no known result ranks between "rare" and "deep cut".
const UNKNOWN_SCORE = 70;

export function normalize(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

// True when the game would treat the two strings as the same answer.
export function sameAnswer(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const plural = (p, q) => p === q + "s" || p === q + "es";
  return plural(x, y) || plural(y, x);
}

export function includesAnswer(list, answer) {
  return list.some((item) => sameAnswer(item, answer));
}

// Maps the tier label on the page ("ONE IN A KRILLION", "DEEP CUT") to a key.
export function tierKey(label) {
  const t = normalize(label).replace(/ /g, "");
  if (t.includes("krillion")) return "krillion";
  if (t.includes("deepcut")) return "deepcut";
  if (t.includes("tooclever")) return "tooclever";
  if (t.includes("rare")) return "rare";
  if (t.includes("schooler")) return "schooler";
  if (t.includes("plankton")) return "plankton";
  return null;
}

// Parses streamed model text. Each line is "answer | note".
export class LineParser {
  constructor() {
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop();
    return lines.map(parseLine).filter(Boolean);
  }

  flush() {
    const last = parseLine(this.buffer);
    this.buffer = "";
    return last ? [last] : [];
  }
}

export function parseLine(line) {
  let text = String(line).trim();
  if (!text) return null;
  text = text.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "");
  const [rawAnswer, ...rest] = text.split("|");
  const answer = rawAnswer.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  if (!answer || answer.length > 60 || !normalize(answer)) return null;
  return { answer, note: rest.join("|").trim() };
}

// Adds new candidates to a list. Skips answers that the list already has.
export function mergeCands(existing, incoming) {
  const out = existing.slice();
  for (const cand of incoming) {
    if (!out.some((c) => sameAnswer(c.answer, cand.answer))) out.push(cand);
  }
  return out;
}

// Returns the candidates that the player can still use, best first.
// `results` maps a normalized answer to { answer, tier } from earlier plays.
export function pickSuggestions(cands, { used = [], invalid = [], results = {} } = {}) {
  const pool = cands.slice();
  for (const r of Object.values(results)) {
    if (!pool.some((c) => sameAnswer(c.answer, r.answer))) {
      pool.push({ answer: r.answer, note: "" });
    }
  }
  return pool
    .filter((c) => !includesAnswer(used, c.answer) && !includesAnswer(invalid, c.answer))
    .map((c, index) => {
      const known = results[normalize(c.answer)];
      const tier = known?.tier ?? null;
      const score = tier ? TIER_SCORE[tier] ?? UNKNOWN_SCORE : UNKNOWN_SCORE;
      return { ...c, tier, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
