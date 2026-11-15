// The answer providers. Pure data, so the options page and node can import it.
//
// The selected model makes the RARE list. `quickModel`, the fastest model of
// the provider, makes the FAST list. Both run at the same time for each prompt.

export const DEFAULT_PROVIDER = "anthropic";

export const PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)",
    name: "Claude",
    keyField: "apiKey",
    modelField: "model",
    keyHint: "sk-ant-…",
    host: "api.anthropic.com",
    defaultModel: "claude-opus-5-5",
    quickModel: "claude-haiku-5-5",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5 (default)" },
      { id: "claude-fable-5-2", label: "Claude Fable 5.2 (most capable, slowest)" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster)" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest)" },
    ],
  },
  openai: {
    label: "ChatGPT (OpenAI)",
    name: "OpenAI",
    keyField: "openaiKey",
    modelField: "openaiModel",
    keyHint: "sk-…",
    host: "api.openai.com",
    defaultModel: "gpt-6.1-sol",
    quickModel: "gpt-6-luna",
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol (default)" },
      { id: "gpt-6-astra", label: "GPT-6 Astra (most capable, slowest)" },
      { id: "gpt-6-luna", label: "GPT-6 Luna (fastest)" },
      { id: "chat-latest", label: "chat-latest (ChatGPT Instant)" },
    ],
  },
  gemini: {
    label: "Gemini (Google)",
    name: "Gemini",
    keyField: "geminiKey",
    modelField: "geminiModel",
    keyHint: "AIza…",
    host: "generativelanguage.googleapis.com",
    defaultModel: "gemini-3.8-flash",
    quickModel: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (default)" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro preview (most capable, slowest)" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest)" },
    ],
  },
};

export const SETTING_KEYS = [
  "provider",
  "fast",
  ...Object.values(PROVIDERS).flatMap((p) => [p.keyField, p.modelField]),
];

// Turns the stored values into the settings for one request.
export function resolveSettings(stored = {}) {
  const provider = PROVIDERS[stored.provider] ? stored.provider : DEFAULT_PROVIDER;
  const info = PROVIDERS[provider];
  return {
    provider,
    info,
    apiKey: stored[info.keyField] ?? "",
    model: stored[info.modelField] || info.defaultModel,
    fast: !!stored.fast,
  };
}
