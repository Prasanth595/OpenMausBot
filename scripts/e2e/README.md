# The rail of places, end to end

`cloud-rail.e2e.mjs` drives the real desktop app (PR #3725) with Playwright on Linux under Xvfb. The app runs in its
installed layout: the Electron binary renamed `openmausbot`, with `resources/{app,ui,server,skills}`. So
`app.isPackaged` is true and the app starts its own server child, as the shipped app does. HOME, user data and the data
folder are new temporary folders.

The test pairs two servers through Settings → Servers → Connect, then checks:

- the rail, its circles, each circle opening its place, and the Server menu's tick;
- ＋'s two choices: Add your own server, and Buy a Cloud while signed out, which only shows the plans and buys nothing;
- the place colour;
- the narrow window;
- a restart;
- forgetting both servers.

Each scenario writes its checks and screenshots to `report.json` in `/tmp/e2e-out`.

**On a box of your own**, use the image `node:24.21.0-bookworm`. `mcr.microsoft.com/playwright:v1.63.0-noble` also
works: the script adds Node 24 when the image's Node is older. Give it at least 2 vCPU, 4 GB RAM and 6 GB of disk; 4 vCPU
and 8 GB is better.

1. Run `bash scripts/e2e/run-on-linux.sh prepare`. It installs the apt packages, Node 24 and pnpm 10.33.0, clones
   `e2e/cloud-rail` and builds it. The build peaks at about 3 GB, in `vite build`. The packages:
   - `xvfb xauth dbus dbus-x11 procps time git curl ca-certificates xz-utils`
   - `libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1`
   - `libxdamage1 libxrandr2 libcups2 libpango-1.0-0 libcairo2 fonts-liberation`

   On Ubuntu 24.04 and Debian 13, some names take a `t64` suffix.
2. Mint a pairing link on each server with `openmausbot pair --label "E1 desktop"`. Each link works once, for five
   minutes. Both servers should be past their first run.
3. Run the test right away:
   `OMB_E2E_SERVERS='[{"label":"Test server A","pairLink":"https://…/pair#code=…"},{"label":"Test server B","pairLink":"https://…/pair#code=…"}]' bash scripts/e2e/run-on-linux.sh test`.
   Without `OMB_E2E_SERVERS`, the test starts two local servers itself.
