# Workshop panel — design

Date: 2026-10-22
Branch: `release/0.1.112`
Approved by: user (via design gate, "Approve — build it")

## Goal

An in-app **Workshop**: the user sketches an idea on a drawing canvas, hands the
sketch to any bot, and the bot builds a detailed **isometric 3D-looking figure**
(SVG) from it. The bot's live turn is visible inside the panel; a **Continue in
chat** button opens the bot's thread for further work. Built figures collect in
the existing workshop crate and are previewed in the panel.

The feature is a Clicky-style sketch-to-figure flow built entirely from
components the app already has, plus three new pieces (canvas library, panel,
anatomy skill) and three small server doors.

## Non-goals (v1)

- No real 3D geometry (glTF/OBJ) export — figures are SVG (text), by explicit
  user choice.
- No collaborative/multi-user, no cursor sharing, no version history of
  sketches.
- No cloud sync; everything stays on the crate and the attachments store.
- No camera/photo import (the existing composer already covers external
  images).

## What already exists (build on, not against)

| Piece | Where | Role in this feature |
| --- | --- | --- |
| Workshop crate | `server/workshop.ts`, doors at `server/index.ts` (`/api/internal/workshop*`) | Where the bot stores built figures (text files: `.svg`, `.html`); feature flag `features.workshop`; the `workshop` agent tool (list/read/write/delete) |
| Image attachments | `server` attachments dir + `/api/attachments/...`; `src/lib/composer-attachments.ts` | How the sketch PNG travels to the bot's conversation |
| Per-bot skills | `skills/<id>/manifest.json` + `SKILL.md`, `src/components/bot-settings/SkillsSection.tsx` | How the anatomy skill reaches bots (`defaultEnabled: true`, per-bot enable/disable preserved) |
| Panels | `src/App.tsx` conditional renders (`pluginsOpen && <PluginsPanel />` style), Sidebar entries | How the Workshop panel opens |
| Thread state | `src/state/store.tsx` (`selectedId`, `activeView`, `revealThread`, thread opening paths) | The "Continue in chat" button and the live-turn mini-view |
| Bot capability check | composer's image-attachment support check (`LOC: composer.error.noImages`) | Which bots the picker marks as sketch-ready |

## Components

### 1. `src/lib/workshop-canvas.ts` (new — pure logic)

All drawing behavior as pure, testable functions over a list of stroke-like
shapes:

- shape model: `{ id, kind, color, width, points | rect | text, ... }` with
  kinds `pen`, `line`, `arrow`, `box`, `ellipse`, `label`, `erase`
- hit-testing (erase = remove last shape under a squared-distance test; erases
  only whole shapes, not pixels)
- undo/redo stacks (actions list, not command objects — copy-and-restore is
  enough at this scale)
- renderer: `renderShapes(ctx, shapes)` so panel + tests share one code path
- PNG export: composes the current shapes onto a fixed-scale canvas (white
  background) and returns a `Blob`/data URL

### 2. `src/components/WorkshopPanel.tsx` (new)

Three columns:

1. **Sketch** — tool rail (pen, eraser, line, arrow, box, ellipse, label,
   undo, redo, clear, color swatches, width) + the canvas (pointer events,
   touch included). "Ask a bot" opens the bot picker.
2. **Bot** — bot picker (image-capable bots marked; others greyed with their
   reason), the sketch thumbnail, the note field (what the bot should know),
   the **live turn mini-view** (recent messages of the chosen bot's thread +
   working indicator), and the **Continue in chat** button (opens the full
   thread via the store's existing thread-opening action).
3. **Figures** — the crate's files with previews (`.svg`/`.html` shown as
   images/text-safe views), a refresh, and download/copy-name actions.

The panel is honest about the gate: when `features.workshop` is off it shows
"Workshop is off" plus an **Enable** button (`PATCH /api/config`, live flip —
no restart).

Panel strings go through the app's i18n (`src/locales/en.json`), matching the
repo's i18n test conventions.

Wiring: `state.workshopOpen` + Sidebar entry (same pattern as
`pluginsOpen`/`PluginsPanel`).

### 3. Server doors (small additions next to the existing workshop door)

