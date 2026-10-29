import { fileURLToPath } from "node:url";
import { TALK_BOX_THEME_CSS, TALK_PANEL, markTalkPanel, mascotPng, talkPanelBounds } from "./talk-panel.mjs";

export const TYPE_LIMIT = 4000;

const EDIT_CODES = ["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ"];
const CHARACTER_CODE = /^(?:Key[A-Z]|Digit\d|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Backquote|IntlBackslash)$/;

/** ⌘ on a character key, except Space (⌃⌘Space is macOS's emoji picker) and ⌘A/⌘C/⌘V/⌘X/⌘Z named by an ASCII `key`, else by `code`: macOS matches menu keys by character on Latin layouts, by place on others. */
export function blockedChord(input) {
  if (input.type !== "keyDown" || input.meta !== true || input.key === " ") return false;
  if (/^[ -~]$/.test(input.key)) return !"acvxz".includes(input.key.toLowerCase());
  if (EDIT_CODES.includes(input.code)) return false;
  return CHARACTER_CODE.test(input.code ?? "") || [...input.key].length === 1;
}

export const TYPE_BOX_TEXT = Object.freeze({ placeholder: "Type to MausBot, then press Return", label: "Ask MausBot", dismiss: "Dismiss" });

/** Embedded in the page as source, so it must stay self-contained. keyCode 229 is a key an input method is handling. */
export function typeBoxKey(event) {
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === "Enter") return event.shiftKey ? null : "send";
  return event.key === "Escape" ? "cancel" : null;
}

