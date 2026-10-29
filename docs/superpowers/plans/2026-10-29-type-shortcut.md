# Type Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On macOS, press ⌃⌥T in any app, type, press Return. The words go to MausBot's Quick asks chat (this computer or My Cloud) and the answer shows where the talk box shows, while the app the person was in stays the active app.

**Architecture:** A second key object (`createTypeShortcut`) sits beside talk's, with its own prefs, IPC and bridge. A new focusable panel window (`electron/talk-type-box.mjs`) takes the typing. It is destroyed the moment the words are sent, dropped or left, so key focus leaves with it. From Return on, the ask runs through talk's own session states and talk's never-focused box, which gains a two-line echo of the typed words. All wiring lives in `installTalk` (`electron/talk-main.mjs`), and `electron/main.mjs` does not change.

**Tech Stack:** Electron ^43.5.0 main (ESM `.mjs`, sandboxed preload `.cjs`), Node 24 `node:test` for `electron/*.node-test.mjs`, vitest + happy-dom for `src/`, React.

**Spec:** `docs/superpowers/specs/2026-10-29-type-shortcut-design.md`. It builds on `docs/superpowers/specs/2026-10-27-talk-shortcut-design.md` and `docs/superpowers/specs/2026-10-29-talk-on-my-cloud-design.md`.

## Global Constraints

- Node 24 for every command: prefix `PATH=/Users/omkar/.nvm/versions/node/v24.14.1/bin:$PATH`. Electron tests: `node --test electron/<file>.node-test.mjs`. Vitest: `pnpm exec vitest run <file>`. Then `pnpm typecheck`, `pnpm lint` and `pnpm i18n:check`.
- macOS only. Elsewhere ⌃⌥T is never registered, `typeShortcut.state().available` is false and the row is hidden. Windows is a later follow-up.
- Available when `platform === "darwin"`, this desktop is not a remote client, and talk's `reachable()` holds (home is this computer, or the verified My Cloud). Apple speech is not required.
- Keys, exactly: `ctrl-opt-t` → `Control+Alt+T`, `⌃⌥T` (default); `ctrl-shift-t` → `Control+Shift+T`, `⌃⇧T`; `opt-shift-t` → `Alt+Shift+T`, `⌥⇧T`. None overlaps a talk key.
- Independent of talk: `desktop-prefs.json` fields `typeShortcut` (absent = on) and `typeKey`, its own registration object, IPC `type-shortcut:state` / `type-shortcut:set`, bridge `window.ogb.typeShortcut`; talk off or talk's key taken never touches type, and the reverse.
- Only the typed words are sent, exactly as typed, in talk's body `{ text, threadId, sendId }`; talk marks nothing as spoken, so nothing marks an ask as typed; never an app name, selection or clipboard.
- The type box is `type: "panel"`, `focusable: true`, shown with `showInactive()` then `focus()`, never `show()`, and destroyed at once (no fade) on Return, Esc, ×, losing focus, idle and quit; talk's box keeps `focusable: false` and shows every typed ask from Return on.
- The box's page is as safe as talk's: a `data:` page under talk's CSP, text only via `textContent`/`value`, navigation and new windows refused, messages counted only from its own `webContents`, typed text going page → main → session → `server.ask`, never page → server.
- Timings: an empty box closes after 60 s; a draft lives 5 min, in memory only; a ⌃⌥T within 500 ms of the last is a key repeat; reply, notice and 120 s timings are talk's.
- Limit: 4,000 characters, as the textarea's `maxlength` and main's check (the composer has no limit to match).
- Echo: the typed words are the box's first lines, plain text clamped to 2 lines with an ellipsis; the reply keeps `replyPreview`'s 400 characters and clamps to 8 lines under an echo, so the card stays ≤ 240 px.
- Copy: the box's strings are English constants in main (`TYPE_BOX_TEXT` in `talk-type-box.mjs`, `TYPE_TEXT` in `talk-session.mjs`); Settings strings go only in `src/locales/en.json`.
- File sizes: `electron/main.mjs` is pinned at 3247 and is at 3247, and this plan changes no line of it; if a change becomes unavoidable it extends the existing `installTalk(...)` or `talk.start(...)` line, never adds one, and no number in `scripts/testing/file-size-ratchet.test.ts` is raised. `*.node-test.mjs` files count too, so type's box and session tests get new files.
- Modules under `node --test` never import `electron`; it is injected.
- Comments per AGENTS.md: only OS/Electron facts, public contracts and security invariants; no PR or issue numbers (`scripts/testing/comment-history.test.ts`).
- One commit per task: `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Never push.
- Ship gate: by-hand steps 25–28 of Task 7's recipe pass on a side-by-side build before any PR; if MausBot becomes the active app or its window comes forward, stop and report what `osascript` printed, and never work around it with `app.hide()` (it hides the MausBot window too).

## Review Focus

- ⌘ chords typed in the box (⌘Q, ⌘W, ⌘R, ⌘,, ⌘H, ⌘M): nothing happens (no quit, hide, reload, or Settings pulling the window forward), while ⌘A/⌘C/⌘V/⌘X/⌘Z, ⇧⌘Z, ⌘-arrows and ⌘⌫ still edit. Pinned in Task 1.
- Return while an input method is composing (Japanese, Chinese, Korean): it confirms the composition and sends nothing. Pinned in Task 2.
- The box's own close also fires `blur`: Return and Esc keep no draft, so the next ⌃⌥T opens empty, never with the words just sent or dropped. Pinned in Tasks 1 and 4.
- ⌃⌥T held down or double-tapped (hot keys can repeat): one box that stays open, never an open-close flicker. Pinned in Task 4.
- A paste over 4,000 characters, or a page message that isn't a string or is longer: the box keeps the first 4,000, exactly what it shows is sent, and anything else is ignored. Pinned in Tasks 1 and 2.

## Settled here (open or ambiguous in the spec)

- **Focus is given up at Return**, not once the reply shows. The anti-goals and Testing say "on send", and holding focus through a 45 s My Cloud wake would swallow keystrokes. "Typing is disabled while waiting" still holds, because the box that took the typing is gone.
- **"The same box" means the same place and look, in two windows.** The focusable type box is destroyed at Return, and talk's never-focused box takes over at the same bottom-centre spot. Nothing focusable outlives the typing, and talk's box keeps its behaviour.
- **The echo stays above the reply** as the box's first lines; the reply does not replace it.
- **⌃⌥Space while the type box is open does nothing**, because typing is type's listening. Over a typed reply, ⌃⌥Space listens, as it already does over a talk reply.
- **"Couldn't reach MausBot".** Talk's server-down line reads "Open MausBot to talk". A typed ask says "Couldn't reach MausBot. Try again in a moment." instead. Every other refusal uses talk's line.
- **Blank means empty or whitespace-only**, for Return, the ⌃⌥T toggle, the idle close and drafts.
- **The chat is prepared at Return, not at ⌃⌥T**, so an abandoned box never wakes My Cloud. A wake shows "Waking My Cloud…" under the echo.
- **Return drops the draft even when the ask is then refused**, following "Esc and Enter both drop the draft". Talk drops refused words the same way. × drops the draft, as Esc does.
- **No `.d.mts` for `talk-type-box.mjs`**, and none for the session: no TypeScript imports them.

## File Structure

| File | Responsibility |
| --- | --- |
| `electron/talk-panel.mjs`, `.d.mts` (modify) | shares its colours, mascot and window marking; the echo line |
| `electron/talk-type-box.mjs` (new) | the focusable type box window, its page, the chord guard and key rule |
| `electron/talk-type-box-preload.cjs` (new) | the page's bridge: `input`, `send`, `cancel` |
| `electron/talk-keys.mjs` (modify) | type key presets |
| `electron/desktop-prefs.mjs`, `.d.mts` (modify) | `typeShortcut`, `typeKey` |
| `electron/talk-shortcut.mjs`, `.d.mts` (modify) | one registration core under `createTalkShortcut` and `createTypeShortcut` |
| `electron/talk-session.mjs` (modify) | the typing state, draft, idle and repeat rules; typed asks through talk's states |
| `electron/talk-main.mjs` (modify) | type box, type key and `type-shortcut:*` IPC inside `installTalk` |
| `electron/preload.cjs`, `src/types/ogb.d.ts` (modify) | the `typeShortcut` bridge |
| `src/components/TalkShortcutRow.tsx`, `SettingsModal.tsx`, `SettingsSimplePages.tsx`, `src/locales/en.json` (modify) | the Type row under the Talk row |
| `scripts/talk-box-evidence.mjs`, `docs/verification/talk-shortcut.md`, `docs/verification/README.md` (modify) | echo evidence and the Type recipe |
| `electron/talk-type-box.node-test.mjs`, `electron/talk-type-session.node-test.mjs` (new) | type box and type session tests |

---

### Task 1: The type box takes key focus without activating MausBot

**Files:**
- Modify: `electron/talk-panel.mjs:7,20-24,57-60,90-95`, `electron/talk-panel.d.mts`
- Create: `electron/talk-type-box.mjs`, `electron/talk-type-box-preload.cjs`
- Test: `electron/talk-type-box.node-test.mjs`

**Interfaces:**
- Consumes: `talkPanelBounds(workArea, height)`, `TALK_PANEL` and `isTalkPanel(win)` from `talk-panel.mjs`.
- Produces in `talk-panel.mjs`: `markTalkPanel(win): void` (joins the set `isTalkPanel` reads, so main's `appWindows()` leaves the type box out); `mascotPng(nativeImage, iconPath): string` (base64 PNG, 56 px); `TALK_BOX_THEME_CSS: string` (the `:root`, `body`, `body.light` and light media-query lines of talk's page, verbatim).
- Produces in `talk-type-box.mjs`: `TYPE_LIMIT = 4000`; `blockedChord(input: { type: string; key: string; meta?: boolean }): boolean`; `typeBoxHtml(iconBase64: string): string`; `createTypeBox({ BrowserWindow, screen, nativeImage, iconPath, theme = null, onInput(text), onSend(text), onCancel(), onBlur() }): { open(view: { text: string }): void; close(): void; setTheme(theme: "light" | "dark" | null): void }`.
- Produces, page → main, counted only from the open box's own `webContents`: `type-box:input` (text, height), `type-box:send` (text), `type-box:cancel`. Main → page: `start({ text, theme? })`, returning the card's height in px.

- [ ] **Step 1: Install dependencies** (this worktree has no `node_modules`)

Run: `PATH=/Users/omkar/.nvm/versions/node/v24.14.1/bin:$PATH pnpm install --frozen-lockfile`
Expected: completes. Then `node --test electron/preload.node-test.mjs` passes; before the install it failed with "Cannot find module 'electron'".

- [ ] **Step 2: Fingerprint talk's page before sharing its pieces**

Run: `node -e 'import("./electron/talk-panel.mjs").then(m => console.log(require("node:crypto").createHash("sha256").update(m.talkPanelHtml("AAAA")).digest("hex")))'`
Expected: a hash. Keep it for Step 6.

- [ ] **Step 3: Write the failing tests**

Build the harness in `electron/talk-type-box.node-test.mjs`:
- Copy `harness()`, `FakeBrowserWindow`, `flush` and `pick` from `talk-panel.node-test.mjs`.
- Also record `moveTop` in `calls`.
- Add a `startFails` option (its `executeJavaScript` rejects) and a `theme` option.
- Build with `createTypeBox`. The four callbacks push `["input", text]`, `["send", text]`, `["cancel"]` and `["blur"]` into `events`.

```js
const SHOWING = ["show", "showInactive", "focus", "moveTop"];
const shown = win => win.calls.map(c => c[0]).filter(n => SHOWING.includes(n));
const prevent = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