Operator-facing, flag-gated, operator-authenticated like the rest of the
inline API:

- `GET /api/workshop` → `{ enabled, dir?, files }` (reuses `listWorkshop()`)
- `GET /api/workshop/files/<name>` → file content. Figures are served for
  preview and download; names validated through the shared workshop
  validator (traversal/dotfiles refused; 400).
- `DELETE /api/workshop/files/<name>` → `deleteWorkshop()`

Safety rule: figure content is never inlined as raw HTML in the app. Previews
render through `<img>` (`.svg`) or as escaped text (`.html` shown only as
download first). Content types: `image/svg+xml` for `.svg`; `text/plain;
charset=utf-8` + `Content-Disposition: attachment` for `.html`
(and any unknown extension).

### 4. `skills/anatomy/` (new bundled skill)

- `manifest.json`: id `anatomy`, `defaultEnabled: true`, `triggerTerms`
  covering "sketch", "isometric", "3d", "figure", "workshop", "draw/build a
  model of ..."; `requiredCapabilities` consistent with its needs (file
  writes only).
- `SKILL.md`: a compact technique guide the bot executes — isometric
  projection (30° axes, diamond grid), **four-tone shading** family from one
  base hue, consistent line weights, leader-line labels, a framed card with
  title/hint and a live readout (for `.html` wrappers with eased motion),
  exploded-part option. It also names the delivery convention: write
  `figure-<kebab-name>.svg` (and optionally `.html`) into the workshop crate
  with the `workshop` tool, then tell the user what was made and where.
- Size discipline: one coherent figure per file; if the bot needs multiple
  views, it writes separate `figure-*.svg` files rather than zooming text into
  one.

## Data flow (one pass)

1. Sketch in canvas → **Ask a bot** → pick bot → attach PNG (existing
   attachment upload) + note → send into the bot's conversation.
2. Bot (anatomy skill on by default; crate enabled) builds the figure and
   `workshop write`s `figure-*.svg`.
3. Panel mini-view shows the turn; Figures column lists the new file
   (refresh on thread activity + manual refresh).
4. Continue in chat → thread opens; panel can stay open behind it.

## Error handling

- Workshop flag off: enable affordance, no silent dead panels.
- Bot without image-input capability: picker marks it and blocks send there
  (composer-level error copy reused).
- Crate write failure (skill off, name collision, size): the bot reports the
  failure in chat; panel shows the last error state from the turn.
- Empty sketch: send button disabled until at least one shape exists.
- Crate file deleted between list and preview: preview shows a not-found
  state; list refresh.

## Testing & verification

- Unit: `src/lib/workshop-canvas.test.ts` (shape math, hit-test, undo/redo,
  render determinism); operator door tests extending
  `server/workshop.test.ts` patterns (flag off → 403, traversal name → 400,
  svg content type, delete semantics); manifest/`SKILL.md` presence test
  under `src` following the repo's skill manifest validation precedent.
- Panel tests: render + state flags, mirroring `McpServersPanel.test.ts`
  conventions (node-friendly test file, `vitest`).
- E2E/isolated fixture (per `AGENTS.md` + `docs/verification/README.md`):
  after implementation, boot the app on an isolated home via
  `scripts/control-omb.ts launch` and drive enable → send sketch → figure
  appears in the crate. Never against the operator's live data.
- The existing packaged-server probe pattern
  (`release/verify-packaged-workshop.mjs`) gets re-run/extended for the new
  doors at release time (untracked scratch script).

## Release linkage

- Version stays `0.1.112`; the fork release tag `v0.1.112` is created **after**
  the workshop features land on this branch and the installer is rebuilt, so
  the published download contains the workshop.
- `latest.yml` + `.blockmap` + zip ship with the exe; the baked auto-update
  feed is overridden to the fork (`-c.publish.owner=parthiv-tech`) so a fork
  install stays consistent instead of silently self-updating to upstream
  releases that lack these features.

## Open items

- Resolved during design: handoff (any bot), output type (isometric SVG),
  home (in-app panel), shape (panel), spec path (this file).
- Implementation details (exact store action names, i18n key names,
  attachment upload invocation) are resolved by reading the referenced files
  at build time; they do not change the design.
