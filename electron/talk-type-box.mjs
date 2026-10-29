import { fileURLToPath } from "node:url";
import { TALK_BOX_THEME_CSS, TALK_PANEL, markTalkPanel, mascotPng, talkPanelBounds } from "./talk-panel.mjs";

export const TYPE_LIMIT = 4000;

const EDIT_CODES = ["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ"];
const CHARACTER_CODE = /^(?:Key[A-Z]|Digit\d|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Backquote|IntlBackslash)$/;

/** ⌘ on a character key, except ⌘A/⌘C/⌘V/⌘X/⌘Z named by an ASCII `key`, else by `code`: macOS matches menu keys by character on Latin layouts, by place on others. */
export function blockedChord(input) {
  if (input.type !== "keyDown" || input.meta !== true) return false;
  if (/^[ -~]$/.test(input.key)) return !"acvxz".includes(input.key.toLowerCase());
  if (EDIT_CODES.includes(input.code)) return false;
  return CHARACTER_CODE.test(input.code ?? "") || [...input.key].length === 1;
}

export function typeBoxHtml(iconBase64) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>MausBot</title><style>
${TALK_BOX_THEME_CSS}
*{box-sizing:border-box}html,body{margin:0;background:transparent;overflow:hidden;font:13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:var(--ink);-webkit-user-select:none;user-select:none}
body{opacity:0;transition:opacity 160ms ease}body.on{opacity:1}
#card{position:relative;display:flex;gap:12px;align-items:flex-start;min-height:56px;padding:14px 40px 14px 14px;border:1px solid var(--border);border-radius:16px;background:var(--panel)}
#mascot{flex:none;width:28px;height:28px;object-fit:contain;display:block;-webkit-user-drag:none}
#field{flex:1;min-width:0;align-self:center;margin:0;padding:0;border:0;outline:none;resize:none;background:transparent;color:var(--ink);font:inherit;-webkit-user-select:text;user-select:text}
@media (prefers-reduced-motion: reduce){body{transition:none}}
</style></head><body><div id="card"><img id="mascot" src="data:image/png;base64,${iconBase64}" alt=""><textarea id="field" rows="1" maxlength="${TYPE_LIMIT}"></textarea></div><script>
const card=document.getElementById("card"),field=document.getElementById("field");
function start(view){
  document.body.className=["on",view.theme].filter(Boolean).join(" ");
  field.value=view.text||"";
  field.focus();
  field.setSelectionRange(field.value.length,field.value.length);
  return Math.ceil(card.getBoundingClientRect().height);
}
</script></body></html>`;
}

const wellFormed = text => typeof text === "string" && text.length <= TYPE_LIMIT;

export function createTypeBox({ BrowserWindow, screen, nativeImage, iconPath, theme: initialTheme = null, onInput, onSend, onCancel, onBlur }) {
  let win = null;
  let page = null;
  let theme = initialTheme;

  const live = target => target && !target.isDestroyed();

  function close() {
    const target = win;
    if (!target) return;
    win = null;
    if (live(target)) target.destroy();
  }

  function create(view) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const payload = JSON.stringify({ text: view.text, ...(theme ? { theme } : {}) });
    const target = new BrowserWindow({
      type: "panel",
      ...talkPanelBounds(area, TALK_PANEL.minHeight),
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      focusable: true,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      // Electron/macOS: lets a click on an inactive window reach the page.
      acceptFirstMouse: true,
      hiddenInMissionControl: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        preload: fileURLToPath(new URL("./talk-type-box-preload.cjs", import.meta.url)),
      },
    });
    markTalkPanel(target);
    target.excludedFromShownWindowsMenu = true;
    target.setAlwaysOnTop(true, "screen-saver");
    // Electron/macOS: skipTransformProcessType keeps the Dock icon.
    target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });

    let reported = false;
    const lost = ({ destroy }) => {
      if (win !== target) return;
      if (destroy) {
        win = null;
        if (live(target)) target.destroy();
      }
      if (reported) return;
      reported = true;
      onBlur();
    };

    async function begin() {
      const height = await target.webContents.executeJavaScript(`start(${payload})`);
      if (win !== target) return;
      target.setBounds(talkPanelBounds(area, height));
      target.showInactive();
      // Electron/macOS: focus() on a "panel" window makes it key without activating the app, so the app the person
      // was in stays active. Unit tests can't prove it.
      target.focus();
    }

    target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    target.webContents.on("will-navigate", event => event.preventDefault());
    // Electron: preventDefault() here also stops the app menu's key equivalent. setIgnoreMenuShortcuts is not used:
    // on macOS, Electron's text fields get ⌘C/⌘V/⌘X/⌘A/⌘Z from the Edit menu.
    target.webContents.on("before-input-event", (event, input) => {
      if (blockedChord(input)) event.preventDefault();
    });
    target.webContents.on("did-finish-load", () => {
      if (win === target) begin().catch(() => lost({ destroy: true }));
    });
    // Security: only this window's own page speaks for the box, and only with words within the limit.
    target.webContents.on("ipc-message", (_event, channel, text, height) => {
      if (win !== target) return;
      if (channel === "type-box:input") {
        if (!wellFormed(text) || !Number.isFinite(height)) return;
        target.setBounds(talkPanelBounds(area, height));
        onInput(text);
      } else if (channel === "type-box:send") {
        if (wellFormed(text)) onSend(text);
      } else if (channel === "type-box:cancel") {
        onCancel();
      }
    });
    target.webContents.on("render-process-gone", () => lost({ destroy: true }));
    target.on("blur", () => lost({ destroy: false }));
    target.on("closed", () => lost({ destroy: true }));
    target.loadURL(page).catch(() => lost({ destroy: true }));
    return target;
  }

  return {
    open(view) {
      close();
      page ??= `data:text/html;charset=utf-8,${encodeURIComponent(typeBoxHtml(mascotPng(nativeImage, iconPath)))}`;
      win = create(view);
    },
    close,
    /** The app's skin for the next open; null follows macOS's appearance. */
    setTheme(next) {
      theme = next;
    },
  };
}