test("the type box is a focusable panel on every Space, made key only after it shows inactive", async () => {
  const { box, made } = harness({ cursor: { x: 2000, y: 500 }, workArea: { x: 1440, y: 25, width: 1440, height: 875 } });
  box.open({ text: "" });
  const win = made[0];
  assert.deepEqual(pick(win.options, ["type", "focusable", "transparent", "frame", "skipTaskbar", "hasShadow", "resizable", "movable", "fullscreenable", "show", "acceptFirstMouse", "hiddenInMissionControl"]),
    { type: "panel", focusable: true, transparent: true, frame: false, skipTaskbar: true, hasShadow: false, resizable: false, movable: false, fullscreenable: false, show: false, acceptFirstMouse: true, hiddenInMissionControl: true });
  assert.deepEqual(pick(win.options.webPreferences, ["contextIsolation", "sandbox", "nodeIntegration", "spellcheck"]), { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false });
  assert.ok(win.options.webPreferences.preload.endsWith("talk-type-box-preload.cjs"));
  assert.ok(isTalkPanel(win) && win.excludedFromShownWindowsMenu === true);
  assert.deepEqual(win.calls.filter(c => c[0] !== "setBounds"), [["setAlwaysOnTop", true, "screen-saver"], ["setVisibleOnAllWorkspaces", true, { visibleOnFullScreen: true, skipTransformProcessType: true }]]);
  win.webContents.emit("did-finish-load"); await flush();
  assert.equal(win.webContents.scripts[0], 'start({"text":""})');
  assert.deepEqual(win.bounds, { x: 1960, y: 780, width: 400, height: 96 });
  assert.deepEqual(shown(win), ["showInactive", "focus"]);
});

test("a draft opens with its words in the app's skin", async () => {
  const { box, made } = harness({ theme: "dark" });
  box.open({ text: "half" }); made[0].webContents.emit("did-finish-load"); await flush();
  assert.equal(made[0].webContents.scripts[0], 'start({"text":"half","theme":"dark"})');
});

test("closing gives up focus at once: destroyed with no fade, and its blur and late messages are never reported", async () => {
  const { box, made, events } = harness();
  box.open({ text: "draft" }); made[0].webContents.emit("did-finish-load"); await flush();
  box.close();
  assert.equal(made[0].destroyed, true);
  assert.ok(!made[0].webContents.scripts.includes("fadeOut()"));
  made[0].events.emit("blur");
  made[0].webContents.emit("ipc-message", {}, "type-box:send", "late");
  assert.deepEqual(events, []);
});

test("a box that loses focus, or can't start its page, says so once; a second open replaces the first", async () => {
  const { box, made, events } = harness();
  box.open({ text: "" }); made[0].events.emit("blur");
  assert.deepEqual(events, [["blur"]]);
  box.open({ text: "" });
  assert.deepEqual([made[0].destroyed, made.length], [true, 2]);
  made[0].events.emit("blur");
  assert.equal(events.length, 1);
  const failing = harness({ startFails: true });
  failing.box.open({ text: "x" }); failing.made[0].webContents.emit("did-finish-load"); await flush();
  assert.deepEqual([failing.made[0].destroyed, failing.events, shown(failing.made[0])], [true, [["blur"]], []]);
});

test("the page's messages count only from this box, and only when well formed", () => {
  const { box, made, events } = harness();
  box.open({ text: "" });
  const page = made[0].webContents;
  page.emit("ipc-message", {}, "type-box:input", "hi", 120);
  page.emit("ipc-message", {}, "type-box:input", { text: "hi" }, 130);
  page.emit("ipc-message", {}, "type-box:send", "x".repeat(4001));
  page.emit("ipc-message", {}, "type-box:send", 42);
  page.emit("ipc-message", {}, "type-box:send", "x".repeat(4000));
  page.emit("ipc-message", {}, "type-box:cancel");
  page.emit("ipc-message", {}, "talk-panel:open");
  assert.deepEqual(events, [["input", "hi"], ["send", "x".repeat(4000)], ["cancel"]]);
  assert.equal(made[0].bounds.height, 120);
  page.emit("ipc-message", {}, "type-box:input", "hi", 900);
  page.emit("ipc-message", {}, "type-box:input", "hi", Number.NaN);
  assert.equal(made[0].bounds.height, 240);
  const preload = readFileSync(new URL("./talk-type-box-preload.cjs", import.meta.url), "utf8");
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.(\w+)\("([^"]+)"/g)].map(m => [m[1], m[2]]),
    [["send", "type-box:input"], ["send", "type-box:send"], ["send", "type-box:cancel"]]);
});

test("⌘ chords other than editing ones never reach the page or the app's menu", () => {
  const cmd = (key, more = {}) => ({ type: "keyDown", key, meta: true, ...more });
  for (const key of ["q", "w", "r", ",", "h", "m", "n", "0", "=", "`", "ˆ"]) assert.equal(blockedChord(cmd(key)), true, key);
  for (const input of [cmd("a"), cmd("c"), cmd("v"), cmd("x"), cmd("z"), cmd("Z", { shift: true }), cmd("ArrowLeft"), cmd("Backspace"), cmd("Enter"),
    { type: "keyDown", key: "q" }, { type: "keyDown", key: "a", control: true }, { type: "keyUp", key: "q", meta: true }]) {
    assert.equal(blockedChord(input), false, JSON.stringify(input));
  }
  const { box, made } = harness();
  box.open({ text: "" });
  const stopped = input => { const event = prevent(); made[0].webContents.emit("before-input-event", event, input); return event.defaultPrevented; };
  assert.deepEqual([stopped(cmd("q")), stopped(cmd("v"))], [true, false]);
});

