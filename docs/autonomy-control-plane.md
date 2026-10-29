# System-wide autonomy control plane

**Status: policy committed in a draft PR / runtime integration pending**

This contract defines bounded, persistent execution for authorised bots. It is designed to sit on top of the existing durable runtime and managed browser profile system.

## Operating model

Use one managed browser profile and mission namespace per client_id / project_id / bot_id. A human signs in once through the isolated browser handoff. Routine navigation and reversible work may continue after browser-engine restarts. Authentication is not authorisation.

## Approval lanes

- **Observe, auto:** navigate, read, search, inspect, screenshot and non-executable downloads.
- **Reversible, auto:** draft, local edit, local test, checkpoint and evidence creation.
- **Consequential, owner gate:** send, publish, deploy, merge, payment, DNS, delete, credential and permission changes.
- **Unknown, fail closed:** ask and do not widen permissions.

## Recovery invariants

Before every step persist a checkpoint and idempotency key. After interruption resume only from the last verified checkpoint and never replay a completed key. A stale session pauses for human sign-in. Invalid policy state downgrades to Ask.

## Runtime integration

1. Load docs/autonomy-control-plane.json as the bounded-autonomy default.
2. Enforce classification at the runtime action boundary, not only in prompts.
3. Reject a browser profile whose client/project/bot identity does not match the mission.
4. Emit redacted evidence receipts without credentials, cookies, tokens or OTPs.
5. Preserve owner gates regardless of restored authentication state.
6. Add independent tests for restart recovery, idempotency, isolation and approval classification.

## Release boundary

This branch is non-production. The policy is not live until runtime integration, independent tests and owner review pass. Do not merge, deploy, publish, spend, delete or change permissions from this proposal.
