// Content script for krillion.io. Watches the page, asks the service worker
// for rare answers, and shows them in the panel.
import { fillInput, readParty, readSolo, rejectedAnswer } from "./lib/dom.js";
import { includesAnswer, mergeCands, normalize, pickSuggestions, tierKey } from "./lib/game.js";
import { createPanel } from "./panel.js";

const TICK_MS = 200;
// The number of answers that the panel shows in each list.
const SHOWN = { rare: 5, fast: 8 };
// The number of answers to ask for in each list.
// A short RARE list arrives sooner. The party refill asks for more when the list gets short.
const WANT = { solo: { rare: 8, fast: 10 }, party: { rare: 20, fast: 30 } };
// Ask for more party answers when fewer than this number remain in a list.
const PARTY_LOW = { rare: 6, fast: 8 };

const freshRound = (key = "", mode = "solo", prompt = "") => ({
  key,
  mode,
  prompt,
  cands: [],
  results: {},
  invalid: [],
  used: [], // [{ answer, by }]
  loading: false,
  error: null,
  refills: 0,
  port: null,
});

let round = freshRound();
let lastReject = "";
let lastTyped = "";
let myTurn = false;
const seenLanded = new WeakSet();
let firstTick = true;

const usedAnswers = () => round.used.map((u) => u.answer);

function suggestions() {
  return pickSuggestions(round.cands, {
    used: usedAnswers(),
    invalid: round.invalid,
    results: round.results,
  });
}

// The two lists. RARE: the rarest answers. FAST: any correct answers, at once.
function lists() {
  const all = suggestions();
  return { rare: all.filter((c) => !c.q), fast: all.filter((c) => c.q) };
}

function send(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // The extension was reloaded. The page needs a refresh.
  }
}

function requestSuggestions(want) {
  if (round.port) round.port.disconnect();
  const current = round;
  current.loading = true;
  current.error = null;
  let port;
  try {
    port = chrome.runtime.connect({ name: "suggest" });
  } catch {
    current.loading = false;
    current.error = { code: "reload", message: "Extension reloaded. Refresh this page." };
    return;
  }
  current.port = port;
  port.onMessage.addListener((msg) => {
    if (round !== current) return;
    if (msg.type === "state") {
      current.cands = mergeCands(current.cands, msg.cands);
      current.results = { ...msg.results, ...current.results };
      current.invalid = [...new Set([...current.invalid, ...msg.invalid])];
    } else if (msg.type === "cands") {
      current.cands = mergeCands(current.cands, msg.items);
    } else if (msg.type === "bad") {
      // The category check found that these answers do not fit the prompt.
      current.invalid = [...new Set([...current.invalid, ...msg.answers])];
    } else if (msg.type === "error") {
      current.error = { code: msg.code, message: msg.message };
    } else if (msg.type === "done") {
      current.loading = false;
    }
    draw();
  });
  port.onDisconnect.addListener(() => {
    if (current.port === port) {
      current.port = null;
      current.loading = false;
    }
  });
  port.postMessage({
    type: "suggest",
    prompt: current.prompt,
    mode: current.mode,
    want,
    avoid: [...usedAnswers(), ...current.invalid],
  });
}

function setRound(key, mode, prompt) {
  if (round.port) round.port.disconnect();
  round = freshRound(key, mode, prompt);
  lastTyped = "";
  if (prompt) requestSuggestions(WANT[mode]);
}

// `alias` marks the typed form of an answer. The panel does not show it.
function markUsed(answer, by = "", alias = false) {
  if (!answer || includesAnswer(usedAnswers(), answer)) return;
  round.used.push({ answer, by, alias });
}

function markInvalid(answer) {
  if (!answer || includesAnswer(round.invalid, answer)) return;
  round.invalid.push(answer);
  send({ type: "invalid", prompt: round.prompt, answer });
}

function trackInput(input) {
  const value = input?.value?.trim();
  if (value) lastTyped = value;
}

// Returns the answer that a new reject line refers to, or "" when nothing is new.
function newReject(rejectText) {
  if (rejectText === lastReject) return "";
  lastReject = rejectText;
  if (!rejectText) return "";
  return rejectedAnswer(rejectText) || lastTyped;
}

