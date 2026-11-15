import test from "node:test";
import assert from "node:assert/strict";
import {
  LineParser, mergeCands, normalize, parseLine, pickSuggestions, sameAnswer, tierKey,
} from "../src/lib/game.js";
import { buildRequest } from "../src/lib/llm.js";
import { rejectedAnswer } from "../src/lib/dom.js";

test("normalize removes case, accents, punctuation, and a leading article", () => {
  assert.equal(normalize("  The Phở-Bò! "), "pho bo");
  assert.equal(normalize("Mac & Cheese"), "mac and cheese");
});

test("sameAnswer accepts simple plurals and rejects different answers", () => {
  assert.ok(sameAnswer("Poached eggs", "poached egg"));
  assert.ok(sameAnswer("Mie Aceh", "mie aceh"));
  assert.ok(!sameAnswer("Mie Aceh", "Mie Goreng"));
  assert.ok(!sameAnswer("", "x"));
});

test("tierKey reads the labels on the page", () => {
  assert.equal(tierKey("ONE IN A KRILLION"), "krillion");
  assert.equal(tierKey("DEEP CUT"), "deepcut");
  assert.equal(tierKey("TOO CLEVER"), "tooclever");
  assert.equal(tierKey("RARE"), "rare");
  assert.equal(tierKey("???"), null);
});

test("parseLine handles notes, numbers, bullets, and quotes", () => {
  assert.deepEqual(parseLine("Mie Aceh | Acehnese curry noodles"), { answer: "Mie Aceh", note: "Acehnese curry noodles" });
  assert.deepEqual(parseLine("3. “Thukpa”"), { answer: "Thukpa", note: "" });
  assert.deepEqual(parseLine("- Laksa | spicy"), { answer: "Laksa", note: "spicy" });
  assert.equal(parseLine("   "), null);
});

test("LineParser emits an answer only when its line is complete", () => {
  const p = new LineParser();
  assert.deepEqual(p.push("Mie Ac"), []);
  assert.deepEqual(p.push("eh | note\nThukpa"), [{ answer: "Mie Aceh", note: "note" }]);
  assert.deepEqual(p.flush(), [{ answer: "Thukpa", note: "" }]);
});

test("mergeCands skips duplicates", () => {
  const out = mergeCands([{ answer: "Laksa", note: "" }], [{ answer: "laksa", note: "" }, { answer: "Thukpa", note: "" }]);
  assert.deepEqual(out.map((c) => c.answer), ["Laksa", "Thukpa"]);
});

test("pickSuggestions removes used and invalid answers", () => {
  const cands = ["Coddled eggs", "Shirred eggs", "Tea egg", "Cloud eggs"].map((answer) => ({ answer, note: "" }));
  const out = pickSuggestions(cands, { used: ["shirred egg"], invalid: ["Cloud Eggs"] });
  assert.deepEqual(out.map((c) => c.answer), ["Coddled eggs", "Tea egg"]);
});

test("pickSuggestions ranks known results around unknown answers", () => {
  const cands = ["A", "B", "C"].map((answer) => ({ answer, note: "" }));
  const results = {
    a: { answer: "A", tier: "schooler" },
    c: { answer: "C", tier: "krillion" },
    d: { answer: "D", tier: "deepcut" },
  };
  const out = pickSuggestions(cands, { results });
  assert.deepEqual(out.map((c) => c.answer), ["C", "D", "B", "A"]);
});

test("rejectedAnswer reads the quoted answer", () => {
  assert.equal(rejectedAnswer("“poached”: already said"), "poached");
  assert.equal(rejectedAnswer("not on the list"), "");
});

test("buildRequest sets fallbacks and fast mode only where the model accepts them", () => {
  const base = { prompt: "Name a noodle dish", mode: "solo", count: 12, avoid: ["Ramen"], known: [] };
  const opus = buildRequest({ ...base, model: "claude-opus-5-5", fast: true });
  assert.equal(opus.params.fallbacks, "default");
  assert.equal(opus.params.speed, "fast");
  assert.match(opus.params.messages[0].content, /Do not use these answers: Ramen/);
  const haiku = buildRequest({ ...base, model: "claude-haiku-5-5", fast: true });
  assert.equal(haiku.useFallback, false);
  assert.equal(haiku.params.fallbacks, undefined);
  assert.equal(haiku.params.speed, undefined);
});
