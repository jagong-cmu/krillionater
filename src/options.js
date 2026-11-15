import { PROVIDERS, SETTING_KEYS, resolveSettings } from "./lib/providers.js";

const $ = (id) => document.getElementById(id);

// The values on the page for each provider. The player can change the provider
// and come back, and the page keeps the text.
const draft = {};
let shown = null;

for (const [id, info] of Object.entries(PROVIDERS)) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = info.label;
  $("provider").append(option);
}

function keep() {
  if (shown) draft[shown] = { key: $("apiKey").value.trim(), model: $("model").value.trim() };
}

function show(id) {
  keep();
  shown = id;
  const info = PROVIDERS[id];
  $("keyLabel").textContent = `${info.name} API key`;
  $("apiKey").placeholder = info.keyHint;
  $("apiKey").value = draft[id].key;
  $("keyHint").textContent =
    `The extension stores the key in this browser only. It sends the key only to ${info.host}.`;
  $("model").value = draft[id].model;
  $("model").placeholder = info.defaultModel;
  $("models").replaceChildren(
    ...info.models.map((m) => {
      const option = document.createElement("option");
      option.value = m.id;
      option.label = m.label;
      return option;
    }),
  );
  $("quickHint").textContent =
    `${info.quickModel} makes the FAST list at the same time. ` +
    "Each list also gets a check that its answers fit the prompt.";
  $("fastRow").style.display = id === "anthropic" ? "" : "none";
}

chrome.storage.local.get(SETTING_KEYS).then((stored) => {
  for (const [id, info] of Object.entries(PROVIDERS)) {
    draft[id] = {
      key: stored[info.keyField] ?? "",
      model: stored[info.modelField] || info.defaultModel,
    };
  }
  const settings = resolveSettings(stored);
  $("provider").value = settings.provider;
  $("fast").checked = settings.fast;
  show(settings.provider);
});

$("provider").addEventListener("change", () => show($("provider").value));

$("save").addEventListener("click", async () => {
  keep();
  const values = {
    provider: $("provider").value,
    fast: $("fast").checked,
  };
  for (const [id, info] of Object.entries(PROVIDERS)) {
    values[info.keyField] = draft[id].key;
    values[info.modelField] = draft[id].model || info.defaultModel;
  }
  await chrome.storage.local.set(values);
  $("status").textContent = "Saved.";
  setTimeout(() => ($("status").textContent = ""), 1500);
});
