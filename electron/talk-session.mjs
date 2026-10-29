import { randomUUID } from "node:crypto";
import { TalkServerError } from "./talk-server.mjs";

export const TALK_TIMING = Object.freeze({ replyHideMs: 12_000, noticeHideMs: 4_000, stillWorkingMs: 120_000, hoverRecheckMs: 500, maxListenMs: 60_000 });

export const TALK_TEXT = Object.freeze({
  busy: "Voice is in use in MausBot",
  serverDown: "Open MausBot to talk",
  starting: "MausBot is still starting. Try again in a moment.",
  noMausbot: "Set up MausBot first, then try again.",
  moved: "MausBot lives on My Cloud now. Try again in a moment.",
  cloudDown: "Couldn't reach My Cloud. Try again in a moment.",
  cloudWaking: "My Cloud is still waking. Try again in a moment.",
  wakeFailed: "My Cloud didn't wake up. Try again in a moment.",
  cloudSignIn: "Sign in to My Cloud again, then try again.",
  notSent: "That didn't reach MausBot. Try again in a moment.",
  permission: "Talking needs Microphone + Speech Recognition access — System Settings → Privacy & Security.",
  dictationOff: "Turn on Dictation in System Settings → Keyboard, then try again.",
  unavailable: "Talking couldn't start. Try again.",
  failed: "MausBot couldn't take that · Open chat",
});

export const TYPE_TIMING = Object.freeze({ idleMs: 60_000, draftMs: 300_000, repeatMs: 500 });

export const TYPE_TEXT = Object.freeze({ serverDown: "Couldn't reach MausBot. Try again in a moment." });

const SPEECH_PROBLEMS = new Map([
  ["speech-not-authorized", TALK_TEXT.permission],
  ["mic-failed", TALK_TEXT.unavailable],
  ["recognizer-unavailable", TALK_TEXT.unavailable],
  ["dictation-disabled", TALK_TEXT.dictationOff],
  ["helper-build-failed", TALK_TEXT.unavailable],
  ["helper-start-failed", TALK_TEXT.unavailable],
  ["unsupported-platform", TALK_TEXT.unavailable],
]);

const SERVER_NOTICES = new Map([
  ["server-down", TALK_TEXT.serverDown],
  ["starting", TALK_TEXT.starting],
  ["no-mausbot", TALK_TEXT.noMausbot],
  ["moved", TALK_TEXT.moved],
  ["cloud-down", TALK_TEXT.cloudDown],
  ["cloud-waking", TALK_TEXT.cloudWaking],
  ["wake-failed", TALK_TEXT.wakeFailed],
  ["cloud-signin", TALK_TEXT.cloudSignIn],
]);

const UNDER_WAY = new Set(["listening", "typing", "waking", "sending", "thinking"]);
const SHOWS_WORDS = new Set(["waking", "sending", "thinking"]);

