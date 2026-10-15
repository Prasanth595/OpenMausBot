# Zap sphere renderer

Design and renderer by z4mbo, from Zap revision
`e51cef8f09957969d59816affc1a905238cac27e`, contributed under Apache-2.0.

The supplied React port retains the sphere shaders, sprite cache, face geometry,
four shapes and seven moods. Movement trail sampling and drawing are removed.
There are no runtime dependencies beyond React and browser APIs.

`spheres/` and `ZapDot.css` are the reference rendering sources. The application
adapter maps existing bot states, body IDs and identity color names without
changing their persisted values. Small avatars share shader sprites; large
previews use the live canvas with the reference CSS fallback when WebGL2 is
unavailable. Reduced motion follows the reference renderer.
