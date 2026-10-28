# Talk shortcut (hold to talk from any app)

Hold ⌃⌥Space from any app, speak, let go. The words go to MausBot's "Quick asks"
chat and a never-focused box at the bottom of the screen shows the reply.

The real hotkey, the microphone, window focus and Spaces are macOS behavior:
the control surface cannot drive them, so this is not in the map in
[README](README.md). Verify them by hand on a packaged build, exactly as below.

## Floor: automated checks

```sh
node --test electron/talk-*.node-test.mjs electron/home-window.node-test.mjs electron/desktop-prefs.node-test.mjs electron/preload.node-test.mjs electron/speech-helper-release.node-test.mjs
pnpm exec vitest run electron/speech.test.mjs electron/skin-overlay.test.mjs server/task-select.test.ts server/talk-server.e2e.test.ts src/lib/call-presence.test.ts src/components/TalkShortcutRow.test.ts --maxWorkers=1
pnpm typecheck && pnpm lint && pnpm i18n:check
```

They prove key parsing and registration, the key let go while home needs a
sign-in and taken back on My Cloud or this computer, the press/release state machine
with injected clocks and speech, the box's window flags, states, skin theme and
pinned display, the local-server ask (thread, owner header, send id, SSE follow,
needs-you, timeout, a 409 `moved`, a server still starting), preference storage,
the Settings row, scoped speech stop, the call-presence signal and the quiet
update waiting for a talk ask.
They do not prove the real hotkey, the microphone, that the box never takes
focus, that it shows over full-screen apps and other Spaces, or the release of
⌃⌥ after speech (no unit test covers that release path).

### My Cloud

```sh
node --test electron/talk-cloud.node-test.mjs electron/talk-server.node-test.mjs electron/talk-session.node-test.mjs electron/talk-main.node-test.mjs electron/talk-panel.node-test.mjs
pnpm exec vitest run server/talk-cloud.e2e.test.ts --maxWorkers=1
```

With fakes for My Cloud, the Admin and the window's session, they prove: asks go
to My Cloud's verified origin over the window's own sign-in there (`credentials:
include`, an `origin` header, no background header, no token of its own) and
never to this computer's frozen server; no verified origin asks nothing; an
ended session signs the window in again once, a failed sign-in says so; an
asleep My Cloud is woken at the press through the Admin (`openSleepingCloud`),
two presses share one wake, My Cloud's own asleep answer to a read wakes it
and reads once more (no other failure is retried, and the chat's creation is
never repeated), a wake that fails or passes 45 s says so and asks nothing;
home moving during a re-sign-in asks nothing more; the message goes once after
hello (a 401 repeat keeps its send id); the reply's 120 s start at the send,
and words never sent say so; a server that refuses
`select` makes the chat without it; "Waking My Cloud…" shows after the words
are let go and presses are ignored meanwhile; an ask stays with the server that
found its chat when home changes; the box link keeps its escaped ids; the
Settings bridge and its channels reach My Cloud's own page only while it is
home at the verified origin and from a frame with that real origin (an opaque
origin is refused), never a team's or another server's page, and on that page
only turning it off goes without a click. The e2e test asks a real server over
a cookie redeemed from a one-time owner code: answered,
Quick asks not opened, another origin refused, an ended session renewed once,
one that can't be renewed says sign in.
They do not prove Electron's cookie jar, a real My Cloud behind its proxy, its
sleep, the Admin's wake or how long a real wake takes: check those by hand
below.

`docs/verification/evidence/talk-shortcut/` holds the box page rendered in
headless Chrome for every state in the app's light and dark skins
(`light-*.png`, `dark-*.png`). Regenerate them with:

```sh
node scripts/talk-box-evidence.mjs   # Chrome path as an argument or CHROME= when not in /Applications
```

