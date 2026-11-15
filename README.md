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
7. Enter your Claude API key and click "Save".

## Use

- Open krillion.io and start a dive. The panel shows the best answers for the current prompt.
- Click an answer to put it in the answer box. `Alt+1`, `Alt+2`, and `Alt+3` do the same for the first three answers.
- Press Enter to submit the answer.
- In Puffer Party, the panel border becomes pink when it is your turn. The "USED" list shows each recorded answer and the player who gave it.
- If the tracker did not see an answer, type it in "mark an answer as used".
- Click "more" to ask for more answers.

## How it works

| File | Function |
| --- | --- |
| `src/lib/dom.js` | Reads the prompt, the seats, the accepted answers, and the reject line from the page. |
| `src/lib/game.js` | Compares answers, parses the model output, and ranks the suggestions. |
| `src/lib/llm.js` | Builds the Claude API request and streams the answers. |
| `src/background.js` | The service worker. It holds the API key, calls Claude, and stores the results. |
| `src/content.js` | Connects the page state to the panel. |
| `src/panel.js` | The overlay panel. |

Notes:

- The game accepts only answers in its curated answer set. Thus the model must give real, documented answers, not invented words.
- The extension stores each result (answer and tier) and each rejected answer. It uses them to rank the answers the next time the same prompt occurs.
- On the home page, the extension prepares answers for the seven daily prompts before the clock starts.
- In Puffer Party, the used list starts again when the category changes. This agrees with the game rule.

## Test

Run `npm test`.

The page readers depend on the class names of krillion.io (`.ds-card .prompt`, `.pf-seat`, `.pf-say.rest`, `.ds-reject`). If the site changes these names, update `src/lib/dom.js`.
