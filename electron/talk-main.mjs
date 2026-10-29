import skins from "./skin-overlay.cjs";
import { createCloudTalkServer } from "./talk-cloud.mjs";
import { createTalkPanel } from "./talk-panel.mjs";
import { createTalkServer } from "./talk-server.mjs";
import { createTalkSession } from "./talk-session.mjs";
import { createCallPresence, createTalkShortcut, createTypeShortcut, TALK_SHORTCUT_UNAVAILABLE, TYPE_SHORTCUT_UNAVAILABLE } from "./talk-shortcut.mjs";
import { createTypeBox } from "./talk-type-box.mjs";

export { isTalkPanel } from "./talk-panel.mjs";

/** Each ask's chat stays with the server that found it, should home change before it is sent. */
function routeAsks(pick) {
  const owners = new WeakMap();
  return {
    prepare(onWaking) {
      const server = pick();
      return server.prepare(onWaking).then(chat => { owners.set(chat, server); return chat; });
    },
    ask: input => (owners.get(input.chat) ?? pick()).ask(input),
  };
}

/**
 * The microphone's IPC for this app's pages (dictation, calls, the talk and type settings), then the talk and type
 * shortcuts once the app is ready. `speech`: speech.mjs's start/stop/finish/busy. `packaged`: asks go to
 * `localRequest`, this computer's own server; in development to `devUrl`, whose Vite /api proxy reaches
 * `pnpm dev:server`. Once home is My Cloud they go there. `cloudPage(event)`: the sender is My Cloud's own verified
 * page in the main window; the talk and type settings answer it only while My Cloud is home at that origin.
 * `platform`: the type shortcut is offered only on "darwin".
 */