test("navigation and new windows are refused; the page is plain text under talk's policy and colours", () => {
  const { box, made } = harness();
  box.open({ text: "" });
  const event = prevent();
  made[0].webContents.emit("will-navigate", event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(made[0].openHandler(), { action: "deny" });
  const html = typeBoxHtml("AAAA");
  assert.match(html, /default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/);
  assert.match(html, /<textarea id="field"[^>]*maxlength="4000"/);
  assert.ok(html.includes(TALK_BOX_THEME_CSS));
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|outerHTML|https?:\/\//);
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `node --test electron/talk-type-box.node-test.mjs`
Expected: FAIL with "Cannot find module './talk-type-box.mjs'".

- [ ] **Step 5: Implement**

- `talk-panel.mjs`: move the four colour lines into `TALK_BOX_THEME_CSS` and interpolate it where they were; export `mascotPng`; add `markTalkPanel(win)`; declare the three in `talk-panel.d.mts`.
- `createTypeBox`: the window options and setup the first test pins, plus `markTalkPanel`; deny new windows; prevent `will-navigate`; `before-input-event` → `preventDefault()` when `blockedChord(input)`; act on `ipc-message`, `blur`, `render-process-gone` and `closed` only while that window is the open one; `did-finish-load` → `start(<JSON>)` → `setBounds(talkPanelBounds(area, height))` → `showInactive()` → `focus()`. `close()` forgets the window, then `destroy()`s it. Going away on its own (blur, failed `start`, renderer gone, closed from outside) reports `onBlur()` once, and the box destroys itself in each case but blur (after a blur the session closes it). `setTheme` sets the skin for the next `open`.
- `blockedChord(input)`: `input.type === "keyDown" && input.meta === true && [...input.key].length === 1 && !"acvxz".includes(input.key.toLowerCase())`.
- Comments carry the Electron facts: on macOS `focus()` on a `panel` window makes it key without activating the app (unit tests can't prove it); `preventDefault()` in `before-input-event` also stops the app menu's shortcut, and `setIgnoreMenuShortcuts` is not used because Electron's macOS text fields get ⌘C/⌘V/⌘X/⌘A/⌘Z from the Edit menu.
- `typeBoxHtml(iconBase64)`, a skeleton Task 2 extends: talk's CSP and `TALK_BOX_THEME_CSS`; a card like talk's (radius, border, padding, 28 px mascot) holding `<textarea id="field" rows="1" maxlength="4000">` (from `TYPE_LIMIT`); `start(view)` sets `document.body.className` to `on` plus the theme, the value, focus with the caret at the end, and returns `Math.ceil(card.getBoundingClientRect().height)`.
- `talk-type-box-preload.cjs` exposes `window.typeBox` with `input(text, height)`, `send(text)` and `cancel()`, each one `ipcRenderer.send` on its channel with `String(text)` and `Number(height)`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test electron/talk-type-box.node-test.mjs electron/talk-panel.node-test.mjs electron/talk-main.node-test.mjs`
Expected: PASS. Step 2's command prints the same hash.

- [ ] **Step 7: Commit**

```bash
git add electron/talk-panel.mjs electron/talk-panel.d.mts electron/talk-type-box.mjs electron/talk-type-box-preload.cjs electron/talk-type-box.node-test.mjs
git commit -m "feat(type): a focusable panel that takes typing without activating MausBot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Typing in the box

**Files:**
- Modify: `electron/talk-type-box.mjs`
- Test: `electron/talk-type-box.node-test.mjs`

**Interfaces:**
- Consumes: Task 1's page skeleton and `start(view)`, `TYPE_LIMIT`, and the page's `window.typeBox`.
- Produces:
  - `typeBoxKey(event: { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number }): "send" | "cancel" | null`
  - `TYPE_BOX_TEXT = Object.freeze({ placeholder: "Type to MausBot, then press Return", label: "Ask MausBot", dismiss: "Dismiss" })`
- The page script uses only this surface, so a test can run it in `node:vm`:
  - `document.getElementById("card" | "field" | "close")` and `document.body.className`;
  - on those elements: `addEventListener`, `value`, `readOnly`, `style`, `scrollHeight`, `focus()`, `setSelectionRange()` and `getBoundingClientRect()`.

- [ ] **Step 1: Write the failing tests**

`runPage(html)` runs the page's `<script>` with `vm.runInNewContext`:
- Fake elements have exactly that surface. `scrollHeight` is 18 and `getBoundingClientRect()` returns `{ height: 56 }`. `setSelectionRange` records `selection`.
- `window.typeBox` records `["input", text, height]`, `["send", text]` and `["cancel"]` in `calls`.
- `key(init)` fires the field's `keydown` listener with a recording `preventDefault` and returns the event.
- `fire(id, type)` fires another listener.

```js
test("Return sends, Shift+Return makes a line, Esc closes; while an input method composes, both only finish the composition", () => {
  assert.equal(typeBoxKey({ key: "Enter" }), "send");
  assert.equal(typeBoxKey({ key: "Enter", shiftKey: true }), null);
  assert.equal(typeBoxKey({ key: "Escape" }), "cancel");
  assert.equal(typeBoxKey({ key: "Enter", isComposing: true }), null);
  assert.equal(typeBoxKey({ key: "Enter", keyCode: 229 }), null);
  assert.equal(typeBoxKey({ key: "Escape", isComposing: true }), null);
  assert.equal(typeBoxKey({ key: "a" }), null);
  assert.ok(typeBoxHtml("AAAA").includes(String(typeBoxKey)), "the page runs this rule, not a copy of it");
});

test("the page sends only words, once, then stops taking typing", () => {
  const page = runPage(typeBoxHtml("AAAA"));
  assert.equal(typeof page.start({ text: "half", theme: "dark" }), "number");
  assert.deepEqual([page.field.value, page.field.selection, page.body.className], ["half", [4, 4], "on dark"]);
  page.field.value = "  \n ";
  assert.equal(page.key({ key: "Enter" }).defaultPrevented, true, "a blank Return types no line either");
  assert.equal(page.key({ key: "Enter", shiftKey: true }).defaultPrevented, false);
  page.field.value = "日本";
  assert.equal(page.key({ key: "Enter", isComposing: true }).defaultPrevented, false);
  assert.deepEqual(page.calls, []);
  page.field.value = "what's on\ntoday";
  page.key({ key: "Enter" }); page.key({ key: "Enter" });
  assert.deepEqual(page.calls, [["send", "what's on\ntoday"]]);
  assert.equal(page.field.readOnly, true);
});

test("Esc and × close; every change reports the words and the card's height", () => {
  const page = runPage(typeBoxHtml("AAAA"));
  page.start({ text: "" });
  page.field.value = "abc"; page.fire("field", "input");
  page.key({ key: "Escape" }); page.fire("close", "click");
  assert.deepEqual(page.calls, [["input", "abc", 56], ["cancel"], ["cancel"]]);
});

test("the field grows to six lines, then scrolls, inside the tallest box, and says what it is for", () => {
  const html = typeBoxHtml("AAAA");
  assert.match(html, /<textarea id="field"[^>]*rows="1"[^>]*maxlength="4000"/);
  assert.match(html, /#field\{[^}]*max-height:calc\(6 \* 1\.4em\)[^}]*overflow-y:auto/);
  assert.match(html, /placeholder="Type to MausBot, then press Return"/);
  assert.match(html, /aria-label="Ask MausBot"/);
  assert.match(html, /<button id="close" type="button" aria-label="Dismiss"/);
  assert.ok(28 + 2 + 6 * 18.2 <= TALK_PANEL.maxHeight);
  assert.deepEqual(TYPE_BOX_TEXT, { placeholder: "Type to MausBot, then press Return", label: "Ask MausBot", dismiss: "Dismiss" });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test electron/talk-type-box.node-test.mjs`
Expected: FAIL with "typeBoxKey is not exported" (or similar).

- [ ] **Step 3: Implement the key rule and the page**

`typeBoxKey` is what the first test says; it must stay self-contained, because the page embeds it as `${typeBoxKey}`. The page handles events like this:

| Event | What the page does |
| --- | --- |
| keydown, `"send"` | `preventDefault()`. If the field isn't read-only and `value.trim()` is non-empty, set `readOnly = true` and call `typeBox.send(value)`. |
| keydown, `"cancel"` | `preventDefault()`, then `typeBox.cancel()`. |
| `input` | Grow the field (`style.height = "auto"`, then `scrollHeight` px; the CSS caps it at six lines and scrolls), then call `typeBox.input(value, height)`. |
| click on × | `typeBox.cancel()`. |
| `start()` | Also grows the field, but reports nothing. |

The attributes take their copy from `TYPE_BOX_TEXT`. They are constants, so no user text reaches the markup.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test electron/talk-type-box.node-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/talk-type-box.mjs electron/talk-type-box.node-test.mjs
git commit -m "feat(type): Return, Shift+Return, Esc, six lines and 4,000 characters in the type box" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Type keys, prefs and registration

**Files:**
- Modify: `electron/talk-keys.mjs`, `electron/desktop-prefs.mjs:7,58-59,111-118`, `electron/desktop-prefs.d.mts:46-51`, `electron/talk-shortcut.mjs:1-39`, `electron/talk-shortcut.d.mts`
- Test: `electron/talk-shortcut.node-test.mjs`, `electron/desktop-prefs.node-test.mjs`

**Interfaces:**
- Produces in `talk-keys.mjs`: `TYPE_KEYS` (frozen `{ [id]: { accelerator, label } }`, the three keys of Global Constraints in that order), `DEFAULT_TYPE_KEY = "ctrl-opt-t"`, `isTypeKey(id): boolean`.
- Produces on `DesktopPrefs`: `typeShortcut(): boolean` (true until switched off), `setTypeShortcut(enabled: boolean): void`, `typeKey(): TypeKeyId`, `setTypeKey(id: unknown): boolean` (false, and nothing saved, for anything but a type key).
- Produces in `talk-shortcut.mjs`: `createTypeShortcut({ globalShortcut, prefs, available, onPress }): { state(): TypeShortcutState; set(change: { enabled?: unknown; key?: unknown }): TypeShortcutState; refresh(): void; close(): void }` and `TYPE_SHORTCUT_UNAVAILABLE`; `createTalkShortcut` keeps its API, `releaseModifiers` included.
- Produces in `talk-shortcut.d.mts`: `TypeKeyId = "ctrl-opt-t" | "ctrl-shift-t" | "opt-shift-t"`; `ShortcutState<K extends string>` (today's `TalkShortcutState` fields); `TalkShortcutState extends ShortcutState<TalkKeyId>`; `TypeShortcutState extends ShortcutState<TypeKeyId>`; `TypeShortcutChange { enabled?: boolean; key?: TypeKeyId }`; `TypeShortcutBridge { state(): Promise<TypeShortcutState>; set(change: TypeShortcutChange): Promise<TypeShortcutState> }`.

- [ ] **Step 1: Write the failing tests**

In `desktop-prefs.node-test.mjs`:

```js
test("the type shortcut is on with ⌃⌥T until changed, apart from talk's, and survives a restart", () => {
  let saved = null;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); } });
  assert.deepEqual([prefs.typeShortcut(), prefs.typeKey()], [true, "ctrl-opt-t"]);
  prefs.setTalkShortcut(false);
  assert.equal(prefs.typeShortcut(), true);
  prefs.setTypeShortcut(false);
  assert.equal(prefs.setTypeKey("opt-shift-t"), true);
  assert.equal(prefs.setTypeKey("ctrl-opt-space"), false, "a talk key is not a type key");
  const restarted = createDesktopPrefs({ read: () => saved, write: () => {} });
  assert.deepEqual([restarted.typeShortcut(), restarted.typeKey(), restarted.talkShortcut()], [false, "opt-shift-t", false]);
  const junk = createDesktopPrefs({ read: () => ({ typeShortcut: "off", typeKey: "toString" }), write: () => {} });
  assert.deepEqual([junk.typeShortcut(), junk.typeKey()], [true, "ctrl-opt-t"]);
});
```

In `talk-shortcut.node-test.mjs`, reusing its `memoryPrefs` and `fakeShortcuts`:

```js
const TYPE_KEYS = [{ id: "ctrl-opt-t", label: "⌃⌥T" }, { id: "ctrl-shift-t", label: "⌃⇧T" }, { id: "opt-shift-t", label: "⌥⇧T" }];

test("the type shortcut registers ⌃⌥T when on, and a press reaches onPress", () => {
  const shortcuts = fakeShortcuts(); let presses = 0;
  const type = createTypeShortcut({ globalShortcut: shortcuts, prefs: memoryPrefs(), available: () => true, onPress: () => { presses += 1; } });
  assert.deepEqual([...shortcuts.registered.keys()], ["Control+Alt+T"]);
  shortcuts.registered.get("Control+Alt+T")();
  assert.equal(presses, 1);
  assert.deepEqual(type.state(), { available: true, enabled: true, key: "ctrl-opt-t", keys: TYPE_KEYS, taken: false });
  assert.equal("releaseModifiers" in type, false);
});

test("talk and type keep their own setting and key: one off, taken or changed leaves the other", () => {
  const shortcuts = fakeShortcuts(["Control+Alt+Space"]); const prefs = memoryPrefs();
  const talk = createTalkShortcut({ globalShortcut: shortcuts, prefs, available: () => true, onPress: () => {} });
  const type = createTypeShortcut({ globalShortcut: shortcuts, prefs, available: () => true, onPress: () => {} });
  assert.deepEqual([talk.state().taken, type.state().taken], [true, false]);
  talk.set({ enabled: false });
  assert.deepEqual([...shortcuts.registered.keys()], ["Control+Alt+T"]);
  assert.equal(type.set({ key: "ctrl-shift-t" }).key, "ctrl-shift-t");
  assert.deepEqual([...shortcuts.registered.keys()], ["Control+Shift+T"]);
  assert.equal(type.set({ key: "ctrl-opt-space" }).key, "ctrl-shift-t");
  assert.equal(prefs.talkKey(), "ctrl-opt-space");
});

test("an unavailable type shortcut lets its key go, refresh takes it back, and close lets it go", () => {
  const shortcuts = fakeShortcuts(); let offered = false;
  const type = createTypeShortcut({ globalShortcut: shortcuts, prefs: memoryPrefs(), available: () => offered, onPress: () => {} });
  assert.deepEqual([type.state().available, [...shortcuts.registered.keys()]], [false, []]);
  offered = true; type.refresh();
  assert.deepEqual([...shortcuts.registered.keys()], ["Control+Alt+T"]);
  type.close();
  assert.deepEqual([...shortcuts.registered.keys()], []);
  assert.deepEqual(TYPE_SHORTCUT_UNAVAILABLE, { available: false, enabled: false, key: "ctrl-opt-t", keys: TYPE_KEYS, taken: false });
  assert.ok(Object.isFrozen(TYPE_SHORTCUT_UNAVAILABLE));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test electron/talk-shortcut.node-test.mjs electron/desktop-prefs.node-test.mjs`
Expected: FAIL. `createTypeShortcut` is not exported and `prefs.typeShortcut` is not a function.

- [ ] **Step 3: Implement**

- `talk-shortcut.mjs`:
  - Add a private `createKeyShortcut({ globalShortcut, keys, enabled, setEnabled, key, setKey, available, onPress })`. It holds today's body, over a key table and four pref accessors.
  - `createTalkShortcut` is that core plus `releaseModifiers`.
  - `createTypeShortcut` is the same core over `TYPE_KEYS` and the type prefs.
- `desktop-prefs.mjs`: `parse()` keeps `typeShortcut` only when it is a boolean, and `typeKey` only when `isTypeKey` holds. Write the accessors next to talk's.
- `.d.mts`: write the types in Interfaces. On `ShortcutState.available`, say that talk also needs Apple speech.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test electron/talk-shortcut.node-test.mjs electron/desktop-prefs.node-test.mjs electron/talk-main.node-test.mjs && pnpm typecheck`
Expected: PASS. Talk's own tests pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add electron/talk-keys.mjs electron/desktop-prefs.mjs electron/desktop-prefs.d.mts electron/talk-shortcut.mjs electron/talk-shortcut.d.mts electron/talk-shortcut.node-test.mjs electron/desktop-prefs.node-test.mjs
git commit -m "feat(type): ⌃⌥T presets, prefs and registration apart from talk's" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A typed ask, from ⌃⌥T to the reply

**Files:**
- Modify: `electron/talk-session.mjs:44-74,110-115,157-220`, `electron/talk-panel.mjs:54-88,162-178`, `electron/talk-panel.d.mts:3-6`
- Create test: `electron/talk-type-session.node-test.mjs`
- Modify test: `electron/talk-panel.node-test.mjs`

**Interfaces:**
- Consumes: the box contract from Tasks 1–2, `typeBox.open({ text })` and `typeBox.close()`. Task 5 wires the box's four callbacks to the session methods below.
- Produces:
  - `createTalkSession({ speech, server, panel, typeBox, voiceInUse, release, openChat, newSendId, now = () => Date.now() })` gains `typePress(): void`, `typeInput(text: string): void`, `typeSend(text: string): void`, `typeCancel(): void` and `typeBlurred(): void`.
  - `busy()` is also true while the box takes words.
  - `TYPE_TIMING = { idleMs: 60_000, draftMs: 300_000, repeatMs: 500 }` and `TYPE_TEXT = { serverDown: "Couldn't reach MausBot. Try again in a moment." }`, both frozen.
  - A typed ask's panel views are `{ state, text, echo }`. `echo` is the typed words. `text` is `""` in `waking`, `sending` and `thinking`, and otherwise whatever talk shows. Talk's asks keep `{ state, text }`.
  - `TalkView` gains `echo?: string`. `render()` sends the page `{ state, text, echo?, theme? }`, in that key order.

The session's rules (`lastTypePress` starts at `-Infinity`):

| Event | While | Then |
| --- | --- | --- |
| `typePress` | under 500 ms since the last `typePress` | nothing (the time still counts as the last) |
| `typePress` | typing, words blank | close the box |
| `typePress` | typing, with words | nothing |
| `typePress` | listening, waking, sending, thinking | nothing |
| `typePress` | nothing shows, or a reply, needs-you, still-working or error box | close that box; open the type box with the draft when under 5 min old, else `""`; the draft is used up |
| `press` (talk) | typing | nothing (`"typing"` joins `UNDER_WAY`) |
| `typeInput(text)` | typing | words = text; the 60 s clock restarts while the words are blank and stops otherwise |
| `typeSend(text)` | typing, `text.trim()` non-empty | drop the draft, close the type box, `prepare(ask)`, then talk's `send()` |
| `typeSend` | typing, blank | nothing; the box stays |
| `typeCancel` | typing | drop the draft; close |
| `typeBlurred` | typing | draft = `{ words, at: now() }` unless blank; close |
| any `type*` | not typing | nothing |
| idle 60 s | typing, blank | close |
| `dismiss` / `close` | typing | close the type box |
| `server-down` | typed ask | `TYPE_TEXT.serverDown`, hidden after 4 s |

`prepare(ask)` is talk's `onWaking` and failure wiring, moved out of `listen()` unchanged; `listen()` calls it too. `closeBox(ask)` closes the type box for a typing ask and talk's box otherwise. `typeBox.open` and `typeBox.close` are each wrapped like `panel.render`. If `open` throws, no ask stays current.

- [ ] **Step 1: Write the failing session tests** in `electron/talk-type-session.node-test.mjs`

Copy `talk-session.node-test.mjs`'s harness, `flush`, `pick`, `CHAT`, `say`, `release` and `holdAsk`; give the harness `typeBox: { open: view => { h.typed.push(view); if (h.openFails) throw new Error("no box"); }, close: () => { h.typeClosed += 1; } }`, and enable `mock.timers.enable({ apis: ["setTimeout", "Date"] })` in `beforeEach`.

```js
test("type timings and the typed server-down line are fixed", () => {
  assert.deepEqual(TYPE_TIMING, { idleMs: 60_000, draftMs: 300_000, repeatMs: 500 });
  assert.deepEqual(TYPE_TEXT, { serverDown: "Couldn't reach MausBot. Try again in a moment." });
  assert.ok(Object.isFrozen(TYPE_TIMING) && Object.isFrozen(TYPE_TEXT));
});

test("⌃⌥T opens an empty box; Return sends exactly the typed words to Quick asks, echoed through talk's states", async () => {
  const h = harness(); const words = "what's on\n today ";
  h.session.typePress();
  assert.deepEqual([h.typed, h.prepares], [[{ text: "" }], 0]);
  h.session.typeInput("what's on"); h.session.typeSend(words); await flush();
  assert.equal(h.typeClosed, 1);
  assert.deepEqual(pick(h.asks[0], ["chat", "text", "sendId"]), { chat: CHAT, text: words, sendId: "send-1" });
  assert.deepEqual([...new Set(h.views.map(v => v.state))], ["sending", "thinking", "reply"]);
  assert.deepEqual([h.views[0], h.views.at(-1)], [{ state: "sending", text: "", echo: words }, { state: "reply", text: "Hi", echo: words }]);
  assert.ok(h.views.every(v => v.echo === words));
  mock.timers.tick(12_000); assert.equal(h.closed, 1);
});

test("Return on a blank box does nothing, and the box stays", () => {
  const h = harness(); h.session.typePress(); h.session.typeInput("  \n ");
  h.session.typeSend("  \n ");
  assert.deepEqual([h.prepares, h.typeClosed, h.views.length, h.session.busy()], [0, 0, 0, true]);
});

test("Esc keeps no draft, and neither does the blur that follows Esc or Return", async () => {
  const h = harness();
  h.session.typePress(); h.session.typeInput("never mind"); h.session.typeCancel(); h.session.typeBlurred();
  assert.deepEqual([h.typeClosed, h.prepares], [1, 0]);
  mock.timers.tick(1_000); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "" });
  h.session.typeInput("ask this"); h.session.typeSend("ask this"); h.session.typeBlurred(); await flush();
  mock.timers.tick(12_000); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "" });
});

test("clicking away closes the box and keeps the words for 5 minutes", () => {
  const h = harness();
  h.session.typePress(); h.session.typeInput("half a thought"); h.session.typeBlurred();
  assert.equal(h.typeClosed, 1);
  mock.timers.tick(299_999); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "half a thought" });
  h.session.typeBlurred();
  mock.timers.tick(300_000); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "" });
});

