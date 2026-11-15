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
// Three kinds of candidate, best first:
// - RARE list, from the selected model (no flag);
// - RARE list, from the fastest model while the selected model works (`w: true`);
// - FAST list (`q: true`).
// A candidate that passed the category check (`v: true`) ranks above one of
// the same kind that did not yet.
const UNKNOWN_SCORE = 70;
const WEAK_SCORE = 66;
const QUICK_SCORE = 62;
const VERIFIED_BONUS = 2;
const grade = (c) => (c.q ? 0 : c.w ? 2 : 4) + (c.v ? 1 : 0);

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

// Optimal string alignment distance (insert, delete, replace, swap). Stops at `max + 1`.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      row[j] = d;
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

const stem = (t) => (/(s|x|z|ch|sh)es$/.test(t) ? t.slice(0, -2) : t.replace(/s$/, ""));
// The numbers in an answer ("Apollo 11", "Henry VIII"). Different numbers are different answers.
const numbers = (s) => s.split(" ").filter((t) => /^(\d+|[ivxlc]+)$/.test(t)).join(" ");

// True when the game probably treats the two strings as the same answer.
// The game corrects a near spelling to the answer on its list, so the text
// that a player typed can differ from the text that the page shows:
// "omlette" and "omelette", "corn bread" and "cornbread", "poached" and "poached eggs".
export function closeAnswer(a, b) {
  if (sameAnswer(a, b)) return true;
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y || numbers(x) !== numbers(y)) return false;
  const xs = x.replace(/ /g, "");
  const ys = y.replace(/ /g, "");
  if (xs === ys) return true;
  const shortest = Math.min(xs.length, ys.length);
  const max = shortest >= 8 ? 2 : shortest >= 5 ? 1 : 0;
  if (max && editDistance(xs, ys, max) <= max) return true;
  const tx = x.split(" ").map(stem);
  const ty = y.split(" ").map(stem);
  const [few, many] = tx.length <= ty.length ? [tx, ty] : [ty, tx];
  return few.length < many.length && few.join("").length >= 5 && few.every((t) => many.includes(t));
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
// A better copy of an answer (selected model, or checked) replaces the copy in the list.
export function mergeCands(existing, incoming) {
  const out = existing.slice();
  for (const cand of incoming) {
    const i = out.findIndex((c) => sameAnswer(c.answer, cand.answer));
    if (i < 0) out.push(cand);
    else if (grade(cand) > grade(out[i])) out[i] = cand;
  }
  return out;
}

// Returns the candidates that the player can still use, best first.
// `results` maps a normalized answer to { answer, tier } from earlier plays.
// `used` answers also remove near spellings, because the game corrects those.
export function pickSuggestions(cands, { used = [], invalid = [], results = {} } = {}) {
  const all = Object.values(results);
  const resultFor = (answer) =>
    results[normalize(answer)] ?? all.find((r) => closeAnswer(r.answer, answer)) ?? null;
  const pool = cands.slice();
  for (const r of all) {
    if (!pool.some((c) => resultFor(c.answer)?.answer === r.answer)) {
      pool.push({ answer: r.answer, note: "" });
    }
  }
  return pool
    .filter((c) => !used.some((u) => closeAnswer(u, c.answer)) && !includesAnswer(invalid, c.answer))
    .map((c, index) => {
      const tier = resultFor(c.answer)?.tier ?? null;
      const base = c.q ? QUICK_SCORE : c.w ? WEAK_SCORE : UNKNOWN_SCORE;
      const unknown = base + (c.v ? VERIFIED_BONUS : 0);
      const score = tier ? TIER_SCORE[tier] ?? unknown : unknown;
      return { ...c, tier, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
