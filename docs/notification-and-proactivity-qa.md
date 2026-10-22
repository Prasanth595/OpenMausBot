# Agent notifications and proactivity QA

OpenMausBot treats **proactivity as an explicit trigger**, not as a hidden
heartbeat. A bot may continue within an active task through Auto mode, may be
started by a Routine or Webhook, and may coordinate peers when its engine and
profile allow that. This change does not add background polling that invents
work or sends messages without one of those configured paths.

## Notification policy

The harness is the single owner of interruption policy. A bot with
notifications disabled remains quiet. Otherwise it may emit:

- **Needs approval** or **has a question** when the task is blocked on the user.
- **Needs your hands** when a computer task requires a takeover.
- **Finished** only when there is a non-empty result to summarize.
- **Routine failed** when a scheduled or manual routine run cannot complete.

Every notification carries both the bot ID and the exact task thread ID. A
click must select that bot **and switch to that task**, including a routine's
detached task; opening whichever task happens to be active is a failure.

Desktop notifications are suppressed while the window already has focus. The
iOS app can present live or replayed notifications while it is running and uses
the same bot/task target when the notification is tapped. Waking a terminated
iOS app still requires a future APNs relay; local network or VPN connectivity
alone cannot provide closed-app delivery.

### Muted threads

A single thread can be muted from its row menu (**Mute notifications**), with
`PATCH /api/bots/:botId/tasks/:threadId` and `{"notificationsMuted": true}`
(`false` unmutes, `null` returns the thread to the default), or by a Chief of
Staff with the `mute_thread` tool. The bot's other threads keep notifying, and
the per-bot switch still wins: a bot with notifications off stays quiet in an
unmuted thread.

A muted thread sends no notification when it finishes, resumes with
delegated results, or waits on an approval, a question or a sign-in. Those
waits still show in the sidebar, and the thread's messages and unread state
are unchanged. Failures always come through: **couldn't start**, **routine
failed** and incidents, including escalations (`features.chiefEscalations`),
notify even from a muted thread. With escalations on and no Chief of Staff, a
peer approval waiting in a muted thread reaches the person as an escalation,
since its own approval notification was not sent.

Nothing is muted until someone chooses it. With `features.muteBotOpenedThreads`
set to `true` in `config.json`, threads a bot opened (a teammate's handoff
thread, a bot's own `start_thread`) start muted; threads the person started and
each bot's main chat do not. A thread's own choice overrides that default.

`mute_thread` is Chief-only. It mutes a thread a bot opened, either on the
Chief itself or opened by a bot the Chief can reach. A thread the person
started, and each bot's main chat, can be muted only by the person.

## Automated coverage

| Contract | Test |
|---|---|
| Per-agent off means quiet; empty completions stay quiet; summaries are bounded | `server/notify.test.ts` |
| A muted thread drops news and waits but not failures; the opt-in default never mutes the person's threads or a main chat; mute persists | `server/thread-mute.test.ts` |
| Muted threads stay quiet while the main chat notifies; the per-bot switch wins; the HTTP API and `mute_thread` refuse what they must | `server/thread-mute.e2e.test.ts` |
| Browser click returns the exact bot/task target | `src/lib/notify.test.ts` |
| Store navigation selects the bot and switches the task | `src/state/store.test.ts` |
| Routine failure receipt and callback occur once | `server/routines.test.ts` |
| Real failed routine emits one `routine-failed` notification and no duplicate `done` | `server/notification-wiring.test.ts` |
| iOS target parsing and detached-task decision | `ios/Tests/CompanionCoreTests/DecodingTests.swift` |
| Paired-device route policy remains default-deny | `companion/test/routes.test.ts` |

## Manual release pass

Run these with two bots, notifications enabled on one and disabled on the
other:

1. Background the desktop window. Complete a normal task and confirm one
   result notification. Click it and verify the exact task opens.
2. Trigger an approval and a question. Confirm their copy, click targets, and
   that no duplicate completion notification appears before the task settles.
3. Run a routine manually, then create a controlled failing run. Confirm the
   receipt shows the detached task and the failure generates exactly one alert.
4. Repeat the above with notifications disabled for that bot; the chat and run
   receipt should update without a system alert.
5. On iOS, tap a live/replayed notification for a non-active routine task.
   Confirm the app switches the server-side active task before navigating.
6. Exercise Auto mode, a Routine, and a Webhook independently. Verify each has
   a visible initiating user/configured trigger and that no unconfigured
   heartbeat starts work.

Live provider, OS-permission, backgrounding, and APNs behavior cannot be proven
by unit tests alone and remains part of the signed desktop/iPhone release pass.
