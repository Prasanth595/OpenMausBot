# Talk shortcut (hold to talk from any app)

Hold ⌃⌥Space from any app, speak, let go. The words go to MausBot's "Quick asks"
chat and a never-focused box at the bottom of the screen shows the reply.

The real hotkey, the microphone, window focus and Spaces are macOS behavior:
the control surface cannot drive them, so this is not in the map in
[README](README.md). Verify them by hand on a packaged build, exactly as below.

## Floor: automated checks

```sh
node --test electron/talk-*.node-test.mjs electron/desktop-prefs.node-test.mjs electron/preload.node-test.mjs electron/speech-helper-release.node-test.mjs
pnpm exec vitest run electron/speech.test.mjs server/task-select.test.ts server/talk-server.e2e.test.ts src/lib/call-presence.test.ts src/components/TalkShortcutRow.test.ts --maxWorkers=1
pnpm typecheck && pnpm lint && pnpm i18n:check
```

They prove key parsing and registration, the press/release state machine with
injected clocks and speech, the box's window flags and states, the local-server
ask (thread, owner header, send id, SSE follow, needs-you, timeout), preference
storage, the Settings row, scoped speech stop and the call-presence signal.
They do not prove the real hotkey, the microphone, that the box never takes
focus, that it shows over full-screen apps and other Spaces, or the release of
⌃⌥ after speech (no unit test covers that release path).

`docs/verification/evidence/talk-shortcut/` holds the box page rendered in a
headless Chrome for every state in light and dark (`light-*.png`, `dark-*.png`).
Regenerate them by calling `talkPanelHtml` from `electron/talk-panel.mjs` and
`render({state, text})` for each state.

## Setup

- A packaged build of the branch installed beside, never over, the installed
  OpenMausBot (maintainers: the OMB2 side-by-side build). Never touch
  `/Applications/OpenMausBot.app` or `~/.openmausbot`.
- Launch with `OMB_DATA_DIR=$HOME/.openmausbot-test` unless the check needs real
  bots. Only one running app may hold the key: quit any other MausBot first.
- Use composer dictation once first so Microphone and Speech Recognition are
  granted.

## By hand

1. **Settings row.** Settings → General shows "Talk to MausBot from any app",
   on, "Hold ⌃⌥Space, speak, let go".
2. **Hold, speak, release in another app.** In Safari's address bar: hold ⌃⌥,
   tap Space, say "what can you do", let go of ⌃⌥ (not Space). Expect live
   words, then the words send on the release (the path no unit test covers),
   then the reply, bottom-centre of that display. `osascript -e 'tell
   application "System Events" to name of first application process whose
   frontmost is true'` prints `Safari` before and after; the caret still blinks
   in Safari; the box never takes focus and the MausBot window never raises.
3. **Hide timing.** The box hides 12 s after the reply; with the pointer on it,
   it stays until the pointer leaves.
4. **Click opens the chat.** Clicking it brings MausBot forward on the "Quick
   asks" chat; the chat open before the ask had not changed until then.
5. **Spaces and full screen.** In a full-screen app and on another Space, the
   box shows there.
6. **No speech.** Tap and let go without speaking: the box closes, no error.
7. **Voice already in use.** During a voice call, and while composer dictation
   is on: "Voice is in use in MausBot"; the call or dictation carries on.
8. **Mic indicator off after every speech use (scoped speech stop).** Start and
   stop composer dictation, take one push-to-talk call turn and one Live call
   turn: after each, the orange microphone indicator in the menu bar is off.
9. **Chat recreated.** Delete the Quick asks chat, ask again: a new Quick asks
   chat.
10. **Other key presets.** Switch to ⌃⇧Space: ⌃⌥Space does nothing in MausBot
    any more; ⌃⇧Space works and ends on letting go of ⌃ or ⇧. Repeat for
    ⌥⇧Space.
11. **Off.** Turn it off: the key does nothing.
12. **Second keyboard layout.** With a second input source enabled and System
    Settings → Keyboard → Keyboard Shortcuts → Input Sources → "Select next
    source in Input menu" on (⌃⌥Space): note whether Settings shows "⌃⌥Space is
    used by another app" or the press never arrives or switches the layout;
    either way the ⌃⇧Space and ⌥⇧Space presets must work.
13. **Dev loop.** `pnpm dev:server`, `pnpm dev`, `pnpm dev:desktop`: an ask
    reaches the dev server through Vite's `/api` proxy, both the POST and the
    SSE stream (the reply arrives live, not only at the end).
14. **Light and dark.** Switch macOS appearance: the box's colours, the warning
    and error text and the card height follow (compare with the evidence PNGs);
    long replies stop at 400 characters with an ellipsis and the card grows to
    at most 240 px.
15. **My Cloud home.** With the window on My Cloud's page, the ask still goes to
    this computer's server; clicking the box only shows the window (it cannot
    open the Quick asks chat there). This is a known limitation.
