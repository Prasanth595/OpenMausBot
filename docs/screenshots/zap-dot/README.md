# Zap dot visual comparison

The paired images show the same disposable fake-engine fixture and the repository's
mascot and onboarding previews before and after the avatar restyle. Chat and team
map captures use the real app mounted by `scripts/testing/threads-preview.tsx`.
All captures are headless at a 1280 x 800 CSS-pixel viewport.

`animations.gif` and `animations.webm` show the seven visual moods: idle, thinking,
working, waiting, done, error, and offline. The last is Zap's `killed` mood. These
are visual presentations of existing bot states, not new runtime states.

The renderer uses the supplied Zap reference shaders and sprite animation frames.
There are no movement trails. The animation recording uses normal motion; the
avatar motion tests separately exercise the reduced-motion preference.