test("⌃⌥T on an open box closes it when blank and does nothing when it holds words", () => {
  const h = harness();
  h.session.typePress(); mock.timers.tick(500); h.session.typeInput("keep"); h.session.typePress();
  assert.equal(h.typeClosed, 0);
  mock.timers.tick(500); h.session.typeInput(" "); h.session.typePress();
  assert.equal(h.typeClosed, 1);
});

test("a ⌃⌥T within 500 ms of the last one is a key repeat: one box stays open", () => {
  const h = harness();
  h.session.typePress(); mock.timers.tick(300); h.session.typePress(); mock.timers.tick(400); h.session.typePress();
  assert.deepEqual([h.typed.length, h.typeClosed], [1, 0]);
  mock.timers.tick(500); h.session.typePress();
  assert.equal(h.typeClosed, 1);
});

test("a blank box closes itself after 60 s; words stop the clock and clearing them starts it again", () => {
  const h = harness();
  h.session.typePress(); mock.timers.tick(59_999); assert.equal(h.typeClosed, 0);
  mock.timers.tick(1); assert.equal(h.typeClosed, 1);
  mock.timers.tick(1_000); h.session.typePress(); h.session.typeInput("a");
  mock.timers.tick(120_000); assert.equal(h.typeClosed, 1);
  h.session.typeInput(""); mock.timers.tick(60_000); assert.equal(h.typeClosed, 2);
});

