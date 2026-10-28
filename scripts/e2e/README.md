# The rail of places, end to end

`cloud-rail.e2e.mjs` drives the real desktop app (PRs #3725 and #3739) with Playwright under Xvfb. The app runs in its
installed layout (Electron renamed `openmausbot`, `resources/{app,ui,server,skills}`), so it starts its own server
child, and it uses temporary HOME, user-data and data folders. The test pairs two servers through Settings → Servers →
Connect, then covers the rail, ＋ (Buy a Cloud is checked signed out and buys nothing), a place's colour from its
circle's menu, a narrow and zoomed window, restarts and forgetting. The rail is the window's own: this app's page
`/rail` in a view at the window's left edge, which the test reads and clicks there, beside every place's page. Its
screenshots are the window as the person sees it (the place's page with the rail over its left edge), taken from main.
Screenshots and `report.json` go to `/tmp/e2e-out`.

The test checks the sidebar's tint only on servers it starts itself (built from the branch); a server of the caller's
may run an older release, whose page draws no tint. Its colour is still set from the rail.

`run-on-linux.sh` runs the same test on a Linux box of yours. The image is `node:24.21.0-bookworm`;
`mcr.microsoft.com/playwright:v1.63.0-noble` also works, because the script adds Node 24 when it is missing. The box
needs at least 2 vCPU, 4 GB RAM (the build peaks at 3.4 GB) and 6 GB of disk; 4 vCPU and 8 GB is better. On 4 vCPU,
`prepare` takes about 80 s and `test` about 75 s.

`prepare` installs these apt packages (some take a `t64` suffix on Ubuntu 24.04), plus pnpm 10.33.0:

```
xvfb xauth dbus dbus-x11 procps time git curl ca-certificates xz-utils libgtk-3-0 libnss3 libgbm1 libasound2 libxss1
libxtst6 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libcups2 libpango-1.0-0
libcairo2 fonts-liberation
```

Run `prepare` first. Then mint one link on each server, which must be past its first run, with
`openmausbot pair --label "E1 desktop"`. Each link works once, for five minutes, so run `test` right after minting.
Without `OMB_E2E_SERVERS`, the test starts two local servers:

```sh
bash scripts/e2e/run-on-linux.sh prepare
OMB_E2E_SERVERS='[{"label":"Test server A","pairLink":"https://a.example.com/pair#code=…"},{"label":"Test server B","pairLink":"https://b.example.com/pair#code=…"}]' \
  bash scripts/e2e/run-on-linux.sh test
```