export function installTalk({ ipcMain, localOnly, localOrHome, cloudPage = () => false, BrowserWindow, appleSpeech, speech, packaged, devUrl, nativeImage, iconPath, openLink, reveal, log, fetch = globalThis.fetch, platform = process.platform }) {
  const callPresence = createCallPresence();
  let shortcut = null, typeShortcut = null, session = null, panel = null, typeBox = null, theme = null;
  /** My Cloud's verified origin while it is home, once the shortcut is set up; else null. */
  let myCloudHome = () => null;
  // Security: a frame's URL can name My Cloud while its own origin is opaque (a sandboxed file served there).
  const myCloudPage = event => {
    try {
      const at = myCloudHome();
      return Boolean(at) && event?.senderFrame?.origin === at && cloudPage(event) === true;
    } catch { return false; }
  };
  /** This app's page, or My Cloud's own page while it is home: the talk and type settings only, never the microphone. */
  const localOrMyCloud = (channel, handler) => {
    const local = localOnly(channel, handler);
    return (event, ...args) => (myCloudPage(event) ? handler : local)(event, ...args);
  };
  // Security: a page's change reaches the shortcut as a boolean `enabled` and a string `key`, nothing else.
  const shortcutSetting = (prefix, current, unavailable) => {
    ipcMain.handle(`${prefix}:state`, localOrMyCloud(`${prefix}:state`, () => current()?.state() ?? unavailable));
    ipcMain.handle(`${prefix}:set`, localOrMyCloud(`${prefix}:set`, (_event, change) => current()?.set({
      enabled: typeof change?.enabled === "boolean" ? change.enabled : undefined,
      key: typeof change?.key === "string" ? change.key : undefined,
    }) ?? unavailable));
  };

  ipcMain.handle("speech:start", localOnly("speech:start", (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (!appleSpeech) {
      win.webContents.send("speech:end", { code: 2, reason: "unsupported-platform" });
      return;
    }
    speech.start(win, options);
  }));
  ipcMain.handle("speech:stop", localOnly("speech:stop", (event) => {
    if (appleSpeech) speech.stop(BrowserWindow.fromWebContents(event.sender));
  }));
  ipcMain.handle("speech:finish", localOnly("speech:finish", (event) => {
    if (appleSpeech) speech.finish(BrowserWindow.fromWebContents(event.sender));
  }));
  shortcutSetting("talk-shortcut", () => shortcut, TALK_SHORTCUT_UNAVAILABLE);
  shortcutSetting("type-shortcut", () => typeShortcut, TYPE_SHORTCUT_UNAVAILABLE);
  ipcMain.on("talk-shortcut:page", event => { event.returnValue = myCloudPage(event); });
  ipcMain.handle("call:active", localOrHome("call:active", (event, active) => {
    callPresence.set(event.sender, active === true);
  }));

  // Electron: a throw inside a globalShortcut or webContents event callback reaches no caller.
  const logged = (what, run) => (...args) => {
    try { run(...args); } catch (error) { log(`talk ${what} failed: ${error?.message ?? error}`); }
  };

  return {
    /** `remote()`: this desktop is a remote client of another computer. `home()`: home as last worked out
     * (`{ kind: "computer" | "cloud" | "signin", origin? }`). `starting()`: this computer's server is on its way up.
     * `dataDir()`: the data folder this process runs. `myCloud`: how to reach My Cloud, while it is home: `mine()` its
     * verified origin, `fetch` the window's own session's, `reconnect(origin)` signs the window in there again, `power`
     * the gate Files and lending share, `account()` the MausBot Cloud sign-in that wakes it. */
    start({ globalShortcut, screen, prefs, remote, home, starting, localRequest, dataDir, myCloud = null }) {
      const request = (route, init) => (packaged ? localRequest(route, init) : fetch(new URL(route, devUrl), init));
      const kind = () => home().kind;
      myCloudHome = () => {
        const at = home();
        return myCloud && at.kind === "cloud" && at.origin && at.origin === myCloud.mine() ? at.origin : null;
      };
      try {
        panel = createTalkPanel({ BrowserWindow, screen, nativeImage, iconPath, theme, onOpen: logged("open", () => session.open()), onDismiss: logged("dismiss", () => session.dismiss()) });
        typeBox = createTypeBox({ BrowserWindow, screen, nativeImage, iconPath, theme,
          onInput: logged("type input", text => session.typeInput(text)), onSend: logged("type send", text => session.typeSend(text)),
          onCancel: logged("type cancel", () => session.typeCancel()), onBlur: logged("type blur", () => session.typeBlurred()) });
        const here = createTalkServer({ request, prefs, starting, serverKey: () => (packaged ? dataDir() : devUrl) ?? "local" });
        const there = myCloud && createCloudTalkServer({ origin: () => myCloudHome(), fetch: myCloud.fetch, reconnect: myCloud.reconnect, power: myCloud.power, account: myCloud.account, prefs });
        session = createTalkSession({
          speech,
          server: routeAsks(() => (there && kind() === "cloud" ? there : here)),
          panel,
          typeBox,
          voiceInUse: () => speech.busy() || callPresence.active(),
          release: () => shortcut.releaseModifiers(),
          openChat: chat => (chat ? openLink(`openmausbot://thread/${encodeURIComponent(chat.threadId)}?bot=${encodeURIComponent(chat.botId)}`) : reveal()),
        });
        // Teams and other Clouds are places the window shows, never home; a home that needs a sign-in takes no asks.
        const reachable = () => kind() === "computer" || (Boolean(there) && kind() === "cloud");
        shortcut = createTalkShortcut({ globalShortcut, prefs, available: () => appleSpeech && !remote() && reachable(), onPress: logged("press", () => session.press()) });
        typeShortcut = createTypeShortcut({ globalShortcut, prefs, available: () => platform === "darwin" && !remote() && reachable(), onPress: logged("type press", () => session.typePress()) });
      } catch (error) {
        logged("close", () => shortcut?.close())();
        session = shortcut = null;
        log(`talk shortcut unavailable: ${error?.message ?? error}`);
      }
    },
    /** Home changed (My Cloud, a sign-in it needs, or this computer again): both keys are let go or taken again to match. */
    homeChanged() {
      logged("home change", () => shortcut?.refresh())();
      logged("home change", () => typeShortcut?.refresh())();
    },
    /** A page painted the app's skin (its id, resolved from the Theme setting): both boxes take its light or dark. */
    skin(id) {
      if (!skins.isKnownSkin(id)) return;
      theme = skins.skinIsLight(id) ? "light" : "dark";
      logged("skin", () => panel?.setTheme(theme))();
      logged("skin", () => typeBox?.setTheme(theme))();
    },
    /** Listening, taking typed words, or an ask on its way that has not been answered yet. */
    busy: () => session?.busy() ?? false,
    close() {
      logged("close", () => session?.close())();
      logged("close", () => shortcut?.close())();
      logged("close", () => typeShortcut?.close())();
    },
  };
}
