// Reads the game state from the krillion.io page.
// Selectors come from the live page (solo dive) and the room page (Puffer Party).

const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const unquote = (s) => s.replace(/^[“"']+|[”"']+$/g, "").trim();

// Solo modes: daily dive, unlimited, archive, packs.
export function readSolo(doc) {
  const root = doc.querySelector(".ds-root:not(.pf-root)");
  if (!root) return null;
  const round = text(root.querySelector(".ds-prompt-count"));
  const cards = [...root.querySelectorAll(".ds-world .ds-card")];
  const card = cards.find((c) => text(c.querySelector(".rnd")) === round) ?? cards.at(-1);
  return {
    mode: "solo",
    prompt: text(card?.querySelector(".prompt")),
    round,
    landed: [...root.querySelectorAll(".ds-landed")].map((el) => ({
      el,
      tier: text(el.querySelector(".tname")),
      answer: unquote(text(el.querySelector(".tans"))),
    })),
    reject: text(root.querySelector(".ds-reject")),
    input: root.querySelector(".ds-input"),
  };
}

// Puffer Party: the multiplayer room.
export function readParty(doc) {
  const root = doc.querySelector(".pf-root");
  if (!root) return null;
  const card = [...root.querySelectorAll(".ds-card:not(.pf-newcat)")].at(-1);
  const live = card && !card.classList.contains("cleared") && !card.classList.contains("gone");
  const input = root.querySelector(".ds-dock .ds-input, input.ds-input");
  const seats = [...root.querySelectorAll(".pf-seat")].map((el) => {
    const say = el.querySelector(".pf-say");
    const on = say?.classList.contains("on");
    return {
      name: text(el.querySelector(".pf-name")),
      me: el.classList.contains("me"),
      hold: el.classList.contains("hold"),
      // "rest" marks an accepted answer. "caret" marks text in progress.
      said: on && say.classList.contains("rest") ? text(say) : "",
    };
  });
  return {
    mode: "party",
    prompt: live ? text(card.querySelector(".prompt")) : "",
    category: live ? text(card.querySelector(".rnd span")) : "",
    seats,
    myTurn:
      seats.some((s) => s.me && s.hold) || /your puffer/i.test(input?.placeholder ?? ""),
    reject: text(root.querySelector(".ds-reject")),
    input,
  };
}

// The quoted answer in a reject line such as: “poached”: already said
export function rejectedAnswer(rejectText) {
  const m = rejectText.match(/[“"](.+?)[”"]/);
  return m ? m[1].trim() : "";
}

// Puts text in the game's answer box. The game uses React, so the script
// must call the native setter and then send an input event.
export function fillInput(input, value) {
  if (!input || input.disabled) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  return true;
}
