import test from "node:test";
import assert from "node:assert/strict";
import { buildGeminiRequest, buildOpenAIRequest, buildRequest, streamCandidates } from "../src/lib/llm.js";
import { mergeCands, pickSuggestions } from "../src/lib/game.js";
import { resolveSettings } from "../src/lib/providers.js";

const base = { prompt: "Name a noodle dish", mode: "solo", count: 6, avoid: [], known: [] };

// A fetch response that sends the given text in small pieces.
function sse(text, status = 200) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  });
  return new Response(body, { status });
}

function withFetch(handler, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return handler(calls.length);
  };
  return run(calls).finally(() => (globalThis.fetch = real));
}

test("Claude requests turn thinking off where the model permits it", () => {
  assert.deepEqual(buildRequest({ ...base, model: "claude-haiku-5-5" }).params.thinking, { type: "disabled" });
  assert.deepEqual(buildRequest({ ...base, model: "claude-sonnet-5-5" }).params.thinking, { type: "between_tools" });
  assert.equal(buildRequest({ ...base, model: "claude-opus-5-5" }).params.thinking, undefined);
});

test("OpenAI and Gemini requests use the lowest reasoning setting of a known model", () => {
  assert.equal(buildOpenAIRequest({ ...base, model: "gpt-6-luna" }).reasoning_effort, "none");
  assert.equal(buildOpenAIRequest({ ...base, model: "my-model" }).reasoning_effort, undefined);
  assert.equal(buildOpenAIRequest({ ...base, model: "gpt-6-luna" }, false).reasoning_effort, undefined);
  const gemini = buildGeminiRequest({ ...base, model: "gemini-3.5-flash-lite" });
  assert.equal(gemini.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.equal(buildGeminiRequest({ ...base, model: "my-model" }).generationConfig, undefined);
});

test("streamCandidates reads an OpenAI stream", () =>
  withFetch(
    () =>
      sse(
        'data: {"choices":[{"delta":{"content":"Mie Aceh | Aceh"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"nese\\nThukpa"}}]}\n\n' +
          "data: [DONE]\n\n",
      ),
    async (calls) => {
      const out = [];
      await streamCandidates({ ...base, provider: "openai", apiKey: "k", model: "gpt-6-luna" }, (c) => out.push(c));
      assert.deepEqual(out, [{ answer: "Mie Aceh", note: "Acehnese" }, { answer: "Thukpa", note: "" }]);
      assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
      assert.equal(calls[0].headers.authorization, "Bearer k");
      assert.equal(calls[0].body.stream, true);
    },
  ));

test("streamCandidates reads a Gemini stream and skips thought parts", () =>
  withFetch(
    () =>
      sse(
        'data: {"candidates":[{"content":{"parts":[{"text":"plan","thought":true},{"text":"Laksa | spicy\\n"}]}}]}\r\n\r\n' +
          'data: {"candidates":[{"content":{"parts":[{"text":"Khao soi"}]}}]}\r\n\r\n',
      ),
    async (calls) => {
      const out = [];
      await streamCandidates({ ...base, provider: "gemini", apiKey: "k", model: "gemini-3.8-flash" }, (c) => out.push(c));
      assert.deepEqual(out.map((c) => c.answer), ["Laksa", "Khao soi"]);
      assert.match(calls[0].url, /models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
      assert.equal(calls[0].headers["x-goog-api-key"], "k");
    },
  ));

test("a rejected reasoning setting causes one more request with no setting", () =>
  withFetch(
    (n) =>
      n === 1
        ? new Response('{"error":{"message":"Unsupported value: reasoning_effort"}}', { status: 400 })
        : sse('data: {"choices":[{"delta":{"content":"Thukpa\\n"}}]}\n\n'),
    async (calls) => {
      const out = [];
      await streamCandidates({ ...base, provider: "openai", apiKey: "k", model: "gpt-6-luna" }, (c) => out.push(c));
      assert.equal(out[0].answer, "Thukpa");
      assert.equal(calls[0].body.reasoning_effort, "none");
      assert.equal(calls[1].body.reasoning_effort, undefined);
    },
  ));

test("a bad key gives an auth error, also when Gemini reports it as HTTP 400", async () => {
  await withFetch(
    () => new Response('{"error":{"message":"API key not valid."}}', { status: 400 }),
    async (calls) => {
      await assert.rejects(
        streamCandidates({ ...base, provider: "gemini", apiKey: "k", model: "gemini-3.8-flash" }, () => {}),
        (e) => e.status === 401,
      );
      assert.equal(calls.length, 1);
    },
  );
});

test("an answer from the selected model replaces and outranks a quick answer", () => {
  const merged = mergeCands(
    [{ answer: "Laksa", note: "", q: true }, { answer: "Thukpa", note: "", q: true }],
    [{ answer: "Mie Aceh", note: "" }, { answer: "thukpa", note: "better" }],
  );
  assert.deepEqual(pickSuggestions(merged).map((c) => c.answer), ["thukpa", "Mie Aceh", "Laksa"]);
});

test("resolveSettings selects the key and the model of the provider", () => {
  const s = resolveSettings({ provider: "openai", apiKey: "a", openaiKey: "o" });
  assert.deepEqual([s.apiKey, s.model, s.info.quickModel], ["o", "gpt-6.1-sol", "gpt-6-luna"]);
  assert.equal(resolveSettings({}).model, "claude-opus-5-5");
});

test("the RARE search uses more effort and the FAST list uses its own instructions", async () => {
  const { FAST_SYSTEM, SYSTEM } = await import("../src/lib/llm.js");
  const deep = buildRequest({ ...base, model: "claude-haiku-5-5", deep: true }).params;
  assert.equal(deep.output_config.effort, "high");
  assert.equal(deep.thinking, undefined);
  assert.equal(buildRequest({ ...base, model: "claude-opus-5-5" }).params.system, SYSTEM);
  assert.equal(buildRequest({ ...base, play: "fast", model: "claude-haiku-5-5" }).params.system, FAST_SYSTEM);
  assert.equal(buildOpenAIRequest({ ...base, model: "gpt-6.1-sol", deep: true }).reasoning_effort, "high");
  const rare = buildRequest({ ...base, model: "claude-opus-5-5", common: ["Ramen", "Udon"] }).params.messages[0].content;
  assert.match(rare, /far more obscure than all of them: Ramen; Udon/);
});

test("verifyAnswers reports each verdict", async () => {
  const { verifyAnswers } = await import("../src/lib/llm.js");
  await withFetch(
    () => sse('data: {"choices":[{"delta":{"content":"Thukpa | ok\\nPad Thai Pizza | no\\nLaksa | unsure\\n"}}]}\n\n'),
    async (calls) => {
      const out = [];
      await verifyAnswers(
        { ...base, provider: "openai", apiKey: "k", model: "gpt-6-luna", deep: true },
        ["Thukpa", "Pad Thai Pizza", "Laksa"],
        (answer, ok) => out.push([answer, ok]),
      );
      assert.deepEqual(out, [["Thukpa", true], ["Pad Thai Pizza", false]]);
      assert.match(calls[0].body.messages[0].content, /You check answers/);
      assert.match(calls[0].body.messages[1].content, /Answers:\nThukpa\nPad Thai Pizza\nLaksa/);
      assert.equal(calls[0].body.reasoning_effort, "none");
    },
  );
});

test("closeAnswer accepts the spellings that the game corrects", async () => {
  const { closeAnswer } = await import("../src/lib/game.js");
  for (const [a, b] of [
    ["omlette", "Omelette"], ["corn bread", "Cornbread"], ["poached", "Poached eggs"],
    ["tagliatele al ragu", "Tagliatelle al ragù"], ["sherred eggs", "Shirred eggs"], ["recieve", "receive"],
  ]) assert.ok(closeAnswer(a, b), `${a} ~ ${b}`);
  for (const [a, b] of [
    ["Mie Aceh", "Mie Ayam"], ["Apollo 11", "Apollo 12"], ["Henry VII", "Henry VIII"],
    ["egg", "tea egg"], ["Tea egg", "Cloud eggs"], ["lime", "line"],
  ]) assert.ok(!closeAnswer(a, b), `${a} != ${b}`);
});

test("a used answer removes a near spelling, and a checked answer ranks first", () => {
  const cands = [
    { answer: "Omelette", note: "" }, { answer: "Shirred eggs", note: "" },
    { answer: "Tea egg", note: "", v: true }, { answer: "Coddled eggs", note: "", q: true, v: true },
  ];
  const out = pickSuggestions(cands, { used: ["omlette"] });
  assert.deepEqual(out.map((c) => c.answer), ["Tea egg", "Shirred eggs", "Coddled eggs"]);
});

test("a result for the typed spelling does not make a second entry", () => {
  const result = { answer: "Gautam Adani", tier: "rare" };
  const out = pickSuggestions([{ answer: "Gautam Adhani", note: "" }], {
    results: { "gautam adani": result, "gautam adhani": result },
  });
  assert.deepEqual(out.map((c) => [c.answer, c.tier]), [["Gautam Adhani", "rare"]]);
});