test("one ask at a time: ⌃⌥T waits while talk listens or an ask is on its way, and ⌃⌥Space waits while the box takes words or a typed ask is on its way", async () => {
  const { ask } = holdAsk([]);
  const h = harness({ ask });
  h.session.press(); h.session.typePress();
  say(h, "hello"); release(h); await flush();
  mock.timers.tick(600); h.session.typePress();
  assert.equal(h.typed.length, 0);
  const t = harness({ ask });
  t.session.typePress(); t.session.press();
  t.session.typeSend("hi"); await flush(); t.session.press();
  assert.deepEqual([t.starts.length, t.session.busy()], [0, true]);
});

test("⌃⌥T over a reply opens a fresh box; ⌃⌥Space over a typed reply listens", async () => {
  const h = harness();
  h.session.press(); say(h, "hi"); release(h); await flush();
  h.session.typePress();
  assert.deepEqual([h.closed, h.typed.length], [1, 1]);
  h.session.typeSend("and you?"); await flush();
  h.session.press();
  assert.deepEqual([h.closed, h.views.at(-1)], [2, { state: "listening", text: "" }]);
});

test("a typed ask gets talk's refusals with its words echoed; this computer's server down says Couldn't reach MausBot", async () => {
  for (const [code, text] of [["server-down", TYPE_TEXT.serverDown], ["starting", TALK_TEXT.starting], ["no-mausbot", TALK_TEXT.noMausbot], ["moved", TALK_TEXT.moved],
    ["cloud-down", TALK_TEXT.cloudDown], ["cloud-waking", TALK_TEXT.cloudWaking], ["wake-failed", TALK_TEXT.wakeFailed], ["cloud-signin", TALK_TEXT.cloudSignIn]]) {
    const h = harness({ prepare: async () => { throw new TalkServerError(code); } });
    h.session.typePress(); h.session.typeSend("hi"); await flush();
    assert.deepEqual(h.views.at(-1), { state: "error", text, echo: "hi" }, code);
    mock.timers.tick(4_000); assert.equal(h.closed, 1, code);
  }
});