function tickSolo(state) {
  if (state.prompt && state.prompt !== round.prompt) {
    setRound(`solo|${state.prompt}`, "solo", state.prompt);
  }
  trackInput(state.input);
  for (const landed of state.landed) {
    if (seenLanded.has(landed.el)) continue;
    seenLanded.add(landed.el);
    const tier = tierKey(landed.tier);
    if (firstTick || !round.prompt || !landed.answer || !tier) continue;
    const result = { answer: landed.answer, tier };
    round.results[normalize(landed.answer)] = result;
    // The game can correct the typed text. Keep the result for the typed text also.
    if (lastTyped) round.results[normalize(lastTyped)] = result;
    send({ type: "result", prompt: round.prompt, answer: landed.answer, tier });
  }
  const rejected = newReject(state.reject);
  if (rejected && round.prompt) markInvalid(rejected);
}

function tickParty(state) {
  const key = state.prompt ? `party|${state.category}|${state.prompt}` : "";
  if (key !== round.key) setRound(key, "party", state.prompt);
  myTurn = state.myTurn;
  if (!round.prompt) return;
  trackInput(state.input);
  for (const seat of state.seats) {
    if (!seat.said) continue;
    // The game can correct the typed text to the answer on its list. Then the
    // page shows a different text. Record the typed text also.
    if (seat.me && lastTyped && !includesAnswer(usedAnswers(), seat.said)) {
      markUsed(lastTyped, "you", true);
      lastTyped = "";
    }
    markUsed(seat.said, seat.me ? "you" : seat.name);
  }
  const rejected = newReject(state.reject);
  if (rejected) {
    if (/already said/i.test(state.reject)) markUsed(rejected);
    else markInvalid(rejected);
  }
  if (!round.loading && !round.error && round.refills < 5) {
    const { rare, fast } = lists();
    const want = {
      rare: rare.length < PARTY_LOW.rare ? rare.length + WANT.party.rare : 0,
      fast: fast.length < PARTY_LOW.fast ? fast.length + WANT.party.fast : 0,
    };
    if (want.rare || want.fast) {
      round.refills += 1;
      requestSuggestions(want);
    }
  }
}

let current = null;

const view = (list, count) =>
  list.slice(0, count).map(({ answer, note, tier }) => ({ answer, note, tier }));

function draw() {
  panel.render({
    visible: !!current,
    mode: round.mode,
    prompt: round.prompt,
    myTurn: current?.mode === "party" && myTurn,
    loading: round.loading,
    error: round.error,
    rare: view(lists().rare, SHOWN.rare),
    fast: view(lists().fast, SHOWN.fast),
    used: round.used.filter((u) => !u.alias).reverse(),
  });
}

function tick() {
  const party = readParty(document);
  current = party ?? readSolo(document);
  if (party) tickParty(party);
  else if (current) tickSolo(current);
  else myTurn = false;
  firstTick = false;
  draw();
}

function pick(answer) {
  if (current?.input) fillInput(current.input, answer);
}

const panel = createPanel({
  onPick: pick,
  onMarkUsed: (answer) => {
    markUsed(answer, "manual");
    draw();
  },
  onMore: () => {
    if (!round.prompt) return;
    const { rare, fast } = lists();
    const want = WANT[round.mode];
    requestSuggestions({ rare: rare.length + want.rare, fast: fast.length + want.fast });
  },
  onOptions: () => send({ type: "openOptions" }),
});

// Alt+1, Alt+2, Alt+3 put a RARE answer in the answer box.
// Alt+4, Alt+5, Alt+6 put a FAST answer in the answer box.
window.addEventListener(
  "keydown",
  (e) => {
    if (!e.altKey || !/^Digit[1-6]$/.test(e.code)) return;
    const n = Number(e.code.slice(5));
    const { rare, fast } = lists();
    const choice = n <= 3 ? rare[n - 1] : fast[n - 4];
    if (choice && current?.input) {
      e.preventDefault();
      pick(choice.answer);
    }
  },
  true,
);

// On the home page, prepare the daily prompts before the clock starts.
async function prewarmDaily() {
  if (location.pathname !== "/") return;
  try {
    const res = await fetch("/api/today");
    const data = await res.json();
    const prompts = (data.prompts ?? []).map((p) => p.text).filter(Boolean);
    if (prompts.length) send({ type: "prewarm", prompts });
  } catch {
    // The daily list is optional.
  }
}

setInterval(tick, TICK_MS);
tick();
prewarmDaily();
