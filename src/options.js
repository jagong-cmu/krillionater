import { DEFAULT_MODEL, MODELS } from "./lib/llm.js";

const $ = (id) => document.getElementById(id);

for (const m of MODELS) {
  const option = document.createElement("option");
  option.value = m.id;
  option.textContent = m.label;
  $("model").append(option);
}

chrome.storage.local.get(["apiKey", "model", "fast"]).then((s) => {
  $("apiKey").value = s.apiKey ?? "";
  $("model").value = s.model ?? DEFAULT_MODEL;
  $("fast").checked = !!s.fast;
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    model: $("model").value,
    fast: $("fast").checked,
  });
  $("status").textContent = "Saved.";
  setTimeout(() => ($("status").textContent = ""), 1500);
});
