// The overlay panel. It lives in a shadow root, so the game styles cannot change it.
// All page data goes in through textContent, never through innerHTML.

const CSS = `
:host { all: initial; }
.box {
  position: fixed; left: 12px; bottom: 12px; z-index: 2147483647;
  width: 290px; max-height: 80vh; display: flex; flex-direction: column;
  font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #dbe9ff; background: rgba(8, 16, 34, 0.94);
  border: 1px solid #4de3ff; border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
}
.box.turn { border-color: #ff5d8f; box-shadow: 0 0 0 2px #ff5d8f, 0 6px 24px rgba(0,0,0,.5); }
.head {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  cursor: move; user-select: none; border-bottom: 1px solid #1d3355;
}
.head b { color: #4de3ff; letter-spacing: 0.12em; flex: 1; }
.head button, .foot button {
  font: inherit; color: #9fb4d6; background: none; border: 1px solid #2a4168;
  border-radius: 3px; padding: 0 6px; cursor: pointer;
}
.head button:hover, .foot button:hover { color: #fff; border-color: #4de3ff; }
.body { overflow-y: auto; padding: 6px 8px; }
.min .body, .min .foot { display: none; }
.prompt { color: #fff; margin-bottom: 4px; }
.status { color: #8fa3c4; margin-bottom: 6px; }
.status.turn { color: #ff5d8f; font-weight: 700; }
.status.err { color: #ffb347; }
.wait { color: #8fa3c4; }
ol { list-style: none; margin: 0; padding: 0; }
li.sug {
  display: flex; gap: 6px; align-items: baseline; padding: 4px 5px; margin: 2px 0;
  border: 1px solid #1d3355; border-radius: 4px; cursor: pointer;
}
li.sug:hover { border-color: #4de3ff; background: rgba(77, 227, 255, 0.08); }
li.sug .k { color: #5f769c; min-width: 12px; }
li.sug .a { color: #fff; font-weight: 700; flex: 1; word-break: break-word; }
li.sug .n { color: #8fa3c4; font-size: 11px; display: block; font-weight: 400; }
li.sug .t { color: #ff5d8f; font-size: 10px; text-transform: uppercase; }
h4 { margin: 8px 0 3px; font: inherit; color: #5f769c; letter-spacing: 0.1em; }
h4.rare { color: #4de3ff; }
h4.fast { color: #ffd166; }
.chips { display: flex; flex-wrap: wrap; gap: 3px; }
.chips button {
  font: inherit; color: #fff; background: rgba(255, 209, 102, 0.07); cursor: pointer;
  border: 1px solid #5a4a22; border-radius: 3px; padding: 2px 5px; text-align: left;
}
.chips button:hover { border-color: #ffd166; background: rgba(255, 209, 102, 0.16); }
.chips button .k { color: #8a7a4a; margin-right: 4px; }
.used { display: flex; flex-wrap: wrap; gap: 3px; }
.used span {
  border: 1px solid #1d3355; border-radius: 3px; padding: 0 4px; color: #9fb4d6;
  text-decoration: line-through; text-decoration-color: #5f769c;
}
.used span i { font-style: normal; color: #5f769c; text-decoration: none; display: inline-block; }
.foot { display: flex; gap: 4px; padding: 6px 8px; border-top: 1px solid #1d3355; }
.foot input {
  flex: 1; min-width: 0; font: inherit; color: #fff; background: #0b1730;
  border: 1px solid #2a4168; border-radius: 3px; padding: 2px 5px;
}
`;

const TIER_LABEL = {
  krillion: "krillion",
  deepcut: "deep cut",
  rare: "rare",
  schooler: "schooler",
  tooclever: "too clever",
  plankton: "plankton",
};

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

