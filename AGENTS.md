# OpenMausBot agent notes

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

## Comments

Write a comment only for what the code cannot say:

- a license or attribution notice;
- a fact forced by something outside this code (a vendor, CLI, OS, browser,
  Electron or protocol behaviour), with its version when it has one;
- the doc comment of a public contract: the wire types in `shared/`, the
  driver interface, the preload bridge, `config.json` fields people edit;
- a link to an upstream issue;
- a security invariant or a known open risk.

Do not narrate what the next line does, restate a name, record history ("used
to", "no longer", PR or issue numbers, plan or slice names: git has it), point
at other files, draw banners or leave commented-out code. When our own code
needs a paragraph to explain a surprise, change the code instead: a better
name, a type, an extracted function, one shared helper. A rule ("never X",
"must match Y") belongs in a type, a test or a lint rule. Never suppress a lint
rule that guards correctness; fix the code.

More specific `AGENTS.md` files override this note within their directories.

## Minimalist engineering (Ponytail)

Write the smallest correct fix:

- Stop over-building: skip options, configurations, and abstractions nobody asked for.
- Reuse existing patterns, components, and helpers in this codebase before creating new ones.
- Prefer the standard library or platform built-ins over adding dependencies or wrapper functions.
- The shortest working diff wins. Never refactor untouched adjacent code outside the task scope.
- Never compromise validation at trust boundaries, security invariants, or data integrity.

## Token optimization & context discipline

- **Prefer CLIs over MCP tools:** When a CLI (`rtk`, `git`, `gh`, `curl`, `omb`) can do the job, use it instead of mounting heavy MCP tools with bloated schemas.
- **Move heavy exploration to subagents:** Offload wide file reads, large greps, and multi-file exploration to read-only subagents/scouts. Keep only the concise summary in the primary thread.
- **Clean context at 40–50%:** Do not let a conversation grow past 50% capacity into middle-context attention loss. Produce a structured `HANDOFF.md` or Machine Packet and start a fresh turn/thread.
- **Concise communication:** Speak in concise, simplified technical English. Report only what the operator needs to make a decision. Eliminate conversational filler and unsolicited explanations.
- **OAuth subscription & FREE models ONLY — NO API CALLS:** Never use metered, pay-per-token API keys (e.g. OpenAI/Anthropic/xAI/paid OpenRouter API keys). All bots, tasks, and subagents MUST run exclusively on OAuth subscription accounts (Claude Code CLI / Pro / Max subscription, Codex / ChatGPT Plus/Pro subscription via PKCE, Cursor subscription) or explicitly FREE models/tiers (Google Gemini via Antigravity OAuth, free local engines like Hermes/Qwen/Ollama, free tiers). Subagents must use the fastest/cheapest subscription or free model available.