test("a typed ask that wakes My Cloud says so under the echo, then sends once", async () => {
  let wake, ready;
  const h = harness({ prepare: onWaking => { wake = onWaking; return new Promise(resolve => { ready = resolve; }); } });
  h.session.typePress(); h.session.typeSend("hi"); wake();
  assert.deepEqual(h.views.at(-1), { state: "waking", text: "", echo: "hi" });
  ready(CHAT); await flush();
  assert.deepEqual(h.views.map(v => v.state).slice(0, 3), ["sending", "waking", "sending"]);
  assert.equal(h.asks.length, 1);
});

test("the box's words, send, cancel and blur do nothing with no box open; a box that fails to open leaves ⌃⌥T working", () => {
  const h = harness();
  h.session.typeInput("x"); h.session.typeSend("x"); h.session.typeCancel(); h.session.typeBlurred();
  assert.deepEqual([h.prepares, h.typeClosed, h.views.length], [0, 0, 0]);
  h.openFails = true; h.session.typePress();
  assert.equal(h.session.busy(), false);
  h.openFails = false; mock.timers.tick(500); h.session.typePress();
  assert.deepEqual([h.typed.length, h.session.busy()], [2, true]);
});

test("busy while the box takes words, so a quiet update waits; quitting closes the box", () => {
  const h = harness(); h.session.typePress();
  assert.equal(h.session.busy(), true);
  h.session.close();
  assert.deepEqual([h.typeClosed, h.session.busy()], [1, false]);
});

