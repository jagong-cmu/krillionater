# Krillionater

Krillionater is a Chrome extension for [krillion.io](https://krillion.io). It reads the prompt on the page and shows rare answers in a small panel. In Puffer Party (the multiplayer mode), it also records each answer that a player gives, and it removes those answers from its suggestions.

The extension suggests answers. You select an answer and you submit it.

## Install

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions` in Chrome.
4. Set "Developer mode" to on.
5. Click "Load unpacked" and select this folder.
6. Open the extension settings ("Details", then "Extension options").
7. Select the answer provider: Claude, ChatGPT (OpenAI), or Gemini.
8. Enter the API key of that provider and click "Save".

After an update of the code, run `npm run build` and click the reload icon on the Krillionater card in `chrome://extensions`.

## Use

The panel shows two lists for the current prompt at the same time:

- **RARE**: the rarest answers. The selected model takes more time for this list.
- **FAST**: any correct answers. The fastest model of the provider gives this list in about one second.

- Click an answer to put it in the answer box. `Alt+1` to `Alt+3` do the same for the first three RARE answers. `Alt+4` to `Alt+6` do the same for the first three FAST answers.
- Press Enter to submit the answer.
- A second request checks that each answer fits the prompt. An answer that fails this check leaves the list.
- Hold the pointer on an answer to see the reason for it.
- In Puffer Party, the panel border becomes pink when it is your turn. The "USED" list shows each recorded answer and the player who gave it.
- The game corrects a near spelling to the answer on its list. Thus a used answer also removes near spellings from the two lists ("omlette" and "omelette", "poached" and "poached eggs").
- If the tracker did not see an answer, click "+" next to "USED" and type it.
- Click "↻" to ask for more answers.

## How it works

| File | Function |
| --- | --- |
| `src/lib/dom.js` | Reads the prompt, the seats, the accepted answers, and the reject line from the page. |
| `src/lib/game.js` | Compares answers, parses the model output, and ranks the suggestions. |
| `src/lib/providers.js` | Lists the providers, their models, and their settings. |
| `src/lib/llm.js` | Builds the request for Claude, OpenAI, or Gemini and streams the answers. |
| `src/background.js` | The service worker. It holds the API keys, calls the provider, and stores the results. |
| `src/content.js` | Connects the page state to the panel. |
| `src/panel.js` | The overlay panel. |

Notes:

- The game accepts only answers in its curated answer set. Thus the model must give real, documented answers, not invented words.
- The extension stores each result (answer and tier) and each rejected answer. It uses them to rank the answers the next time the same prompt occurs.
- On the home page, the extension prepares answers for the seven daily prompts before the clock starts.
- In Puffer Party, the used list starts again when the category changes. This agrees with the game rule.

## Speed

- The FAST list uses the fastest model of the provider with reasoning off, so it does not wait for the RARE list.
- The RARE list puts rarity before speed. It uses the selected model with a high reasoning setting, and it starts after the FAST list is complete. The search gets the FAST list as the level that its answers must be far below.
- A more capable model finds rarer answers, but it is slower.
- Each prompt uses four requests: one for each list, and one check for each list.
- For Claude, "Priority speed" makes Opus 5.5 faster at a higher price.

## Test

Run `npm test`.

The page readers depend on the class names of krillion.io (`.ds-card .prompt`, `.pf-seat`, `.pf-say.rest`, `.ds-reject`). If the site changes these names, update `src/lib/dom.js`.