export function createPanel({ onPick, onMarkUsed, onMore, onOptions }) {
  const host = document.createElement("div");
  host.id = "krillionater";
  const shadow = host.attachShadow({ mode: "open" });
  const style = el("style");
  style.textContent = CSS;
  const box = el("div", "box");
  const head = el("div", "head");
  const title = el("b", "", "KRILLIONATER");
  const more = el("button", "", "more");
  more.title = "Ask for more answers";
  const toggle = el("button", "", "–");
  toggle.title = "Minimize";
  head.append(title, more, toggle);
  const body = el("div", "body");
  const foot = el("div", "foot");
  const usedInput = el("input");
  usedInput.placeholder = "mark an answer as used…";
  const usedBtn = el("button", "", "add");
  foot.append(usedInput, usedBtn);
  box.append(head, body, foot);
  shadow.append(style, box);
  document.documentElement.append(host);

  more.addEventListener("click", () => onMore());
  toggle.addEventListener("click", () => box.classList.toggle("min"));
  const submitUsed = () => {
    const value = usedInput.value.trim();
    if (value) onMarkUsed(value);
    usedInput.value = "";
  };
  usedBtn.addEventListener("click", submitUsed);
  usedInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") submitUsed();
  });

  // Lets the player move the panel by its header.
  head.addEventListener("pointerdown", (down) => {
    if (down.target.closest("button")) return;
    const rect = box.getBoundingClientRect();
    const dx = down.clientX - rect.left;
    const dy = down.clientY - rect.top;
    const move = (e) => {
      box.style.left = `${Math.max(0, e.clientX - dx)}px`;
      box.style.top = `${Math.max(0, e.clientY - dy)}px`;
      box.style.bottom = "auto";
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  });

  let lastSignature = "";

  function render(view) {
    host.style.display = view.visible ? "" : "none";
    if (!view.visible) return;
    const signature = JSON.stringify(view);
    if (signature === lastSignature) return;
    lastSignature = signature;

    box.classList.toggle("turn", !!view.myTurn);
    foot.style.display = view.mode === "party" ? "" : "none";
    body.replaceChildren();
    body.append(el("div", "prompt", view.prompt || "Waiting for a prompt…"));

    if (view.error) {
      body.append(el("div", "status err", view.error.message));
      if (view.error.code === "nokey" || view.error.code === "auth") {
        const open = el("button", "", "Open settings");
        open.addEventListener("click", () => onOptions());
        const wrap = el("div", "foot");
        wrap.style.border = "none";
        wrap.style.padding = "0 0 6px";
        wrap.append(open);
        body.append(wrap);
      }
    } else if (view.myTurn) {
      body.append(el("div", "status turn", "YOUR TURN — pick an answer"));
    }

    const waitLine = (list, text) => {
      if (list.length || !view.prompt || view.error) return;
      body.append(el("div", "wait", view.loading ? text : "No answers left. Press “more”."));
    };

    // RARE: the rarest answers, with a reason. Alt+1 to Alt+3.
    body.append(el("h4", "rare", "RARE"));
    waitLine(view.rare, "Searching for rare answers…");
    const list = el("ol");
    view.rare.forEach((s, i) => {
      const item = el("li", "sug");
      item.title = "Click to put this answer in the box";
      const answer = el("span", "a", s.answer);
      if (s.note) answer.append(el("span", "n", s.note));
      item.append(el("span", "k", i < 3 ? String(i + 1) : "·"), answer);
      if (s.tier) item.append(el("span", "t", TIER_LABEL[s.tier] ?? s.tier));
      item.addEventListener("click", () => onPick(s.answer));
      list.append(item);
    });
    body.append(list);

    // FAST: any correct answers, at once. Alt+4 to Alt+6.
    body.append(el("h4", "fast", "FAST"));
    waitLine(view.fast, "Getting answers…");
    const chips = el("div", "chips");
    view.fast.forEach((s, i) => {
      const chip = el("button");
      chip.title = s.note || "Click to put this answer in the box";
      if (i < 3) chip.append(el("span", "k", String(i + 4)));
      chip.append(s.answer);
      chip.addEventListener("click", () => onPick(s.answer));
      chips.append(chip);
    });
    body.append(chips);

    if (view.mode === "party" && view.used.length) {
      body.append(el("h4", "", `USED (${view.used.length})`));
      const used = el("div", "used");
      for (const u of view.used) {
        const chip = el("span", "", u.answer);
        if (u.by) chip.append(" ", el("i", "", u.by));
        used.append(chip);
      }
      body.append(used);
    }
  }

  return { render, host };
}
