# Krillionater

Krillionater is a Chrome extension for [krillion.io](https://krillion.io). It reads the prompt on the page and shows rare answers in a small panel. In Puffer Party (the multiplayer mode), it also records each answer that a player gives, and it removes those answers from its suggestions.

The extension suggests answers. You select an answer and you submit it.

## Setup

### What you need

- Google Chrome, or a different browser that loads Chrome extensions.
- [Node.js](https://nodejs.org) version 18 or later. Node.js includes `npm`.
- [Git](https://git-scm.com), or the "Download ZIP" button on the GitHub page.
- An API key from one of these providers. The provider bills each request to your account.
  - Claude: [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys)
  - ChatGPT (OpenAI): [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
  - Gemini: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Build the extension

1. Open a terminal.
2. Run `git clone https://github.com/jagong-cmu/krillionater.git`.
3. Run `cd krillionater`.
4. Run `npm install`.
5. Run `npm run build`. This command makes the `dist` folder, which Chrome needs.

### Add the extension to Chrome

1. Open `chrome://extensions` in Chrome.
2. Set "Developer mode" to on. The switch is in the top right corner.
3. Click "Load unpacked".
4. Select the `krillionater` folder (the folder that contains `manifest.json`).

### Enter your API key

1. On the Krillionater card, click "Details".
2. Click "Extension options".
3. Select the answer provider: Claude, ChatGPT (OpenAI), or Gemini.
4. Enter the API key of that provider.
5. Click "Save".
6. Open [krillion.io](https://krillion.io) and start a game. The panel shows in the bottom left corner.

The extension keeps the key in the local storage of your browser. It sends the key only to the provider that you selected. Do not put a key in a file of this repository.

### Update

1. Run `git pull`.
2. Run `npm install`.
3. Run `npm run build`.
4. Click the reload icon on the Krillionater card in `chrome://extensions`.
5. Refresh the krillion.io tab.

### If the panel does not work

- **The panel does not show:** refresh the krillion.io tab. Make sure that the Krillionater card is on.
- **Chrome cannot load the extension:** run `npm run build` again, then click the reload icon on the card.
- **The panel shows a key error:** click "Open settings" in the panel and enter the key again. Make sure that the key is for the selected provider and that the account has credit.
- **The panel reads the wrong text:** the site possibly changed its class names. Refer to "Test" below.

## Use

The panel shows two lists for the current prompt at the same time:

- **RARE**: the rarest answers. The selected model takes more time for this list.
- **FAST**: any correct answers. The fastest model of the provider gives this list in about one second.

- Click an answer to put it in the answer box. `Alt+1` to `Alt+3` do the same for the first three RARE answers. `Alt+4` to `Alt+6` do the same for the first three FAST answers.
- Press Enter to submit the answer.
- A second request checks that each answer fits the prompt. An answer that fails this check leaves the list.
- In Puffer Party, the panel border becomes pink when it is your turn. The "USED" list shows each recorded answer and the player who gave it.
- The game corrects a near spelling to the answer on its list. Thus a used answer also removes near spellings from the two lists ("omlette" and "omelette", "poached" and "poached eggs").
- If the tracker did not see an answer, type it in "mark an answer as used".
- Click "more" to ask for more answers.

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

- The FAST list uses the fastest model of the provider with reasoning off.
- The RARE list uses the selected model with the lowest reasoning setting that the model accepts. The fastest model does the same rare search at the same time, so the RARE list has answers in a few seconds. The answers of the selected model go above them.
- The rare search waits a maximum of 0.8 seconds for the FAST list. It gets the answers that are there as the level that its answers must be far below.
- The default Claude model is Sonnet 5.5, which answers with thinking off. Opus 5.5 and Fable 5.2 find rarer answers, but they always think first, so they are slower.
- For Claude, "Priority speed" makes Opus 5.5 faster at a higher price.

## Test

Run `npm test`.

The page readers depend on the class names of krillion.io (`.ds-card .prompt`, `.pf-seat`, `.pf-say.rest`, `.ds-reject`). If the site changes these names, update `src/lib/dom.js`.

## License

The [MIT License](LICENSE) applies to this project.
