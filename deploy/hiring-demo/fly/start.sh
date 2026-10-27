#!/bin/sh
# Hands a fresh volume to `maus` once, then runs Desk ATS and Caddy (each restarted if it stops) and the OpenMausBot
# server in the foreground, all as `maus`.
set -eu
mkdir -p /data/desk /data/ats-state
if [ ! -f /data/.hiring-volume-owned ]; then chown -R maus:maus /data && touch /data/.hiring-volume-owned; fi
chown maus:maus /data /data/desk /data/ats-state
as_maus() { setpriv --reuid=maus --regid=maus --init-groups "$@"; }
keep() { name=$1; shift; ( while true; do as_maus "$@" || echo "$name stopped ($?), starting it again in 3 s" >&2; sleep 3; done ) & }
keep ats sh -c 'cd /hiring && exec node ats/src/server.ts'
keep caddy /usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
# The whole Recruiting Desk is there from the first visit: once the server answers, build (or refresh) it. The setup is
# safe to re-run, so every boot applies the image's template.
(
  for i in $(seq 1 120); do
    curl -sf http://127.0.0.1:8799/api/health | grep -q openmausbot && curl -sf http://127.0.0.1:4100/ >/dev/null && break
    sleep 2
  done
  as_maus sh -c 'cd /hiring && node template/setup-desk.mjs' && echo "Recruiting Desk is set up" || echo "Recruiting Desk setup failed; it runs again on the next boot" >&2
) &
cd /app
exec setpriv --reuid=maus --regid=maus --init-groups node dist-server/server-launcher.js
