# Talk shortcut on My Cloud

Date: 2026-10-29 · Branch: `feat/talk-my-cloud` (on `feat/talk-shortcut`, PR #3764) · Follows
[the talk shortcut](2026-10-27-talk-shortcut-design.md).

## Why

Once this Mac's bots moved to My Cloud, ⌃⌥Space went quiet: the shortcut only spoke to this Mac's own server, which
is frozen after the move. The people most likely to use a hold-to-talk key are the ones who moved everything to My
Cloud. MausBot lives there now, so the key should follow it.

## Decisions (Omkar, 2026-10-29)

1. **My Cloud only.** While home is My Cloud (`homeOf` → `{ kind: "cloud", origin }`, this Mac frozen), the key works
   and asks go to **My Cloud's** server: the same Quick asks chat with MausBot, made there on first use and kept per
   server in desktop prefs (`quickAsks[<My Cloud's origin>]`). A team's Cloud, another Cloud of the person's own, a
   home that needs a sign-in (`kind: "signin"`), a remote client and a Mac without Apple speech stay unavailable.
2. **Asleep → wake it and wait.** The press wakes a sleeping My Cloud through the existing wake path, the box says
   "Waking My Cloud…" once the words are let go, and the ask goes on as usual. A wake that fails or takes too long says
   so; nothing is sent twice.
3. **Clicking the box** opens that chat on My Cloud's page in the app window, through the same escaped
   `openmausbot://thread/<id>?bot=<id>` link.
4. **The Settings row** is reachable on My Cloud's own page while it is home, and nowhere else but this app's page.
5. Speech stays on this Mac. The 60 s cap, the voice-in-use guard, "still starting" and the busy rules are unchanged;
   for My Cloud, "starting" means waking.
6. My Cloud's failures name My Cloud, in the box's existing plain style.

## How the desktop reaches My Cloud: the window's own sign-in

Reused, not new: the person's own session at My Cloud that the app window already holds (its cookie in Electron's
default session), the same path Files and lending use for My Cloud's API:

- `electron/cloud-sync-client.mjs:23` (`createSyncClient`, line 28): `session.defaultSession.fetch` with
  `credentials: "include"`, `redirect: "error"`, `cache: "no-store"` and an `origin` header naming My Cloud.
