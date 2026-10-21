# Custom mascot verification

Runtime source: `1dccf24c3242f8a5095bc577e7f5fedb65e2b262`.
Upstream base: `97a4a1cab96ab3d07b0c7dac275f69afc6e7a8dc`.

The production browser renderer ran on Windows with Node 24.15.0 and pnpm
10.33.0. Both the isolated API and production preview were restarted after the
runtime commit. The official verification launcher used disposable data and
fake CLIs. Fixture preparation created an empty second bot; mascot actions
used the visible application controls.

## Automated checks

- `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check`, and `pnpm exec vite build`
  passed. Locale validation covered 12 catalogs and 6,263 English strings.
- Core SVG/fitting/profile/Store/avatar suites: 202 passed, 1 skipped.
- API creation, selection, and forged-fingerprint case: 1 passed; 298 other
  cases were excluded by the test-name filter.
- Avatar-generation race, client scope, and duplicate suites: 316 passed.
- Package/schema/team/backup/library suites: 169 passed.
- An independent final catalog/geometry/avatar run passed 100 tests in 11
  files. These overlap the focused runs above and are not an extra total.

All ten pre-existing standard body definitions and the cursor face data remain
byte-identical after extraction. Geometry helpers changed only import paths.

## UI checks

- Selected [Bunny SVG](bunny.svg) through the real file chooser. Default face
  fitting passed without adjustment; saving returned HTTP 201.
- Confirmed the custom silhouette in the settings preview, header, and sidebar.
- Rejected an open outline and prevented saving a clipped face.
- Saved two shapes, reloaded, reselected a saved shape, and reset to a built-in
  body while retaining the saved catalog.
- Copied a shape to a second bot through **From other bots**; saving returned
  HTTP 201 and preserved an independent numeric outline snapshot.
- Selected the gradient Cat (`kitten`) and existing Halloween Cat (`cat`), with
  HTTP 200 and matching server readback for each; both saved shapes remained.
- Recorded eight continuous seconds without changing any controls after Bunny
  import; the body, ears, and face change over time in the live preview.

[Before](before.png) · [Creator](creator.png) · [Applied](applied.png) ·
[Reuse](reuse.png) · [Native Cat](native-cat.png) ·
[Halloween Cat](halloween-cat.png) · [Motion recording](motion.mp4)

[Motion at t=0](motion-t0.png) · [Motion at t=5](motion-t5.png)

Source bindings, media hashes, and motion observations are in [proof.json](proof.json).
Screenshots and the recording came from the application, without compositing.

## Verification limits

The full `pnpm test` script, installed Electron, and mobile runtime UI checks
were not run locally. Browser evidence covers the shared renderer.

The catalog exercise emitted 12 nonfatal SVG console messages about negative
ellipse radii while visiting built-in/Halloween states. There were no page
exceptions. A fresh context's Bunny import and motion capture emitted no new
console errors. The warning's baseline origin has not been established.

Validation is synchronous. A bounded five-run test of one maximum-size valid
profile (24 shapes, 512 points each, 209,112 bytes) measured a median of 554 ms
with a 545–679 ms range on the verification machine. A full team import at that
density was not measured; these figures are not an end-to-end import result.
