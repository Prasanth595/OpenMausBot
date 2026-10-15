# Workshop: agents creating their own resources

The workshop is Astra's smallest answer to "a place where a bot can create
stuff": a sandbox crate at `~/.astra/workshop/` where an opted-in bot can
create, read, replace, and delete plain text resources during a turn —
prompt fragments, runbooks, drafts, skill notes, generated reference
material — without touching anything else on disk.

It is deliberately NOT self-modify. Self-modify rewrites the app's source
and earns its rollback machinery because a bad edit can bring the server
down. The workshop holds data the way `~/.astra` already holds data: the
operator can open it in an editor, delete files by hand, and nothing about
running Astra changes. The safety story is therefore the rules themselves,
enforced in `server/workshop.ts` before a single write reaches disk:

- **Names** are a single path segment, 1–64 chars, `[A-Za-z0-9._-]` only,
  no leading dot — traversal, dotfiles, and hidden state are refused.
- **Extensions** are `.md`, `.txt`, or `.json`; a `.json` write must parse.
- **Volume** is capped at 24 resources, each ≤ 64 KiB (413 on overflow,
  409 when the crate is full).
- **Content** is a plain UTF-8 string or nothing; there is no binary path,
  no diff, no append — writes replace a resource whole.

## What can be done

- `workshop list` — what the crate already holds (agent tool) or
  `GET /api/internal/workshop` (the harness door).
- `workshop read NAME` / `POST /api/internal/workshop/read`.
- `workshop write NAME` (full text) / `POST /api/internal/workshop/write`.
- `workshop delete NAME` / `POST /api/internal/workshop/delete`.

The agent tool is `workshop` in the agents MCP proxy. A turn can delete at
most four resources — a turn deleting more has stopped drafting and started
churning. Writes are unlimited within the caps; the point of the crate is
that a bot can iterate on drafts cheaply.

## Where it is controlled

- **Feature flag:** `features.workshop` in `~/.astra/config.json`, or
  `ASTRA_WORKSHOP=1`. Opt-in only — a bot writing files at all is an
  operator decision — and read per request, so the switch takes effect
  without a restart. The agents-proxy is offered the tool per turn via
  `ASTRA_WORKSHOP_ENABLED`, so a stale process env can only narrow what it
  sees, never widen it.
- Files land in `DATA_DIR/workshop` and are visible to the operator like
  any other file in `~/.astra`. Rounded stopping: turning the feature off
  revokes the door and hides the tool; whatever was written stays on disk.

## Relationship to existing primitives

Skills (`skill_manage`) are for programs — reviewed, staged, permanent,
executable. The workshop is for drafts and working material: immediate,
unreviewed by machinery, disposable. A bot that wants to promote a workshop
note into a real skill still goes through the skill staging card. Nothing
in the workshop is source code, so it never reaches the self-modify
pipeline either.

## Verification

- `server/workshop.test.ts` — name validation (traversal, dotfiles,
  suffixes, the 64-char cap), crate mechanics on throwaway homes
  (round-trip reads, whole-file replacement, the 24-file and 64 KiB caps,
  JSON validation, deletes with 404s), listing hygiene (sorted, hashed,
  invalid operator-dropped files hidden).
- `server/workshop.e2e.test.ts` — the server wiring on an isolated
  fixture: off by default, the internal door refused while off, and the
  config flag flipping on live.