- `electron/computer-sharing.mjs:287` (lending's `request`): the same, including POSTs.
- `electron/cloud-send-main.mjs:94` (`read`): a 401 signs the window in again and asks once more.
- Signing in again is `reconnectCloud` (`electron/main.mjs:1488`) → `signInCloudSession`
  (`electron/cloud-home.mjs:229`): a fresh one-time code from the Admin for the Cloud it verified, redeemed into the
  window's own cookie, and refused for any origin but My Cloud's (or another own Cloud's, which talk never names).
- My Cloud's server keeps its rules for such a session (`server/request-auth.ts:533`, `:536`): same origin, and a
  change only from a request that proves it (the `origin` header). Nothing there is relaxed.

The origin talk uses is My Cloud's only while both agree: home's origin (`homeWindow.current()`) and the Admin's
verified one (`myCloud()`, `electron/main.mjs:2622`). Otherwise the box says it couldn't reach My Cloud and nothing is
asked.

Why not `openOwnerSession` (`electron/cloud-send-main.mjs:24`): it mints a new Admin code and a new labelled owner
session for every send and is meant for background work (it marks every call as not the person). A quick ask is the
person using My Cloud, so it should look like the window does: no `x-omb-background` header, which also keeps My
Cloud awake while MausBot answers. No new credential, token or scope is introduced.

## Waking

`electron/talk-cloud.mjs` wraps the existing talk server (`talk-server.mjs`) for My Cloud:

- **At the press**, if the shared power gate (`cloudPower`, `electron/cloud-power.mjs`) says My Cloud is asleep (the
  Admin's word, or My Cloud's own "going to sleep" answer), the wake runs while the person is still talking:
  `openSleepingCloud` (`electron/cloud-power.mjs:86`) with the Admin's `wakeHome()` and `setWaking()`, exactly as the
  window opens a sleeping My Cloud (`electron/home-window.mjs:404`). Its check is My Cloud answering at all
  (`GET /api/auth/session`); a signed-out session is the next request's 401, which signs in again.
- A request answered "asleep" (503 with `x-omb-cloud-power: asleep`) holds the gate and the preparation wakes My Cloud
  and tries once more. Only reads and the chat's creation are tried again; a 503 means neither happened.
- The wake has 45 s; past that, or when My Cloud never answered, the box says "My Cloud didn't wake up. Try again in a
  moment." and nothing was sent.
- A woken My Cloud releases the gate's hold (`power.woke()`), as opening it in the window does.
- In the box: "Listening…" while the key is held (the wake runs meanwhile), then "Waking My Cloud…" with the words
  until My Cloud answers, then "Sending to MausBot…", "MausBot is thinking…" and the reply as before. A press during
  "Waking My Cloud…" is ignored like any ask under way, and it counts as busy for the quiet update.

Nothing is sent twice: the message goes once, after the event stream says hello, with its send id. The only repeat of
a POST is after a 401, which the server refused before reading it, and the server also drops a second message with the
same send id (`server/send-idempotency.ts`).

`select: false` on the chat's creation: My Cloud may run a server from before it. Such a server ignores the field (the
handler before `646d48da8` read only `title`, `projectId`, `approvalMode` and `cwd`), so the chat is made and becomes
MausBot's open chat there once. A server that refused the field with a 400 gets the creation again without it.

## Failure states (the box, main's strings)

| Code | Box says |
| --- | --- |
| `cloud-down` (no answer, not asleep; or no verified origin) | Couldn't reach My Cloud. Try again in a moment. |
| `cloud-waking` (asleep or waking when a request failed) | My Cloud is still waking. Try again in a moment. |
| `wake-failed` (the wake failed or passed 45 s) | My Cloud didn't wake up. Try again in a moment. |
| `cloud-signin` (401, and signing in again failed) | Sign in to My Cloud again, then try again. |
| `no-mausbot`, `refused`, `lost`, timeouts | as on this Mac |

This Mac's "moved" notice (a press while the move froze this Mac but before home became My Cloud) now reads "MausBot
lives on My Cloud now. Try again in a moment.": the next press goes there.

## The Settings row on My Cloud's page

The talk bridge (`window.ogb.talkShortcut`) is still kept off every server page by default: it is in neither
`REMOTE_SAFE` nor `HOME_PAGE` (`electron/preload.cjs:64`, `:66`). It is added for one more page only: **My Cloud's own
page while it is home**. Two checks, both in main:

- `talk-shortcut:page` (sync, asked by the preload only on a page that is already the home page) and the
  `talk-shortcut:state`/`talk-shortcut:set` handlers allow a sender that is this app's page (`localOnly`), or My
  Cloud's page by `cloudPageAsking(event) === "cloud"` (`electron/main.mjs:2625` →
  `cloudPageSenderAllowed`, `electron/cloud-home.mjs:317`: the main window's main frame, at the Admin-verified origin,
  open as the active server) **and** home is My Cloud at that same origin.
- A team's Cloud, another Cloud of the person's own, a subframe, another window or an arbitrary server page fails the
  first check; My Cloud's page before the move made it home fails the second.

Why this is safe enough: My Cloud is the person's own server, already trusted with everything the shortcut sends it;
the two channels only read and switch the shortcut and its key preset, never speech, files or a credential. `HOME_PAGE`
itself is not widened, because the preload's `home:page` is also true on a team's page.

The row needs My Cloud to serve a page with the row (this branch's web app or later); an older My Cloud page simply has
no row.

## What stays off

- Teams, other own Clouds, a sign-in-needed home, remote clients, Windows/Linux, no Apple speech.
- Speech, composer dictation and calls on My Cloud's page: the microphone channels stay `localOnly`.
- The Quick asks chat moved from this Mac is not looked up on My Cloud by title; My Cloud gets its own on first use.
- Development builds (`pnpm dev:desktop`) never have My Cloud as home, so the cloud path is packaged-only.

## Testing

- `electron/talk-cloud.node-test.mjs`: the window-session request (origin header, include, no background header),
  401 → sign in again → once more, a failed sign-in, an asleep answer holding the gate, the wake (waking said, Admin
  wake, check, gate released), a failed and a slow wake, an asleep answer mid-prepare → wake → one retry, two
  prepares → one wake, no verified origin.
- `electron/talk-server.node-test.mjs`: a request's own TalkServerError passes through; the 400 `select` fallback.
- `electron/talk-session.node-test.mjs`: "waking" after release, then sending; presses ignored and busy while waking;
  a wake failing while listening or after release; the My Cloud notices.
- `electron/talk-main.node-test.mjs`: available on a My Cloud home, not on sign-in; a press asks My Cloud through the
  window's fetch and the box link opens the chat with escaped ids; the guards; the preload exposes `talkShortcut` on
  My Cloud's home page only; main's wiring.
- By hand: `docs/verification/talk-shortcut.md`, "My Cloud".