test("clicking a typed reply opens its Quick asks chat", async () => {
  const h = harness(); h.session.typePress(); h.session.typeSend("hi"); await flush();
  h.session.open();
  assert.deepEqual(h.opened, [CHAT]);
});
```

- [ ] **Step 2: Write the failing echo test** in `electron/talk-panel.node-test.mjs`

```js
test("a typed ask's words show above the label in two lines at most, as plain text, and the reply fits under them", async () => {
  const { panel, made } = harness();
  panel.render({ state: "sending", text: "", echo: "<b>what's on</b>" });
  made[0].webContents.emit("did-finish-load"); await flush();
  assert.equal(made[0].webContents.scripts[0], `render({"state":"sending","text":"","echo":"<b>what's on</b>"})`);
  const html = talkPanelHtml("AAAA");
  assert.match(html, /<div id="body"><div id="echo"><\/div><div id="label">/);
  assert.match(html, /#echo\{[^}]*display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden/);
  assert.match(html, /body\.echoed #text\{-webkit-line-clamp:8\}/);
  assert.match(html, /echo\.textContent=/);
  assert.ok(28 + 2 + 2 + 4 + (2 + 1 + 8) * 18.2 <= TALK_PANEL.maxHeight, "two echo lines, the label and eight reply lines fit");
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test electron/talk-type-session.node-test.mjs electron/talk-panel.node-test.mjs`
Expected: FAIL. `TYPE_TIMING` is not exported, and the render script lacks `echo`.

- [ ] **Step 4: Implement**

- `talk-panel.mjs`: `<div id="echo"></div>` before `#label`; `#echo` in `--ink`, `overflow-wrap:anywhere`, a 2-line clamp, `margin-bottom:4px`, hidden when empty; `body.echoed #text` clamps at 8 lines; `render` sets `echo.textContent` and the `echoed` class; `paint()` adds `echo` to the payload only when non-empty.
- `talk-session.mjs`, per the rules table: `show(ask, state, text)` builds the typed view; `failed()` swaps in `TYPE_TEXT.serverDown` for a typed ask's `server-down`; `begin()` gives each ask `typed: false` and `idleTimer: null`, which `closeBox` clears; update `busy()`'s doc comment.

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test electron/talk-type-session.node-test.mjs electron/talk-session.node-test.mjs electron/talk-panel.node-test.mjs`
Expected: PASS. Talk's session tests pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add electron/talk-session.mjs electron/talk-panel.mjs electron/talk-panel.d.mts electron/talk-type-session.node-test.mjs electron/talk-panel.node-test.mjs
git commit -m "feat(type): typed asks through talk's states, with the words echoed in the box" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire ⌃⌥T into the app

**Files:**
- Modify: `electron/talk-main.mjs:6,22-29,62-67,72-75,83-124`, `electron/preload.cjs:67-68,252-259`, `src/types/ogb.d.ts:290-291`
- Test: `electron/talk-main.node-test.mjs`, `electron/preload.node-test.mjs`

**Interfaces:**
- Consumes: `createTypeBox` (Tasks 1–2), `createTypeShortcut` and `TYPE_SHORTCUT_UNAVAILABLE` (Task 3), the session's `type*` methods (Task 4).
- Produces: `installTalk({ …, platform = process.platform })`; `type-shortcut:state` → `TypeShortcutState` and `type-shortcut:set(change)` → `TypeShortcutState` (passing on only a boolean `enabled` and a string `key`), both guarded by `localOrMyCloud` and registered right after talk's two.
- Produces: `window.ogb.typeShortcut: TypeShortcutBridge` on this app's page and on My Cloud's own page while it is home (`MY_CLOUD_PAGE = ["talkShortcut", "typeShortcut"]`), never in `REMOTE_SAFE` or `HOME_PAGE`; on a server's page `set` needs `navigator.userActivation.isActive` unless it only turns the shortcut off, else rejects with "Use the switch to change the type shortcut."

- [ ] **Step 1: Update the harness and the assertions talk's tests make about the whole app**

In `talk-main.node-test.mjs`, `harness()` gains `platform = "darwin"` (passed to `installTalk`), `FakeBrowserWindow` gains `focus() {}`, and add `h.typePress = () => h.registered.get("Control+Alt+T")()`, `h.typeBox = () => h.windows.findLast(win => isTalkPanel(win) && win.options.focusable === true)` and `const talkKeys = h => [...h.registered.keys()].filter(key => key.endsWith("Space"))`. Then update these existing assertions:
- Whole-list key assertions that prove talk (lines 258, 263, 274, 276, 374 and 377) compare `talkKeys(h)`. Those that expect quitting or sign-in to free every key stay whole-list.
- The handler list becomes `["speech:start", "speech:stop", "speech:finish", "talk-shortcut:state", "talk-shortcut:set", "type-shortcut:state", "type-shortcut:set", "call:active"]`, and the guard filter also skips `type-shortcut:`.
- `MY_CLOUD_PAGE` is `"talkShortcut", "typeShortcut"`. `REMOTE_SAFE` and `HOME_PAGE` never match `typeShortcut`.
- The `doesNotMatch` on main becomes `/ipcMain\.handle\("(?:speech|talk-shortcut|type-shortcut|call):/`.

- [ ] **Step 2: Write the failing tests**

```js
test("the type shortcut is offered on macOS without Apple speech, never elsewhere or on a remote client", () => {
  const mac = harness({ appleSpeech: false }); mac.start();
  assert.deepEqual([mac.handle("type-shortcut:state", {}).available, mac.handle("talk-shortcut:state", {}).available], [true, false]);
  assert.deepEqual([...mac.registered.keys()], ["Control+Alt+T"]);
  for (const options of [{ platform: "win32", appleSpeech: false }, { remote: true }]) {
    const h = harness(options); h.start();
    assert.deepEqual([h.handle("type-shortcut:state", {}).available, h.registered.has("Control+Alt+T")], [false, false]);
  }
});

test("before it is set up the type setting says unavailable; afterwards each setting moves only its own key", () => {
  const h = harness();
  assert.equal(h.handle("type-shortcut:state", {}), TYPE_SHORTCUT_UNAVAILABLE);
  h.start();
  h.handle("talk-shortcut:set", {}, { enabled: false });
  assert.deepEqual([...h.registered.keys()], ["Control+Alt+T"]);
  h.handle("type-shortcut:set", {}, { key: "opt-shift-t", extra: 1 });
  assert.deepEqual([...h.registered.keys()], ["Alt+Shift+T"]);
  assert.equal(h.handle("talk-shortcut:state", {}).key, "ctrl-opt-space");
  h.talk.close();
  assert.deepEqual([...h.registered.keys()], []);
});

test("⌃⌥T opens the focusable box; Return asks this computer's Quick asks and talk's never-focused box takes over", async () => {
  const h = harness(); h.start(); h.typePress();
  const typing = h.typeBox();
  typing.webContents.emit("did-finish-load"); await settle();
  typing.webContents.emit("ipc-message", {}, "type-box:send", "what's on");
  await settle();
  assert.equal(typing.destroyed, true);
  assert.deepEqual(h.where()[0], ["local", "/api/bots?messages=0"]);
  assert.deepEqual((await h.painted())[0], { state: "sending", text: "", echo: "what's on" });
  assert.equal(h.box().options.focusable, false);
});

test("the type box opens in the skin the app painted last", async () => {
  const h = harness(); h.talk.skin("meadow"); h.start(); h.talk.skin("midnight"); h.typePress();
  h.typeBox().webContents.emit("did-finish-load"); await settle();
  assert.equal(h.typeBox().webContents.scripts[0], 'start({"text":"","theme":"dark"})');
  h.talk.close();
});

test("home needing a sign-in lets ⌃⌥T go; My Cloud as home takes it back", () => {
  const h = harness(); h.start();
  h.home = { kind: "signin" }; h.talk.homeChanged();
  assert.deepEqual([h.registered.has("Control+Alt+T"), h.handle("type-shortcut:state", {}).available], [false, false]);
  h.home = HOME_CLOUD; h.talk.homeChanged();
  assert.equal(h.registered.has("Control+Alt+T"), true);
  h.talk.close();
});

test("quitting closes an open type box and lets both keys go", () => {
  const h = harness(); h.start(); h.typePress();
  const typing = h.typeBox();
  h.talk.close();
  assert.deepEqual([typing.destroyed, [...h.registered.keys()]], [true, []]);
});

test("the type setting reaches My Cloud's own page while it is home, never a team's, and needs a click there to turn on", async () => {
  const h = harness(); h.home = HOME_CLOUD; h.start();
  assert.equal(h.handle("type-shortcut:state", { remote: true, cloudPage: true, senderFrame: { origin: CLOUD } }).available, true);
  assert.throws(() => h.handle("type-shortcut:set", { remote: true, cloudPage: false, senderFrame: { origin: "https://team.example.test" } }, { enabled: false }), /only available/);
  const page = preloadAt(CLOUD, { home: true, talk: true });
  await assert.rejects(page.bridge.typeShortcut.set({ enabled: true }), /type shortcut/);
  await assert.rejects(page.bridge.typeShortcut.set({ key: "ctrl-shift-t" }), /type shortcut/);
  await page.bridge.typeShortcut.set({ enabled: false });
  assert.deepEqual(plain(page.invoked), [["type-shortcut:set", { enabled: false }]]);
  assert.equal(preloadAt("https://team.example.test", { home: true, talk: false }).bridge.typeShortcut, undefined);
  h.talk.close();
});
```

In `preload.node-test.mjs`:

```js
test("the type bridge asks main over its own channels with only what it understands", async () => {
  const before = invocations.length;
  await exposed.api.typeShortcut.state();
  await exposed.api.typeShortcut.set({ enabled: false, key: "ctrl-shift-t", extra: "x" });
  assert.deepEqual(invocations.slice(before), [["type-shortcut:state"], ["type-shortcut:set", { enabled: false, key: "ctrl-shift-t" }]]);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test electron/talk-main.node-test.mjs electron/preload.node-test.mjs`
Expected: FAIL. `type-shortcut:state` has no handler, and `typeShortcut` is undefined.

- [ ] **Step 4: Implement**

- `talk-main.mjs`: `logged(what, run)` forwards its arguments. In `start()`, `typeBox = createTypeBox({ BrowserWindow, screen, nativeImage, iconPath, theme, … })` whose four callbacks are `logged("type input" | "type send" | "type cancel" | "type blur", …)` calls into `session.typeInput`, `typeSend`, `typeCancel` and `typeBlurred`; pass it to the session; `typeShortcut = createTypeShortcut({ globalShortcut, prefs, available: () => platform === "darwin" && !remote() && reachable(), onPress: logged("type press", () => session.typePress()) })`. `homeChanged` refreshes both keys, `skin` themes both boxes, `close` closes the session then both keys, each in its own `logged`. Document `platform` in `installTalk`'s doc comment.
- `preload.cjs`: one `shortcutBridge(channel, name)` returns `{ state, set }` behaving exactly as `talkShortcut` does today, over `${channel}:state` / `${channel}:set` with the refusal `Use the switch to change the ${name} shortcut.`; `talkShortcut: shortcutBridge("talk-shortcut", "talk")`, `typeShortcut: shortcutBridge("type-shortcut", "type")`; extend `MY_CLOUD_PAGE` and its comment.
- `ogb.d.ts`: `typeShortcut?: import("../../electron/talk-shortcut.mjs").TypeShortcutBridge`, with a doc line like talk's.

- [ ] **Step 5: Run the tests to see them pass, and confirm `main.mjs` is untouched**

Run: `node --test electron/talk-*.node-test.mjs electron/preload.node-test.mjs electron/desktop-prefs.node-test.mjs && pnpm typecheck && pnpm lint && git diff --exit-code e15d0be72 -- electron/main.mjs`
Expected: PASS, and the diff is empty.

- [ ] **Step 6: Commit**

```bash
git add electron/talk-main.mjs electron/preload.cjs src/types/ogb.d.ts electron/talk-main.node-test.mjs electron/preload.node-test.mjs
git commit -m "feat(type): wire ⌃⌥T into the app and give its setting a bridge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Checkpoint for Omkar: from here the feature works end to end. Task 7's by-hand steps 25–28 can run now on a side-by-side build, to settle the focus risk before Tasks 6–7.

---

### Task 6: The Settings row

**Files:**
- Modify: `src/components/TalkShortcutRow.tsx`, `src/components/SettingsModal.tsx:14,82,329`, `src/components/SettingsSimplePages.tsx:11,81`, `src/locales/en.json:1290-1295`
- Test: `src/components/TalkShortcutRow.test.ts`

**Interfaces:**
- Consumes: `window.ogb.typeShortcut` (Task 5), plus `TypeShortcutState` and `TypeKeyId` (Task 3).
- Produces: `TypeShortcutRow()`; `typeShortcutKeywords(ogb?: Window["ogb"]): string[]` (`["type", "typing", "keyboard", "shortcut", "hotkey", "quick asks"]` on darwin with the bridge, else `[]`); `TalkShortcutRow` and `talkShortcutKeywords` unchanged.
- Locale keys: `"settings.type.title": "Type to MausBot from any app"`, `"settings.type.subtitle": "Press {key}, type, then press Return. MausBot answers in a small box at the bottom of the screen; click it to open the chat."`, `"settings.type.aria": "Type to MausBot from any app"`, `"settings.type.keyAria": "Type shortcut"`; "taken" and "failed" reuse `settings.talk.taken` and `settings.talk.failed`.

- [ ] **Step 1: Write the failing tests** as a `describe("TypeShortcutRow")` block in the same file

Its `beforeEach` sets talk's state to `{ ...base, available: false }` and `window.ogb = { talkShortcut: bridge, typeShortcut: typeBridge }`, where `typeBridge` mirrors `bridge` over `typed = { available: true, enabled: true, key: "ctrl-opt-t", keys: [{ id: "ctrl-opt-t", label: "⌃⌥T" }, { id: "ctrl-shift-t", label: "⌃⇧T" }, { id: "opt-shift-t", label: "⌥⇧T" }], taken: false }`. `showBoth()` renders `TalkShortcutRow` and `TypeShortcutRow` side by side.

```ts
it("shows its own row, on, with ⌃⌥T, even where talk's row is hidden", async () => {
  await showBoth();
  expect(host.textContent).toContain("Type to MausBot from any app");
  expect(host.textContent).toContain("Press ⌃⌥T, type, then press Return");
  expect(host.textContent).not.toContain("Talk to MausBot");
});
it("changes its key and turns off over its own bridge only", async () => {
  await showBoth();
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Type shortcut"]')!;
  await act(async () => { valueSetter.call(select, "ctrl-shift-t"); select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
  expect(typeBridge.set).toHaveBeenCalledWith({ key: "ctrl-shift-t" });
  expect(host.textContent).toContain("Press ⌃⇧T");
  await click(host.querySelector<HTMLButtonElement>('button[aria-label="Type to MausBot from any app"]')!);
  expect(typeBridge.set).toHaveBeenLastCalledWith({ enabled: false });
  expect(bridge.set).not.toHaveBeenCalled();
});
it("says when another app holds ⌃⌥T", async () => {
  typed = { ...typed, taken: true };
  await showBoth();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("⌃⌥T is used by another app. Pick another shortcut.");
});
it("is hidden without its bridge or when unavailable", async () => {
  typed = { ...typed, available: false };
  await showBoth();
  expect(host.textContent).toBe("");
});
it("is found by search only in the Mac app with the type bridge", () => {
  expect(typeShortcutKeywords({ platform: "darwin", typeShortcut: typeBridge } as unknown as Window["ogb"])).toContain("type");
  expect(typeShortcutKeywords({ platform: "win32", typeShortcut: typeBridge } as unknown as Window["ogb"])).toEqual([]);
  expect(typeShortcutKeywords({ platform: "darwin" } as unknown as Window["ogb"])).toEqual([]);
});
```

`valueSetter` is `Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!`, as talk's key test uses it.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm exec vitest run src/components/TalkShortcutRow.test.ts`
Expected: FAIL. `TypeShortcutRow` is not exported.

- [ ] **Step 3: Implement**

- One generic `ShortcutRow<K>({ bridge, title, subtitle, aria, keyAria })` in `TalkShortcutRow.tsx` holds today's row. `TalkShortcutRow` and `TypeShortcutRow` pass it their bridge and locale keys.
- Put `<TypeShortcutRow />` right after `<TalkShortcutRow />` in both `SettingsModal.tsx` (General) and `SettingsSimplePages.tsx` (System).
- Add `...typeShortcutKeywords()` to General's keywords.
- Add the four en.json keys after `settings.talk.failed`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm exec vitest run src/components/TalkShortcutRow.test.ts && pnpm typecheck && pnpm lint && pnpm i18n:check`
Expected: PASS. Talk's row tests pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/TalkShortcutRow.tsx src/components/TalkShortcutRow.test.ts src/components/SettingsModal.tsx src/components/SettingsSimplePages.tsx src/locales/en.json
git commit -m "feat(type): the type shortcut's row under the talk shortcut's" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The verification recipe and the whole check

**Files:**
- Modify: `scripts/talk-box-evidence.mjs:18-31`, `docs/verification/talk-shortcut.md`, `docs/verification/README.md:115-118`
- Create: `docs/verification/evidence/talk-shortcut/{light,dark}-typed-sending.png`, `{light,dark}-typed-reply-long.png`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add the echo evidence**

Add two `STATES` to the evidence script:
- `["typed-sending", { state: "sending", text: "", echo: "what's on my calendar today" }]`;
- `["typed-reply-long", { state: "reply", text: "Here is a fairly long answer so the card grows. ".repeat(12), echo: "a typed question long enough to need more than two lines in the box, so the echo shows its ellipsis ".repeat(2) }]`.

Run: `node scripts/talk-box-evidence.mjs`
Expected: it prints `light-typed-reply-long.png  card N px, box N px` with N ≤ 240. The PNG shows two echo lines ending in "…", then the label and the reply.

- [ ] **Step 2: Write the recipe**

In `talk-shortcut.md`, the title and intro name ⌃⌥T too. The Floor's commands already pick up the `talk-type-*` tests; add what they prove (presets, prefs and independence from talk; the box's window flags, shown inactive then focused, never `show()`, destroyed at once; a blur or failed page reported once; the page's messages checked; the ⌘ chord guard; the key rule with an input method, blank Return, read-only after send, six lines, 4,000 characters; the typing state, draft, idle close and repeat guard; one ask at a time; refusals; the echo; availability and My Cloud's page) and what they don't (the real key, the box becoming key without activating MausBot, focus going back to the app underneath, Spaces and full screen, a real input method, secure input, the Edit menu's shortcuts in the box).

Add `### By hand: Type (⌃⌥T)`, numbered on from 23, with a background `osascript` frontmost-app log (one line a second to `~/front.log`) for steps 25–28:

- **24. Row.** Settings → General (Simple and Advanced) shows "Type to MausBot from any app" under the talk row, on, "Press ⌃⌥T, type, then press Return…".
- **25. Focus (ship gate).** Safari in front, over the MausBot window; ⌃⌥T: the box shows bottom-centre with a blinking caret and takes the keystrokes; the menu bar still says Safari, `front.log` reads `Safari` throughout, and the MausBot window never comes forward.
- **26. Send (ship gate).** Type "what can you do", Return: the words show at once as the first line over "Sending to MausBot…", then the reply; a key pressed right after Return lands in Safari; `front.log` still only `Safari`; clicking the box opens MausBot on Quick asks.
- **27. Esc and × (ship gate).** The box closes at once, nothing is sent, and the next keystroke lands in Safari.
- **28. From MausBot itself (ship gate).** Composer focused: ⌃⌥T then Esc puts focus back in the composer; ⌃⌥T then Return leaves MausBot's open chat as it was.
- **29. Keys.** Shift+Return makes a line; six lines, then it scrolls; a blank Return does nothing; a 5,000-character paste keeps 4,000; ⌘A/⌘C/⌘V/⌘X/⌘Z work; ⌘Q, ⌘W, ⌘R, ⌘,, ⌘H and ⌘M do nothing.
- **30. Input method.** Japanese Romaji, "nihon": Return makes 日本 without sending; a second Return sends.
- **31. Toggle and repeat.** ⌃⌥T closes an empty box and leaves one with words; holding ⌃⌥T for 2 s leaves one box open.
- **32. Clicking away.** With words in the box, a click on Safari's page, ⌘Tab, or ⌃→ to another Space each closes it (no box stays up without focus); ⌃⌥T within 5 minutes brings the words back with the caret at the end, after 5 minutes it opens empty; Esc and Return drop the words.
- **33. Idle.** An empty box closes after about 60 s.
- **34. Full screen and Spaces.** In a full-screen app and on another Space the box shows there and takes typing; the app keeps its focus after Esc.
- **35. Secure input.** Safari's password field focused, ⌃⌥T: note whether nothing happens or the box opens; keystrokes never land in the password field while the box is up.
- **36. Talk against type.** While listening, ⌃⌥T does nothing; over a talk reply it opens the box; while the box is open, ⌃⌥Space does nothing; over a typed reply, ⌃⌥Space listens.
- **37. Independence.** Talk off: ⌃⌥T works; type off: ⌃⌥T is free and talk works; ⌃⇧T and ⌥⇧T work; another app holding ⌃⌥T: "⌃⌥T is used by another app. Pick another shortcut."
- **38. My Cloud.** Home on My Cloud: the ask goes to its Quick asks; asleep: "Waking My Cloud…" under the words, then the reply, sent once; the row is on My Cloud's own page, where turning it on or changing the key takes a click, and absent on a team's page.
- **39. Starting.** ⌃⌥T and Return right after a relaunch: "MausBot is still starting. Try again in a moment."
- **40. Light and dark.** The type box and the echo follow the app's skin; compare with the `typed-*` PNGs.

The `README.md` paragraph says the recipe checks hold-to-talk and ⌃⌥T typing from any app.

- [ ] **Step 3: Run the whole check**

Run: `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:electron && pnpm exec vitest run src/components/TalkShortcutRow.test.ts electron/skin-overlay.test.mjs scripts/testing/file-size-ratchet.test.ts scripts/testing/comment-history.test.ts --maxWorkers=1 && wc -l electron/main.mjs && git diff --exit-code e15d0be72 -- electron/main.mjs`
Expected: everything passes, `3247 electron/main.mjs`, and the diff is empty.

- [ ] **Step 4: Commit**

```bash
git add scripts/talk-box-evidence.mjs docs/verification/talk-shortcut.md docs/verification/README.md docs/verification/evidence/talk-shortcut/*typed-*.png
git commit -m "docs(type): verification recipe and echo evidence for the type shortcut" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: By hand (Omkar, side-by-side build, per the recipe's Setup)**

Run steps 24–40 and note each result for the PR description. Steps 25–28 are the ship gate in Global Constraints.

---

## Self-review

- **Spec coverage.** ⌃⌥T anywhere, bottom-centre, every Space and full screen, focused (1, 5, 7); Return to the same Quick asks chat here or on My Cloud with its wake (4, 5); the reply in the box on talk's timing (4); the app underneath keeps focus (1, 7); not a mini chat (1, 4); only the words, no label (4, constraints); macOS only and availability (3, 5); Shift+Return, blank Return, Esc (2, 4); six lines and the limit (2); echo, typing stopped, focus given up (1, 2, 4); draft on click-away with the caret at the end (1, 2, 4); ⌃⌥T on an open box, idle close, one ask at a time, refusals (4); row, presets, taken, independence, My Cloud's page, clicks on server pages (3, 5, 6); anti-goals and page safety (1, 4, 5, 7); `main.mjs` untouched (5, 7); the spec's Testing list (every task, 7).
- **Deviations, on purpose,** all under "Settled here": focus given up at Return; two windows; a typed server-down line; the chat prepared at Return.
- **Types.** `createTypeBox`, `typeBoxHtml`, `typeBoxKey`, `blockedChord`, `TYPE_LIMIT`, `TYPE_BOX_TEXT`, `markTalkPanel`, `mascotPng`, `TALK_BOX_THEME_CSS`, `createTypeShortcut`, `TYPE_SHORTCUT_UNAVAILABLE`, `TypeKeyId`, `TypeShortcutState`, `TypeShortcutBridge`, `typePress`/`typeInput`/`typeSend`/`typeCancel`/`typeBlurred`, `TYPE_TIMING`, `TYPE_TEXT`, `echo`, `platform`, `type-box:*` and `type-shortcut:*` are spelled the same in every Interfaces block and test.
- **Left to the implementer:** the type page's CSS within talk's tokens, and `ShortcutRow`'s exact props.