It renders at the box's own size: a 400 px wide viewport as tall as the card
(56 to 240 px, the height `render()` returns, clamped as `talkPanelBounds`
does) at 2x, with the 56 px mascot, reduced motion (a still listening ring) and
a grey desktop behind the transparent page. Each skin is rendered with macOS's
appearance emulated the other way round, so a light card on a dark macOS shows
the box following the app's skin (`render({state, text, theme})`), not the
media query. `reply-long` is a 400-character reply cut with an ellipsis;
`reply-wide` is a reply of wide characters cut at ten lines, the tallest box.

Rendering by hand instead: pass `theme`, or the page falls back to the media
query, and Chrome's `--blink-settings=preferredColorScheme=0` is dark and `=1`
light (the reverse of what it reads like); a `--window-size` wider than 400 px
or taller than the card shows a box the app never draws.

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
14. **Light and dark.** Settings → Appearance → Theme: Light, then Dark, then
    System while switching macOS appearance. The box's colours, the warning and
    error text and the card height follow the app's theme, not macOS's (Dark
    with macOS light still gives a dark box; compare with the evidence PNGs).
    Long replies stop at 400 characters with an ellipsis, and the card grows to
    at most 240 px with its bottom edge showing (a Japanese reply is cut at ten
    lines).
15. **Home needs a sign-in.** With this computer's bots on My Cloud and the
    MausBot Cloud sign-in ended (Settings → MausBot Cloud → sign out): ⌃⌥Space
    does nothing in MausBot and another app can take it. Sign in again: the key
    works without a restart. A box still up when the move froze this computer
    says "MausBot lives on My Cloud now. Try again in a moment."
16. **Server starting.** Quit, relaunch and press at once, before the window
    loads: "MausBot is still starting. Try again in a moment."

### By hand: My Cloud

Needs a test account whose bots were moved to a test My Cloud, on a packaged
build of the branch beside the installed app (never Omkar's real My Cloud, never
a data folder that was ever opened against real data). My Cloud must run this
branch's server for the Settings row (an older one has no row, and makes the
Quick asks chat the open one there once).

17. **Ask My Cloud.** Window on My Cloud's page, Safari in front: hold ⌃⌥Space,
    say "what can you do", let go. The reply shows in the box; My Cloud's
    MausBot has a "Quick asks" chat with the ask, and MausBot's open chat there
    did not change. This computer's frozen server got no request (its log shows
    none).
18. **Click.** Click the box: the window comes forward on My Cloud's Quick asks
    chat. With a team's Cloud shown in the window, the click brings My Cloud
    back first, then the chat.
19. **Asleep.** Let My Cloud sleep (its plan sleeps when idle; the Cloud
    settings say asleep). Hold, speak for a few seconds, let go: "Waking My
    Cloud…" with the words, then the reply, sent once (one user message in the
    chat). Pressing again while it wakes does nothing.
20. **Wake fails.** With the network off after letting go, or a Cloud that
    can't start: "My Cloud didn't wake up. Try again in a moment." within about
    45 s, nothing in the chat. Network off while awake: "Couldn't reach My
    Cloud. Try again in a moment."
21. **Session ended.** Sign this app out on My Cloud's page only (its own
    sign-out), then press: the window's session there is renewed by itself and
    the ask goes through. "Sign in to My Cloud again, then try again." shows only
    when that renewal fails while this app is still signed in to MausBot Cloud
    (the Admin refuses or can't give a new code); signing out of MausBot Cloud
    instead makes home need a sign-in and lets the key go (step 15). The
    automated tests cover the failed renewal; there is no by-hand step for it.
22. **Settings row.** On My Cloud's page, Settings → General shows "Talk to
    MausBot from any app"; turning it off frees the key and this app's own
    Settings shows it off too. On a team's Cloud page and on another own
    Cloud's page the row is absent (`window.ogb.talkShortcut` is undefined in
    the page's devtools).
23. **Teams stay off.** With a team's Cloud shown, a press still asks My
    Cloud's MausBot, never the team's.
