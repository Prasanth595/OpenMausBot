# Saved steps: repeat a computer task without AI

Date: 2026-10-27 · Branch: `feat/learned-replay` · Idea source: Atticus (SaarthurR/atticus-mac, MIT). We take the idea, not the code.

## Why

A bot that clicked through a task on the person's computer once should do it
again instantly, for free, when asked the same thing. Today every repeat pays a
full model turn (tokens, 10-60 s, and a fresh chance to wander). Atticus showed
that "ask once, the AI works it out; ask again, it replays in a blink" is the
part people feel.

## Goals

- Record every host-computer tool call (cua-driver over the gated bridge) and
  its result, per request.
- When a request settles successfully and every step can be replayed safely,
  save the steps for that bot, keyed by the request's words.
- When the person later sends the same words to the same bot, run the saved
  steps with no model call. Any failed step hands the request to the AI with a
  note saying what already happened.
- The person sees when steps were saved and when a reply came from saved steps,
  and can forget them in one click.

## Non-goals (v1)

- Local VM, VPS and Cloud Boat computers; the bot's own browser tools.
- Room (group) turns, routine runs, peer asks.
- Fuzzy or semantic matching. Same words (after normalising) or nothing.
- Editing or teaching steps by hand; a list of saved steps in bot settings.
- Phone UI for the chips (phones ignore the new message fields).

## Anti-goals (a failure even if it "works")

- A replay that does anything the AI run did not do.
- A replay that skips an approval the AI run would have needed.
- Typing text that did not come from the person's own words.
- Clicking by pixel position. Pixels move; labels do not.
- Steps a bot can write or edit itself (prompt injection would plant them).

## Design

### 1. Recording (`server/mcp-bridge.ts`)

