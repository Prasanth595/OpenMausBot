---
name: anatomy
description: "Build a detailed isometric SVG figure — a 3D-looking technical drawing — of the user's sketch or idea, and file it in the workshop so the Workshop panel shows it."
---

# Building isometric figures with Anatomy

When this skill's instructions are in your turn, someone is asking you to turn
a sketch (usually attached as an image) or an idea into a **figure**: a highly
detailed, isometric SVG that reads as a real physical object — a machine, a
rig, a cabinet, a mechanism — not as a flowchart and not as clip art.

Figures are **2D drawings drawn in 3D perspective** with painter's shading.
They are not true 3D geometry, and you never claim to export glTF/OBJ.
Deliver exactly one coherent figure per file.

## Where figures live

Save every figure into the workshop crate with the `workshop` tool:

- name: `figure-<two-or-three-kebab-words>.svg`, for example
  `figure-pump-turbine.svg` (1–64 chars, letters/digits/dots/dashes/underscores)
- one coherent figure per file. Multiple views = multiple files
  (`figure-pump-top.svg`, `figure-pump-section.svg`), not a cramped single one.
- after writing, tell the user the exact file name you saved so their
  Workshop panel can preview it, and what each view shows.

If the turn's tools include no `workshop` tool (the feature is off, or your
engine mounts no agent tools), say plainly that you cannot file the figure
and why — do not describe a figure you could not save.

## The technique — what makes it read "solid"

1. **Isometric axes.** Work on a 30° grid: two axes at ±30° from horizontal,
   one vertical. Circles become ellipses lying on the iso plane; a cube's two
   visible vertical faces differ. Keep one consistent vanishing scheme for
   the whole figure — never mix perspectives inside a figure.
2. **Build parts as solids.** Every part is a closed solid with visible
   faces drawn separately (top face lighter than the two visible sides),
   correct painter's order (back to front), and edges meeting flush.
3. **Four-tone shading.** Pick ONE base hue (steel blue, machine grey,
   copper…) and derive four tones: highlight (near-white of the hue), face,
   mid, and shadow (deepened + slightly desaturated). Assign: top faces the
   lightest; one vertical face the mid; the other vertical face the shadow;
   recesses, interior and underside the deepest. Outlines stay a near-black
   of the same hue, one consistent stroke width hierarchy (2px structural,
   1px detail).
4. **Only solid parts get shaded.** Arrows, leaders, dimension lines, labels,
   and the ground grid stay flat monochrome — that contrast is what keeps
   the solid parts reading as solidity.
5. **Exploded parts when it helps.** If the sketch shows an assembly, you may
   explode it along the iso axes with thin dashed axis lines and small
   index numerals; each part keeps its own tones.
6. **Labels are content, not decoration.** Leader lines (1px, flat, 45°
   elbow), short labels naming real parts, and a title. Missing names or
   uncertain structure: mark what you inferred ("inferred"), and ask the
   user for a correction — an honest gap beats a confident wrong part.
7. **Ground the object.** A subtle isometric ground grid or a soft contact
   shadow ellipse in the same hue family; the object must not float.
8. **Frame the figure.** The SVG carries a framed card: a title text, a small
   one-line hint (what the figure shows / what to check), and a quiet border.
   Compose on a fixed viewBox where the object plus frame sits with margin.
9. **Motion, if any, is declarative.** CSS transitions/keyframes or SMIL
   inside the SVG only, with `prefers-reduced-motion` respected: a slow,
   eased (cubic-bezier) reveal on load or a gentle hover highlight is enough.
   **Never embed `<script>`, external references, foreign objects, or
   remote URLs** — the preview refuses to run scripts and external assets
   won't load; a figure that relies on them arrives broken. Self-contained
   only: geometry, `<style>`, `<defs>`, gradients, `<title>`.

## SVG hygiene

- One root `<svg>`, `xmlns="http://www.w3.org/2000/svg"`, a fixed
  `viewBox="0 0 W H"`, and plain, tidy markup (group per part with an id;
  shapes/paths with hard geometric precision — no visual fuzz).
- `viewBox` chosen so nothing is clipped; the app previews the figure inside
  a fixed panel and at full width.
- Text uses `system-ui, sans-serif`; title ≥ 16px; labels ≥ 11px; keep
  contrast against the shaded faces (labels on face fill use the shadow
  or highlight tone, not mid-on-mid).
- Total file ≤ 64 KiB (the crate limit) — plan for it, or the write fails.

## Reading the sketch

Look for what the sketch is *about* first: dominant masses, repeated elements,
arrows (through-flow, direction, force), containers, and text. Translate
proportions as the sketch drew them — do not "correct" the idea unless the
drawing is technically impossible, and then say so in your reply. If the
note text and sketch disagree, prefer the sketch's structure and mention the
conflict. Mirrored or wobbly strokes are still intentional geometry.

## Your reply

Name the file(s) you wrote, what each figure shows, notable interpretation
choices, and anything you could not represent (with the sketch's element that
covers it). Keep it short — the figure is the work; the reply is a legend.
