# Type to MausBot from any app (⌃⌥T)

Date: 2026-10-29 · Branch: `feat/type-shortcut`, made from `feat/talk-my-cloud` (PR #3797), which builds on the talk shortcut (#3764, merged).

## Why

The talk shortcut (hold ⌃⌥Space, speak, let go) reaches MausBot from any app, but only when the person can speak aloud and wants rough words. In a meeting, in an office, or for exact wording, they want to type. This is the same reach with a keyboard: press ⌃⌥T anywhere, type, hit Enter, and read the answer. (Omkar, 2026-10-29: "Talk shortcut and then there is a type shortcut".)

## What it does (Omkar's choices)

- **⌃⌥T** from any app opens a small box where the talk box appears: bottom-centre of the display under the pointer, on every Space and over full-screen apps. It is already focused for typing.
- **Enter** sends the text to the same **Quick asks** chat with MausBot that talk uses, on whatever home is: this computer, or My Cloud through #3797's path, including waking a sleeping My Cloud.
  - The reply shows in the same box, which fades on the talk box's timing.
  - The app the person was in keeps or gets back its focus.
  - "Like talk, but typed": not a mini chat that stays open for back-and-forth.
- **Only the person's words are sent.** No app name, no selected text, no clipboard.
- **macOS only in this version.** Windows is a named follow-up; typing needs no speech, so it can come later.

## Behaviour (my calls unless marked)

- **Keys:**
  - Shift+Enter makes a new line.
  - Enter on an empty or whitespace-only box does nothing.
  - **Esc** closes the box without sending, and so does pressing ⌃⌥T again while the box is empty.
- **Size:** the text field grows to about 6 lines, then scrolls. The text has a limit (e.g. 4,000 characters, the same as the composer if it has one).
- **After Enter:**
  - The typed text shows as the box's first line, the way talk shows its transcript, and then the reply.
  - Typing is disabled while waiting.
  - Once the reply shows, the box gives up keyboard focus and behaves exactly like the talk box: it never takes focus, hides on talk's timing, stays while hovered, and a click opens the chat.
- **Clicking away keeps the draft** (Omkar). If the box loses focus before Enter or Esc, it closes so nothing is left floating. The person might click another app, switch with ⌘Tab, or change Space.
  - The text is kept as a draft, and the next ⌃⌥T within about 5 minutes brings the box back with that text and the cursor at its end.
  - Esc and Enter both drop the draft.
- **⌃⌥T on an open box:** it closes the box if it's empty and does nothing if it holds text. The box already has focus while it's open, since losing focus closes it.
- **Idle:** a box left open with nothing typed closes itself after about 60 s.
- **The echo after Enter:** the typed text appears as a clamp of about 2 lines with an ellipsis, not talk's 400-character reply preview. The reply keeps talk's preview rule, and clicking opens the chat to read everything.
- **One ask at a time across talk and type:**
  - ⌃⌥T while talk is listening, or while an ask is being sent, does nothing.
  - ⌃⌥T while a reply is showing replaces it with a fresh type box.
  - ⌃⌥Space while the type box is open behaves the same way in reverse.
- **Same refusals as talk:** "MausBot is still starting", the My Cloud waking and failure lines from #3797, and "Couldn't reach MausBot". The voice-in-use guard doesn't apply, since there's no microphone.
- **Message labelling:** the message is labelled typed, not spoken, wherever talk marks its asks as voice. If talk adds no such mark, neither does type.
- **Availability:** the same as talk, except Apple speech isn't required. That means macOS, not a remote client, and home being this computer or My Cloud, never a team or another place. Elsewhere the key is free and the setting is hidden.

## Settings

- **A separate row:** "Type to MausBot from any app", on by default, with the key shown. It sits beside the talk row in Settings → General, in both the Simple and the Advanced layouts, and on My Cloud's own page as #3797 does for talk.
- **Key presets:** ⌃⌥T (default), ⌃⇧T, ⌥⇧T. If another app holds the chosen key, the row says so, as talk's does.
- **Independent of talk** (my call). Type has:
  - its own prefs (`typeShortcut`, `typeKey`);
  - its own registration object;
  - its own IPC channels (`type-shortcut:state` and `type-shortcut:set`) and preload surface.

  Turning talk off, or another app holding talk's key, doesn't touch type, and the reverse holds too. The type row shows even where the talk row is hidden for lack of Apple speech.
- **Clicks on server pages:** on a server's page, turning it on or changing the key needs a click, as #3797 does for talk. Turning it off doesn't.

## Anti-goals

- **No stray keystrokes.** Keystrokes meant for another app must never land in MausBot, and the box's keystrokes must never go to another app. The box takes keyboard focus only when the person opens it with the key, and gives it up on send, Esc or close.
- **No pulling the app forward.** The MausBot window must not come forward or take over. The box behaves like Spotlight: the app underneath stays the active app, or becomes active again the moment the box closes.
- **Nothing the person didn't type** is sent.
- **No box left holding focus** after the person has moved on.

## Constraints

- **Code lives in the talk modules:** `electron/talk-*.mjs`, and a `type` mode where sharing is cleaner. `electron/main.mjs` is pinned at its file-size cap, so wiring extends existing lines (`scripts/testing/file-size-ratchet.test.ts`). No cap is raised.
- **The box's page stays as safe as talk's:**
  - a `data:` page with plain text only (no HTML from replies);
  - navigation and new windows refused;
  - a bridge that only counts calls from this box;
  - typed text passing through main to the existing `talk-server` ask path, never straight from the page to a server.
- **The talk box doesn't change:** it stays non-focusable.

## Testing

- **Unit tests** in the style of the talk tests:
  - registering the key, presets, "taken" and availability;
  - the session: empty Enter, Esc, Shift+Enter, one ask at a time across talk and type, replacing a reply, the idle close, refusals;
  - the panel: it becomes focusable only in type mode and gives up focus after send;
  - the settings row and preload gating.
- **Verification recipe:** a "Type" section in `docs/verification/talk-shortcut.md`, with by-hand steps on a side-by-side build:
  - in Safari, ⌃⌥T, type, Enter: the reply shows, Safari stays the active app afterwards, and the MausBot window never comes forward;
  - Esc;
  - Shift+Enter;
  - a full-screen app and another Space;
  - with My Cloud as home;
  - with a password field focused in another app (macOS secure input may block global shortcuts, in which case nothing happens);
  - ⌃⌥T and ⌃⌥Space against each other.

## Left to the builder

- **The panel.** How to make it take key focus without activating the app (Electron's macOS `panel` type with `focusable: true`, or another way), proved by a by-hand check.
- **The details:**
  - exact layout and styling, matching the talk box;
  - the timing constants;
  - the text limit;
  - the module split;
  - the wording of new strings in the talk voice.

## Decisions

**Omkar, 2026-10-29:**
- a separate shortcut, ⌃⌥T;
- "like talk, but typed", not a mini chat;
- only the person's words are sent;
- macOS now, Windows later;
- clicking away closes the box and keeps the draft for the next ⌃⌥T.

**My calls:**
- Shift+Enter for a new line, Esc to close;
- the type box gives up focus once sent and then behaves like the talk box;
- one ask at a time across talk and type;
- separate prefs, IPC and settings row;
- presets ⌃⇧T and ⌥⇧T;
- the 2-line echo;
- a 60 s idle close for an empty box and a 5 minute draft;
- talk's availability rules without the speech requirement.