The bridge already sees every `tools/call` and its response. It also runs the
Local VM and VPS proxies with the same control variables, so recording is
switched on by a separate `OMB_COMPUTER_JOURNAL=1` that only the host mount
(`gatedLocalComputer`) sets (builder's call). With it set, the bridge pairs each
request id with its response and POSTs `{tool, arguments, result}` to
`/api/internal/computer/journal` **before** forwarding the response to the
engine (1 s timeout, then forward anyway). Awaiting keeps the journal complete
when the turn ends right after the last step. Image content is dropped; from
`structuredContent` only what replay needs is kept (`elements[]`:
`element_index`, `element_token`, `role`, `label`, `parent_index`, `depth`;
plus `pid`, `window_id`, `bundle_id`, `name`, `app_name`, `window_title`,
`isError`, `refusal`). The server resolves the token to `{botId, threadId,
generation}` and keeps the journal in memory per turn.

### 2. Saving (`server/saved-steps/`)

On the existing success signal (`settleTrackedRequest` clearing
`requestPending` with `turnSucceeded`), the turn's journal becomes a recipe only
if **all** hold:

- direct message from the person; text only (no images, files, reply, app or
  data context); no steering during the request; host computer;
- every computer call happened in one turn of the request. The journal is keyed
  by the request, so a `select_computer` hand-off (whose first turn made no
  computer calls) still saves (builder's call);
- no denials, no tool error, no refusal anywhere in the journal;
- request text has no moment words (this, that, it, here, there, these, those,
  them);
- 1 to 40 action steps, each replayable:
  - element actions (`click`, `double_click`, `right_click`, `type_text`,
    `set_value`, `press_key`, `scroll`) addressed by `element_token` or
    `element_index` that maps to an element with a non-empty label in the
    preceding `get_window_state` result of that window;
  - `type_text`/`set_value` text appears word for word (case-insensitive) in
    the request;
  - `launch_app` (its `urls`, if any, appear in the request), `bring_to_front`,
    `hotkey`, `press_key` without an element;
  - anything with `x`/`y`, `drag`, `move_cursor`, `zoom` or a `browser_*` tool
    makes the whole request not saveable.

Observation calls (`get_window_state`, `list_apps`, `list_windows`, …) are not
replayed; they are how the run found its way. The recipe stores each action
with its target described by identity, not ids: app `{bundle_id, name}`, window
`{title}`, element `{role, label, path}` where `path` is the role:label chain
of its ancestors from the same snapshot.

Store: `DATA_DIR/bots/<botId>/saved-steps.json`, mode 0600, outside the
bot-writable workspace, written atomically. At most 200 recipes per bot; one
unused for 60 days is dropped. Deleting the bot deletes its folder already.

Key: lowercase, Unicode-normalised, punctuation stripped, filler words dropped
(please, can you, could you, hey, just, now, quickly), spaces collapsed.

The saved bot reply is patched with `savedSteps: {recipeId, learned: true}`.

### 3. Replaying (wrapper around `sendTurn`)

**Approval mode: Full access only.** A replay runs only when the bot's
approval mode for this turn is Full access. In Ask, Auto or Edits the AI run
was asked about (or reviewed) every host-computer call, reads included, and a
replay cannot reproduce that faithfully, so those bots always use the AI.
Recipes are still saved in any mode; they are used once the bot is on Full
access. Full access is the default most people run (it approves on its own), so
the approval step below still emits `request.opened` per action for the
decision log and the safety floor, but never shows a card.

Modelled on `QuickModelFallback`, wrapped where the engine starts
(`server/index.ts` `quickFallback.sendTurn`). By then the user message, turn
generation, gated computer, approval mode and Stop handling are all in place.
It replays only when: the setting is on, the bot has a recipe for the key, the
turn is a direct text-only person turn, and the host computer is mounted.

For each step, in order:

1. Resolve the target fresh: `list_apps` → pid by `bundle_id` (else name);
   `list_windows(pid)` → window by exact title, else the only window that pid
   has; `get_window_state(pid, window_id, include_screenshot:false)` → the
   unique element with the same role, label and path. No unique match is a
   failure.
2. Ask exactly as an engine does: emit `request.opened` with
   `tool: "mcp__computer__<name>"`, `approvalScope: "local-computer"`,
   `allowSession: false`, through the normal handler. Full access approves on
   its own; otherwise the person sees the usual card. A denial stops the replay
   and the reply says what was declined (no AI fallback).
3. Call the tool through an in-process MCP client on the turn's own
   `integrations.localComputer` (the gated proxy, so "person took control" and
   busy checks still apply).
4. `isError`, a JSON-RPC error, a refusal, a control-gate refusal or a 30 s
   timeout is a failure.

The normal approval handler answers the engine adapter, and Stop interrupts the
engine in `runningTurnEngines`. The replay therefore registers itself there as
the turn's engine for the length of the replay, with its own `respondToRequest`
and `interruptTurn` (precedent: `openrouter-free.ts`). `SendTurnInput` has no
turn id, so on fallback the engine's events are remapped onto the replay's turn
id the way `QuickModelFallback` does (builder's calls).

The wrapper emits the normal runtime events (`turn.started`, an item per step,
`assistant_text`, `turn.completed {ok:true}`), so transcript, digest and request
settling work unchanged. The reply is the saved reply's first sentence, marked
`savedSteps: {recipeId, replayed: true}`.

On failure the recipe is deleted, the held events are dropped, and the real
engine's `sendTurn` runs with the same turn id and this note appended to the
request: "A saved run of this request did steps 1–k of N and failed at step
k+1 (<tool> on <label>): <error>. The screen may already be partly changed;
look before acting." A successful AI run saves a fresh recipe.

Stop during replay cancels it like any turn.

### 4. Person-facing

- Bot reply chips (desktop renderer): "Saved these steps · next time no AI ·
  Forget" after learning; "Repeated saved steps · no AI · Forget" after a
  replay. Forget calls `DELETE /api/bots/:botId/saved-steps/:recipeId`.
- Settings → General: "Repeat computer tasks without AI" (default on). Off
  stops both saving and replaying.

### 5. Policy check

`docs/computer-use-integration.md` keeps CUA as the only computer-use path.
Replay re-issues the driver's own tool calls through the same gated bridge: no
new input route, no second binary, one permission identity. Update that doc's
"Later: macro teach/replay" line to point here.

## Testing

- Unit: key normalising; the saveability rules (each rule has a test that
  refuses); target resolution against recorded `elements` fixtures (unique,
  none, ambiguous); store prune and caps.
- Bridge: the journal POST happens before the response reaches the engine;
  images are stripped; a slow or failing POST still forwards within 1 s.
- Replay: fake MCP client + fake approval handler: success path emits the right
  events; a denial stops without fallback; a failed step falls back with the
  note and deletes the recipe; Full access approves without a card; Ask shows
  one card per step.
- Fixture per `docs/verification/README.md` with the fake engine scripting
  computer tool calls, then the same request again: second turn has no engine
  call.

## Decisions

- Omkar, 2026-10-27: replays run for Full access bots only; other modes always
  use the AI.
- My calls: journal switched on only by the host mount; journal keyed by
  request so a `select_computer` hand-off still saves; the replay registers as
  the turn's engine for answers and Stop; fallback events remapped onto the
  replay's turn id.

## Left to the builder

Exact module split under `server/saved-steps/`, message field names in
`shared/wire.ts`, chip styling (follow existing chips), journal batching.
