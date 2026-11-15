// The overlay panel. It lives in a shadow root, so the game styles cannot change it.
// All page data goes in through textContent, never through innerHTML.

const CSS = `
:host { all: initial; }
.box {
  position: fixed; left: 12px; bottom: 12px; z-index: 2147483647;
  width: 250px; max-height: 80vh; display: flex; flex-direction: column;
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e8eefc; background: rgba(8, 14, 30, 0.95);
  border: 1px solid #263a5e; border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
}
.box.turn { border-color: #ff5d8f; box-shadow: 0 0 0 2px #ff5d8f, 0 8px 28px rgba(0,0,0,.55); }
.head {
  display: flex; align-items: center; gap: 4px; padding: 7px 10px 0;
  cursor: move; user-select: none;
}
.head b { flex: 1; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; color: #5f769c; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.head button { color: #5f769c; font-size: 12px; padding: 0 5px; border-radius: 4px; }
.head button:hover { color: #fff; background: #1a2a48; }
.body { overflow-y: auto; padding: 4px 10px 10px; }
.min .body { display: none; }
.min .head { padding-bottom: 7px; }
.status { color: #8fa3c4; margin: 4px 0; }
.status.turn { color: #ff5d8f; font-weight: 700; }
.status.err { color: #ffb347; }
.status button { margin-left: 6px; text-decoration: underline; color: #fff; }
h4 { margin: 10px 0 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.14em; }
h4.rare { color: #4de3ff; }
h4.fast { color: #ffd166; }
h4.used { color: #5f769c; display: flex; align-items: center; gap: 6px; }
h4.used button { color: #5f769c; font-size: 13px; line-height: 1; }
h4.used button:hover { color: #fff; }
.wait { color: #5f769c; font-size: 12px; }
.rare-list button {
  display: flex; align-items: baseline; gap: 8px; text-align: left;
  padding: 5px 8px; margin: 0 -8px; width: calc(100% + 16px); border-radius: 6px;
  font-size: 16px; font-weight: 650; color: #fff;
}
.rare-list button:hover { background: rgba(77, 227, 255, 0.14); }
.rare-list .a { flex: 1; overflow-wrap: anywhere; }
.rare-list .t { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; color: #ff5d8f; text-transform: uppercase; }
.fast-list { display: flex; flex-wrap: wrap; gap: 4px; }
.fast-list button {
  padding: 3px 8px; border-radius: 999px; font-size: 13px; color: #f4ecd6;
  background: rgba(255, 209, 102, 0.1);
}
.fast-list button:hover { background: rgba(255, 209, 102, 0.28); color: #fff; }
.used-list { color: #6f84a8; font-size: 11px; line-height: 1.5; }
.used-list i { font-style: normal; color: #44587a; }
.add { display: flex; gap: 4px; margin-top: 6px; }
.add input {
  flex: 1; min-width: 0; font: inherit; font-size: 12px; color: #fff; background: #0b1730;
  border: 1px solid #263a5e; border-radius: 5px; padding: 3px 6px; outline: none;
}
.add input:focus { border-color: #4de3ff; }
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
  const more = el("button", "", "↻");
  more.title = "Ask for more answers";
  const toggle = el("button", "", "–");
  toggle.title = "Minimize";
  head.append(el("b", "", "KRILLIONATER"), more, toggle);
  const body = el("div", "body");
  box.append(head, body);
  shadow.append(style, box);
  document.documentElement.append(host);

  more.addEventListener("click", () => onMore());
  toggle.addEventListener("click", () => box.classList.toggle("min"));

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

  // The "mark an answer as used" box. It stays out of view until the player opens it.
  let addOpen = false;
  let lastView = null;
  let lastSignature = "";

  function paint(view) {
    box.classList.toggle("turn", !!view.myTurn);
    body.replaceChildren();

    if (view.error) {
      const status = el("div", "status err", view.error.message);
      if (view.error.code === "nokey" || view.error.code === "auth") {
        const open = el("button", "", "Settings");
        open.addEventListener("click", () => onOptions());
        status.append(open);
      }
      body.append(status);
    } else if (!view.hasPrompt) {
      body.append(el("div", "status", "Waiting for a prompt…"));
      return;
    } else if (view.myTurn) {
      body.append(el("div", "status turn", "YOUR TURN"));
    }

    const section = (kind, label, items, waitText, build) => {
      body.append(el("h4", kind, label));
      if (!items.length) {
        if (!view.error) body.append(el("div", "wait", view.loading ? waitText : "No answers left."));
        return;
      }
      const list = el("div", `${kind}-list`);
      for (const s of items) {
        const button = el("button");
        button.title = s.note || "";
        build(button, s);
        button.addEventListener("click", () => onPick(s.answer));
        list.append(button);
      }
      body.append(list);
    };

    // RARE: the rarest answers. Alt+1 to Alt+3 select the first three.
    section("rare", "RARE", view.rare, "Searching…", (button, s) => {
      button.append(el("span", "a", s.answer));
      if (s.tier) button.append(el("span", "t", TIER_LABEL[s.tier] ?? s.tier));
    });
    // FAST: any correct answers. Alt+4 to Alt+6 select the first three.
    section("fast", "FAST", view.fast, "Getting answers…", (button, s) => {
      button.textContent = s.answer;
    });

    if (view.mode !== "party") return;
    const usedHead = el("h4", "used", `USED ${view.used.length}`);
    const plus = el("button", "", addOpen ? "×" : "+");
    plus.title = "Mark an answer as used";
    plus.addEventListener("click", () => {
      addOpen = !addOpen;
      paint(lastView);
      if (addOpen) body.querySelector(".add input")?.focus();
    });
    usedHead.append(plus);
    body.append(usedHead);
    if (view.used.length) {
      const used = el("div", "used-list");
      view.used.forEach((u, i) => {
        if (i) used.append(" · ");
        used.append(u.answer);
        if (u.by) used.append(" ", el("i", "", u.by));
      });
      body.append(used);
    }
    if (addOpen) {
      const add = el("div", "add");
      const input = el("input");
      input.placeholder = "answer that a player said…";
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key !== "Enter") return;
        const value = input.value.trim();
        if (value) onMarkUsed(value);
        input.value = "";
      });
      add.append(input);
      body.append(add);
    }
  }

  function render(view) {
    host.style.display = view.visible ? "" : "none";
    if (!view.visible) return;
    const signature = JSON.stringify(view);
    if (signature === lastSignature) return;
    // Do not paint again while the player types in the "used" box.
    if (addOpen && shadow.activeElement?.matches?.(".add input") && lastView) return;
    lastSignature = signature;
    lastView = view;
    paint(view);
  }

  return { render, host };
}
