# The rail of places, end to end

`cloud-rail.e2e.mjs` drives the real desktop app (PR #3725) with Playwright on Linux under Xvfb. The app runs from the
installed layout (the Electron binary renamed `openmausbot`, `resources/{app,ui,server,skills}`), so `app.isPackaged`
is true and it starts its own server child, as the shipped app does. HOME, user data and the data folder are new
temporary folders. The test pairs two servers through Settings → Servers → Connect, then checks:

- the rail and its circles, and each circle opening its place;
- the native Server menu's tick;
- ＋'s two choices: Add your own server, and Buy a Cloud while signed out, where it buys nothing;
- the place colour, once that lands on `feat/cloud-rail`;
- the narrow window;
- a restart;
- forgetting both servers.

Each scenario gets checks and screenshots in `report.json`.

To run it on a box of your own:

1. `bash scripts/e2e/run-on-linux.sh prepare` installs the packages, Node 24 and pnpm, clones `e2e/cloud-rail` and
   builds it.
2. Mint a pairing link on each server, using a server from the same branch: `openmausbot pair --label "E1 desktop"`.
   Each link works once, for five minutes.
3. Run `OMB_E2E_SERVERS='[{"label":"Test server A","pairLink":"https://…/pair#code=…"},{"label":"Test server B","pairLink":"https://…/pair#code=…"}]' bash scripts/e2e/run-on-linux.sh test`.
   Results go to `/tmp/e2e-out`.

Recommended image: `node:24.21.0-bookworm` (Debian 12, x64). `mcr.microsoft.com/playwright:v1.63.0-noble` also works,
because the script adds Node 24 when the image's Node is older. The script installs these packages:

- `xvfb xauth dbus dbus-x11 procps time git curl ca-certificates xz-utils`
- `libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1`
- `libxdamage1 libxrandr2 libcups2 libpango-1.0-0 libcairo2 fonts-liberation`

On Ubuntu 24.04 and Debian 13 some of them take a `t64` suffix; the script picks the right names.

Size: at least 2 vCPU and 4 GB RAM, and 4 vCPU and 8 GB to build in a few minutes. You also need about 6 GB of disk.
Each server should be past its first run, or its page opens on the welcome screen.