export function createTalkSession({ speech, server, panel, typeBox, voiceInUse, release, openChat, newSendId = randomUUID, now = () => Date.now() }) {
  let current = null;
  let draft = null;
  let lastTypePress = -Infinity;

  const live = ask => current === ask && !ask.controller.signal.aborted;
  const typing = () => (current?.state === "typing" ? current : null);

  function begin(state) {
    const ask = { state, words: "", reply: "", chat: null, waking: false, typed: false, sink: null, controller: new AbortController(), listenTimer: null, hideTimer: null, answerTimer: null, idleTimer: null };
    current = ask;
    return ask;
  }

  function show(ask, state, text) {
    ask.state = state;
    const view = ask.typed ? { state, text: SHOWS_WORDS.has(state) ? "" : text, echo: ask.words } : { state, text };
    try {
      panel.render(view);
    } catch {}
  }

  function closeTypeBox() {
    try {
      typeBox.close();
    } catch {}
  }

  function closeBox(ask) {
    if (current !== ask) return;
    current = null;
    clearTimeout(ask.listenTimer);
    clearTimeout(ask.hideTimer);
    clearTimeout(ask.answerTimer);
    clearTimeout(ask.idleTimer);
    ask.controller.abort();
    try {
      if (ask.state === "typing") typeBox.close();
      else panel.close();
    } catch {}
  }

  function cancel(ask) {
    if (ask.state === "listening") speech.stop(ask.sink);
    closeBox(ask);
  }

  function hovered() {
    try {
      return panel.hovered();
    } catch {
      return false;
    }
  }

  function hideIn(ask, ms) {
    clearTimeout(ask.hideTimer);
    const check = () => {
      if (current !== ask) return;
      if (hovered()) ask.hideTimer = setTimeout(check, TALK_TIMING.hoverRecheckMs);
      else closeBox(ask);
    };
    ask.hideTimer = setTimeout(check, ms);
  }

  function settle(ask, state, text, hideMs) {
    clearTimeout(ask.answerTimer);
    show(ask, state, text);
    hideIn(ask, hideMs);
  }

  function stillWorking(ask) {
    ask.controller.abort();
    settle(ask, "still-working", ask.reply, TALK_TIMING.replyHideMs);
  }

  function failed(ask, error) {
    const code = error instanceof TalkServerError ? error.code : null;
    if (code === "lost") stillWorking(ask);
    else if (ask.typed && code === "server-down") settle(ask, "error", TYPE_TEXT.serverDown, TALK_TIMING.noticeHideMs);
    else if (SERVER_NOTICES.has(code)) settle(ask, "error", SERVER_NOTICES.get(code), TALK_TIMING.noticeHideMs);
    else settle(ask, "error", TALK_TEXT.failed, TALK_TIMING.replyHideMs);
  }

  function follow(ask, update) {
    if (!live(ask)) return;
    if (update.kind === "thinking") show(ask, "thinking", ask.words);
    else if (update.kind === "reply") {
      ask.reply = update.text;
      show(ask, "reply", update.text);
    } else if (update.kind === "done") ask.reply = update.text;
  }

  function answered(ask, outcome) {
    if (!live(ask)) return;
    if (outcome === "done") settle(ask, "reply", ask.reply, TALK_TIMING.replyHideMs);
    else if (outcome === "needs-you") settle(ask, "needs-you", ask.reply, TALK_TIMING.replyHideMs);
    else settle(ask, "error", TALK_TEXT.failed, TALK_TIMING.replyHideMs);
  }

  /** Nothing was sent: the words are dropped and the box says so. */
  function notSent(ask) {
    ask.controller.abort();
    settle(ask, "error", TALK_TEXT.notSent, TALK_TIMING.noticeHideMs);
  }

  function send(ask, prepared) {
    show(ask, ask.waking ? "waking" : "sending", ask.words);
    ask.answerTimer = setTimeout(() => { if (live(ask)) notSent(ask); }, TALK_TIMING.stillWorkingMs);
    prepared.then(chat => {
      if (!live(ask)) return;
      if (ask.state === "waking") show(ask, "sending", ask.words);
      clearTimeout(ask.answerTimer);
      ask.answerTimer = setTimeout(() => { if (live(ask)) stillWorking(ask); }, TALK_TIMING.stillWorkingMs);
      server.ask({
        chat,
        text: ask.words,
        sendId: newSendId(),
        signal: ask.controller.signal,
        onUpdate: update => follow(ask, update),
      }).then(outcome => answered(ask, outcome), error => { if (live(ask)) failed(ask, error); });
    }, () => {});
  }

  function prepare(ask) {
    // A sleeping My Cloud wakes while the person talks; the box says so only once the words are let go.
    const prepared = server.prepare(() => {
      if (!live(ask) || ask.chat) return;
      ask.waking = true;
      if (ask.state === "sending") show(ask, "waking", ask.words);
    });
    prepared.then(chat => { ask.chat = chat; ask.waking = false; }, error => {
      if (!live(ask) || !(ask.state === "listening" || ask.state === "waking" || ask.state === "sending")) return;
      if (ask.state === "listening") speech.stop(ask.sink);
      failed(ask, error);
    });
    return prepared;
  }

  function listen() {
    const ask = begin("listening");
    const listening = () => current === ask && ask.state === "listening";
    show(ask, "listening", "");
    const prepared = prepare(ask);
    ask.sink = {
      transcript(line) {
        if (!listening() || typeof line?.text !== "string") return;
        ask.words = line.text;
        show(ask, "listening", ask.words);
      },
      replaced() {
        if (listening()) closeBox(ask);
      },
      end(info) {
        if (!listening()) return;
        const problem = SPEECH_PROBLEMS.get(info?.reason);
        if (problem) settle(ask, "error", problem, TALK_TIMING.noticeHideMs);
        else if (!ask.words.trim()) closeBox(ask);
        else send(ask, prepared);
      },
    };
    try {
      speech.start(ask.sink, { finishOnRelease: release() });
    } catch {
      if (!listening()) return;
      speech.stop(ask.sink);
      settle(ask, "error", TALK_TEXT.unavailable, TALK_TIMING.noticeHideMs);
      return;
    }
    ask.listenTimer = setTimeout(() => { if (listening()) speech.finish(ask.sink); }, TALK_TIMING.maxListenMs);
  }

  function watchIdle(ask) {
    clearTimeout(ask.idleTimer);
    ask.idleTimer = ask.words.trim() ? null : setTimeout(() => { if (typing() === ask) closeBox(ask); }, TYPE_TIMING.idleMs);
  }

  const dismiss = () => { if (current) cancel(current); };

  return {
    press() {
      if (current && UNDER_WAY.has(current.state)) return;
      dismiss();
      if (voiceInUse()) settle(begin("error"), "error", TALK_TEXT.busy, TALK_TIMING.noticeHideMs);
      else listen();
    },
    open() {
      const ask = current;
      if (!ask) return;
      const chat = ask.state === "listening" ? null : ask.chat;
      cancel(ask);
      openChat(chat);
    },
    typePress() {
      const at = now();
      const repeat = at - lastTypePress < TYPE_TIMING.repeatMs;
      lastTypePress = at;
      if (repeat) return;
      const open = typing();
      if (open) {
        try {
          if (open.words.trim()) typeBox.focus();
          else closeBox(open);
        } catch {}
        return;
      }
      if (current && UNDER_WAY.has(current.state)) return;
      dismiss();
      const kept = draft && at - draft.at < TYPE_TIMING.draftMs ? draft : null;
      draft = null;
      const ask = begin("typing");
      ask.typed = true;
      ask.words = kept?.words ?? "";
      try {
        typeBox.open({ text: ask.words });
      } catch {
        draft = kept;
        closeBox(ask);
        return;
      }
      watchIdle(ask);
    },
    typeInput(text) {
      const ask = typing();
      if (!ask) return;
      ask.words = text;
      watchIdle(ask);
    },
    typeSend(text) {
      const ask = typing();
      if (!ask || !text.trim()) return;
      ask.words = text;
      clearTimeout(ask.idleTimer);
      send(ask, prepare(ask));
      closeTypeBox();
    },
    typeCancel() {
      const ask = typing();
      if (ask) closeBox(ask);
    },
    typeBlurred() {
      const ask = typing();
      if (!ask) return;
      if (ask.words.trim()) draft = { words: ask.words, at: now() };
      closeBox(ask);
    },
    dismiss,
    close: dismiss,
    /** Listening, taking typed words, or an ask on its way that has not been answered yet. */
    busy: () => Boolean(current && UNDER_WAY.has(current.state)),
  };
}