export function typeBoxHtml(iconBase64) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>MausBot</title><style>
${TALK_BOX_THEME_CSS}
*{box-sizing:border-box}html,body{margin:0;background:transparent;overflow:hidden;font:13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:var(--ink);-webkit-user-select:none;user-select:none}
body{opacity:0;transition:opacity 160ms ease}body.on{opacity:1}
#card{position:relative;display:flex;gap:12px;align-items:flex-start;min-height:56px;padding:14px 40px 14px 14px;border:1px solid var(--border);border-radius:16px;background:var(--panel)}
#mascot{flex:none;width:28px;height:28px;object-fit:contain;display:block;-webkit-user-drag:none}
#field{flex:1;min-width:0;align-self:center;margin:0;padding:0;border:0;outline:none;resize:none;background:transparent;color:var(--ink);font:inherit;max-height:calc(6 * 1.4em);overflow-y:auto;-webkit-user-select:text;user-select:text}
#field::placeholder{color:var(--ink2)}
#close{position:absolute;top:10px;right:10px;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ink2);font:inherit;font-size:16px;line-height:24px;cursor:default}
#close:hover{background:var(--hover)}
@media (prefers-reduced-motion: reduce){body{transition:none}}
</style></head><body><div id="card"><img id="mascot" src="data:image/png;base64,${iconBase64}" alt=""><textarea id="field" rows="1" maxlength="${TYPE_LIMIT}" placeholder="${TYPE_BOX_TEXT.placeholder}" aria-label="${TYPE_BOX_TEXT.label}"></textarea><button id="close" type="button" tabindex="-1" aria-label="${TYPE_BOX_TEXT.dismiss}">&times;</button></div><script>
const card=document.getElementById("card"),field=document.getElementById("field"),close=document.getElementById("close");
${typeBoxKey}
function grow(){
  field.style.height="auto";
  field.style.height=field.scrollHeight+"px";
  return Math.ceil(card.getBoundingClientRect().height);
}
field.addEventListener("keydown",event=>{
  const action=typeBoxKey(event);
  if(!action)return;
  event.preventDefault();
  if(action==="cancel")window.typeBox.cancel();
  else if(!field.readOnly&&field.value.trim()){field.readOnly=true;window.typeBox.send(field.value);}
});
field.addEventListener("input",()=>window.typeBox.input(field.value,grow()));
close.addEventListener("click",()=>window.typeBox.cancel());
card.addEventListener("mousedown",event=>{if(event.target!==field)event.preventDefault();});
function start(view){
  document.body.className=["on",view.theme].filter(Boolean).join(" ");
  field.value=view.text||"";
  field.focus();
  field.setSelectionRange(field.value.length,field.value.length);
  return grow();
}
</script></body></html>`;
}

const wellFormed = text => typeof text === "string" && text.length <= TYPE_LIMIT;

export function createTypeBox({ BrowserWindow, screen, nativeImage, iconPath, theme: initialTheme = null, onInput, onSend, onCancel, onBlur }) {
  let win = null;
  let spare = null;
  let keep = false;
  let page = null;
  let theme = initialTheme;

  const live = target => target && !target.isDestroyed();
  const workArea = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const destroy = box => {
    if (live(box.target)) box.target.destroy();
  };

  function warm() {
    if (!keep || win || spare) return;
    try {
      spare = create();
    } catch {}
  }

  function close() {
    const box = win;
    if (!box) return;
    win = null;
    destroy(box);
    warm();
  }

  function create() {
    page ??= `data:text/html;charset=utf-8,${encodeURIComponent(typeBoxHtml(mascotPng(nativeImage, iconPath)))}`;
    const target = new BrowserWindow({
      type: "panel",
      ...talkPanelBounds(workArea(), TALK_PANEL.minHeight),
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

    const box = { target, loaded: false, shown: false, area: null, start: "" };

    // Electron: quitting (and quitAndInstall, before before-quit) closes every window itself, and a window made
    // meanwhile stays open so the app never quits; a close Electron makes therefore stops the waiting box.
    const gone = ({ quitting = false } = {}) => {
      const open = box === win;
      if (!open && box !== spare) return;
      if (quitting) keep = false;
      if (open) win = null;
      else spare = null;
      destroy(box);
      if (open || box.loaded) warm();
      if (open) onBlur();
    };

    async function begin() {
      const height = await target.webContents.executeJavaScript(box.start);
      if (win !== box) return;
      target.setBounds(talkPanelBounds(box.area, height));
      target.showInactive();
      box.shown = true;
      // Electron/macOS: focus() on a "panel" window makes it key without activating the app, so the app the person
      // was in stays active. Unit tests can't prove it.
      target.focus();
    }

    box.show = view => {
      box.area = workArea();
      box.start = `start(${JSON.stringify({ text: view.text, ...(theme ? { theme } : {}) })})`;
      if (box.loaded) begin().catch(() => gone());
    };

    target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    target.webContents.on("will-navigate", event => event.preventDefault());
    // Electron: preventDefault() here also stops the app menu's key equivalent. setIgnoreMenuShortcuts is not used:
    // on macOS, Electron's text fields get ⌘C/⌘V/⌘X/⌘A/⌘Z from the Edit menu.
    target.webContents.on("before-input-event", (event, input) => {
      if (blockedChord(input)) event.preventDefault();
    });
    target.webContents.on("did-finish-load", () => {
      box.loaded = true;
      if (win === box) begin().catch(() => gone());
    });
    // Security: only the open box's own page speaks for it, and only with words within the limit.
    target.webContents.on("ipc-message", (_event, channel, text, height) => {
      if (win !== box) return;
      if (channel === "type-box:input") {
        if (!wellFormed(text) || !Number.isFinite(height)) return;
        target.setBounds(talkPanelBounds(box.area, height));
        onInput(text);
      } else if (channel === "type-box:send") {
        if (wellFormed(text)) onSend(text);
      } else if (channel === "type-box:cancel") {
        onCancel();
      }
    });
    target.webContents.on("render-process-gone", () => gone());
    target.on("blur", () => {
      if (box === win) gone();
    });
    target.on("closed", () => gone({ quitting: true }));
    target.loadURL(page).catch(() => gone());
    return box;
  }

  return {
    open(view) {
      close();
      const box = spare ?? create();
      spare = null;
      win = box;
      box.show(view);
    },
    close,
    focus() {
      if (win?.shown && live(win.target) && !win.target.isFocused()) win.target.focus();
    },
    /** While on, one loaded, hidden box waits for the next open, so keys typed right after the press never go to
     * the app underneath while a page loads. */
    keepReady(on) {
      keep = on;
      if (on) {
        warm();
      } else if (spare) {
        const box = spare;
        spare = null;
        destroy(box);
      }
    },
    /** The app's skin for the next open; null follows macOS's appearance. */
    setTheme(next) {
      theme = next;
    },
  };
}
