# Brave bot browser

In Settings, under the new browser settings, choose **Brave** as the **Bot
browser**, then restart the OpenMausBot server (restart the desktop app when
it owns the server). Install Brave on the machine running that server. Remote
clients select the server's browser, rather than a browser on the client.

The selection uses the built-in CDP driver. Brave gets separate bot profiles
under `<data directory>/brave/browser`; Chrome profiles are retained when
switching. My Chrome continues to attach to the person's own Chrome. Missing
Brave is reported rather than downloading or substituting another browser.
The Automatic option restores the existing Chrome/Chromium resolution.

Standard Brave installations are detected on macOS, Windows and Linux. For
an installation elsewhere, set `OMB_BRAVE_PATH` to its executable before
starting the server. This override applies only when Brave is selected.

## Verification

Use the isolated fixture described in README.md for API changes. Do not test
mutations against a live app or a user's browser profile.

For a real Brave installed on the test machine:

```sh
OMB_BRAVE_PATH=/path/to/brave pnpm exec vitest run server/browser/brave.e2e.test.ts
OMB_CDP_CHROME=/path/to/brave OMB_CDP_HOST=container pnpm exec vitest run server/browser/checklist.e2e.test.ts
```

The first check exercises explicit Brave resolution, calibration, page opening,
and screenshots through the bot engine in disposable profiles. It skips when
`OMB_BRAVE_PATH` is absent. The second checks interactions, sign-in persistence,
downloads, profile cleanup, and browser control against local fixture pages.
Both retain browser sandboxing by default.

The custom-router fixture verifies two connections with distinct synthetic
keys and exact model IDs, without remote network calls or model discovery:

```sh
pnpm exec vitest run server/custom-router.e2e.test.ts
```

Its printed evidence path retains commands, settled waits, and transcripts.
