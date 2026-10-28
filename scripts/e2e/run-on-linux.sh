#!/usr/bin/env bash
# The rail of places end to end (scripts/e2e/cloud-rail.e2e.mjs) on a fresh Linux box, against two servers of yours.
#
#   bash run-on-linux.sh prepare                          # system packages, Node 24, this branch, its build
#   OMB_E2E_SERVERS='[{"label":"Test server A","pairLink":"https://a.example.com/pair#code=…"},
#                     {"label":"Test server B","pairLink":"https://b.example.com/pair#code=…"}]' \
#     bash run-on-linux.sh test                           # right after minting the two links
#   bash run-on-linux.sh                                  # both (only if the build fits inside the links' 5 minutes)
#
# A pairing link is single use and lasts five minutes, so mint them (`openmausbot pair --label "E1 desktop"` on each
# server) after `prepare` and just before `test`. Without OMB_E2E_SERVERS the test starts two local servers itself.
# Screenshots, report.json and logs land in OMB_E2E_OUT (default /tmp/e2e-out). Exit status: 0 only if every
# scenario passed.
#
# Env: OMB_E2E_REF (default e2e/cloud-rail), OMB_E2E_REPO, OMB_E2E_WORK (default /opt/omb-e2e), OMB_E2E_OUT.
set -euo pipefail

phase="${1:-all}"
REPO="${OMB_E2E_REPO:-https://github.com/milind-soni/OpenMausBot.git}"
REF="${OMB_E2E_REF:-e2e/cloud-rail}"
WORK="${OMB_E2E_WORK:-/opt/omb-e2e}"
export OMB_E2E_OUT="${OMB_E2E_OUT:-/tmp/e2e-out}"
NODE_VERSION="24.21.0"
PNPM_VERSION="10.33.0"

say() { printf '\n== %s\n' "$*"; }
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

case "$phase" in prepare|test|all) ;; *) echo "usage: $0 [prepare|test|all]" >&2; exit 64 ;; esac

packages() {
  command -v apt-get >/dev/null || { echo "This needs a Debian or Ubuntu box (apt-get)." >&2; exit 1; }
  say "system packages"
  as_root apt-get update -qq
  # Ubuntu 24.04 and Debian 13 name these with t64; Debian 12 without.
  pick() { if apt-cache show "$1t64" >/dev/null 2>&1; then echo "$1t64"; else echo "$1"; fi; }
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git xz-utils procps time xvfb xauth dbus dbus-x11 \
    "$(pick libgtk-3-0)" libnss3 libgbm1 "$(pick libasound2)" libxss1 libxtst6 "$(pick libatk-bridge2.0-0)" libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 "$(pick libcups2)" libpango-1.0-0 libcairo2 fonts-liberation
}

node24() {
  local arch; arch="$(uname -m)"; case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
  local own="$WORK/node-v$NODE_VERSION-linux-$arch/bin"
  if [ -x "$own/node" ]; then export PATH="$own:$PATH"; return; fi
  if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]; then return; fi
  say "Node $NODE_VERSION"
  mkdir -p "$WORK"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$arch.tar.xz" | tar -xJ -C "$WORK"
  export PATH="$own:$PATH"
}

checkout() {
  # Run from a checkout of this branch: use it. Otherwise clone (or refresh) one under $WORK.
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$here" ] && [ -f "$here/scripts/e2e/cloud-rail.e2e.mjs" ]; then REPO_DIR="$here"; return; fi
  REPO_DIR="$WORK/OpenMausBot"
  if [ -d "$REPO_DIR/.git" ]; then
    say "refresh $REF"
    git -C "$REPO_DIR" fetch --depth 1 origin "$REF"
    git -C "$REPO_DIR" checkout --force --detach FETCH_HEAD
  else
    say "clone $REF"
    mkdir -p "$WORK"
    git clone --depth 1 --branch "$REF" "$REPO" "$REPO_DIR"
  fi
}

prepare() {
  packages
  node24
  command -v pnpm >/dev/null && [ "$(pnpm --version)" = "$PNPM_VERSION" ] || { say "pnpm $PNPM_VERSION"; npm install -g --silent "pnpm@$PNPM_VERSION"; }
  checkout
  cd "$REPO_DIR"
  say "install and build ($(git rev-parse --short HEAD))"
  CI=1 pnpm install --frozen-lockfile
  pnpm exec vite build
  pnpm build:server
  node scripts/build-npm-package.mjs
}

run_test() {
  node24
  [ -n "${REPO_DIR:-}" ] || checkout
  cd "$REPO_DIR"
  [ -d dist ] && [ -d dist-server ] || { echo "Not built yet: run '$0 prepare' first." >&2; exit 1; }
  if [ -n "${OMB_E2E_SERVERS:-}" ]; then say "test against OMB_E2E_SERVERS"; else say "test against two local servers"; fi
  mkdir -p "$OMB_E2E_OUT"
  dbus-run-session -- xvfb-run -a --server-args="-screen 0 1600x1000x24" node scripts/e2e/cloud-rail.e2e.mjs
}

[ "$phase" = test ] || prepare
[ "$phase" = prepare ] || run_test
