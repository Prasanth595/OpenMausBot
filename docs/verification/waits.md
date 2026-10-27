# Waits: tell me when, with no AI while waiting

A wait is a condition a bot sets up once ("tell me when report.txt is there"); plain server
code checks it on a timer, and no model runs until it fires. See the
[design](../superpowers/specs/2026-10-27-waits-design.md).

## Automated checks

```sh
pnpm exec vitest run server/wait-probes.test.ts server/waits.test.ts server/wait-host.test.ts server/routes/waits.test.ts server/drivers/agents-wait-tools.test.ts server/waits.e2e.test.ts src/components/ApprovalCard.test.ts
```

## In a fixture

The fake engine calls `wait_until` on every turn it runs, so the recipe empties
`calls.json` before the wait fires; otherwise the follow-up turn would set a second wait.

```sh
W=$(mktemp -d)
printf '[{"server":"agents","name":"wait_until","input":{"label":"the report is ready","kind":"file_exists","path":"%s/report.txt","follow_up":"Say the report is ready."}}]' "$W" > "$W/calls.json"
FAKE_CLAUDE_TOOL_CALLS_FILE="$W/calls.json" node --experimental-strip-types scripts/control-omb.ts launch
```

Second terminal (same `W`):

```sh
pnpm control:omb new-bot --name Pepper --url http://127.0.0.1:PORT
pnpm control:omb send --bot BOT_ID --text "Tell me when report.txt is there, then say so" --url http://127.0.0.1:PORT
pnpm control:omb wait --bot BOT_ID --timeout 30 --url http://127.0.0.1:PORT
pnpm control:omb messages --bot BOT_ID --limit 10 --url http://127.0.0.1:PORT
echo '[]' > "$W/calls.json"; touch "$W/report.txt"; sleep 25
pnpm control:omb wait --bot BOT_ID --timeout 60 --url http://127.0.0.1:PORT
pnpm control:omb messages --bot BOT_ID --limit 10 --url http://127.0.0.1:PORT
curl -s http://127.0.0.1:PORT/api/notifications
sleep 10; pnpm control:omb messages --bot BOT_ID --limit 10 --url http://127.0.0.1:PORT
```

Expected:

- After the first `messages`: a `wait_until` tool row with `"ok": true`, and an
  `options` card titled `Waiting: the report is ready`.
- After the `touch`: exactly one bot line `the report is ready: done. <W>/report.txt is there now.`
  carrying `"wait": { "id": "...", "status": "fired" }`, then a user line
  `[Wait finished: the report is ready] Say the report is ready.` and the fake engine's reply.
- One notification with `"kind": "wait"` and `"title": "Pepper's wait is over"`.
- The last `messages` still shows one fired line.

**What it does not prove:** the desktop card's Cancel button (the card test and the e2e
undo call cover it), phones, a real page on the internet, and what a real model does with
the follow-up (the fake engine replies `hello from fake claude` regardless of the prompt).

**Cleanup:** Ctrl-C the launcher; `rm -r "$W"`.

## Last exercised

2026-10-27, Node 24, fixture log
`/var/folders/7b/15jj691d4tj_7vq99cqvwgbr0000gn/T/openmausbot-verification-evidence/server-1793120821720-76712.log`.
Every expectation above held. The card row carried `"answered": "allow", "dismissed": true`
and the subtitle `When the report is ready, Pepper will: Say the report is ready.`

Fired line:

```json
{"role": "bot", "kind": "text", "text": "the report is ready: done. <W>/report.txt is there now.", "wait": {"id": "3742241f-e4e9-49a2-b06e-509804286e6e", "status": "fired"}}
```

Follow-up user line, then the fake engine's reply:

```json
{"role": "user", "kind": "text", "text": "[Wait finished: the report is ready] Say the report is ready."}
{"role": "bot", "kind": "text", "text": "hello from fake claude"}
```

Wait notification (the follow-up turn also left a separate `"kind": "done"` notification):

```json
{"kind": "wait", "botName": "Pepper", "title": "Pepper's wait is over", "body": "the report is ready: done. <W>/report.txt is there now.", "read": false}
```
