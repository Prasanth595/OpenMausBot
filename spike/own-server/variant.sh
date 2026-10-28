#!/usr/bin/env bash
# One variant of the own-server spike, on a stock ubuntu-24.04 host with Docker: apply the variant's host step, start
# the published cloud-home image on a fresh /data volume with the variant's container settings, then record health,
# the Admin's signed reads and pairing (admin.mjs), the bot box self-check by hand (with two mutations), direct
# bubblewrap probes, what the container may read or write in /proc and /sys, and, for the candidate settings,
# restarts. Writes $OUT/result.json and the raw files beside it. Never prints the bootstrap secret.
#   bash variant.sh <variant>
set -uo pipefail
VARIANT=${1:?variant}
HERE=$(cd "$(dirname "$0")" && pwd)
IMAGE=${IMAGE:?IMAGE}
OUT=${OUT:-${RUNNER_TEMP:-/tmp}/spike/$VARIANT}
NAME=omb-home
VOLUME=omb-data-$VARIANT
PORT=18080
PUBLIC_HOST=home.spike.invalid
SECCOMP=$HERE/seccomp-omb-home.json
mkdir -p "$OUT"
log() { printf '== [%s] %s\n' "$VARIANT" "$*"; }

PROFILE=""; RESTARTS=0; ROLE=home
case "$VARIANT" in
  # Stock host: kernel.apparmor_restrict_unprivileged_userns=1, as Ubuntu 24.04 ships it.
  a)    USERNS=1; OPTS=() ;;
  b)    USERNS=1; OPTS=(--security-opt apparmor=unconfined) ;;
  c)    USERNS=1; OPTS=(--security-opt seccomp=unconfined) ;;
  bc)   USERNS=1; OPTS=(--security-opt apparmor=unconfined --security-opt seccomp=unconfined) ;;
  bcs)  USERNS=1; OPTS=(--security-opt apparmor=unconfined --security-opt seccomp=unconfined --security-opt systempaths=unconfined) ;;
  d)    USERNS=1; PROFILE=omb-home; OPTS=(--security-opt apparmor=omb-home --security-opt "seccomp=$SECCOMP") ;;
  ds)   USERNS=1; PROFILE=omb-home; RESTARTS=1; OPTS=(--security-opt apparmor=omb-home --security-opt "seccomp=$SECCOMP" --security-opt systempaths=unconfined) ;;
  dn)   USERNS=1; PROFILE=omb-home-narrow; RESTARTS=1; OPTS=(--security-opt apparmor=omb-home-narrow --security-opt "seccomp=$SECCOMP" --security-opt systempaths=unconfined) ;;
  d4)   USERNS=1; PROFILE=omb-home-abi4; OPTS=(--security-opt apparmor=omb-home-abi4 --security-opt "seccomp=$SECCOMP" --security-opt systempaths=unconfined) ;;
  cs)   USERNS=1; PROFILE=omb-home; OPTS=(--security-opt apparmor=omb-home --security-opt seccomp=unconfined --security-opt systempaths=unconfined) ;;
  dnh)  USERNS=1; PROFILE=omb-home-narrow; RESTARTS=1; OPTS=(--security-opt apparmor=omb-home-narrow --security-opt "seccomp=$SECCOMP" --security-opt systempaths=unconfined
          --security-opt no-new-privileges=true --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add KILL --oom-score-adj -800) ;;
  # The same settings with docker-ce from download.docker.com (what an install today gets), and on Ubuntu 22.04.
  dn29|dn2204) USERNS=1; PROFILE=omb-home-narrow; RESTARTS=1; OPTS=(--security-opt apparmor=omb-home-narrow --security-opt "seccomp=$SECCOMP" --security-opt systempaths=unconfined) ;;
  dnt)  USERNS=1; PROFILE=omb-home-narrow; ROLE=team; OPTS=(--security-opt apparmor=omb-home-narrow --security-opt "seccomp=$SECCOMP" --security-opt systempaths=unconfined) ;;
  dsx)  USERNS=1; PROFILE=omb-home; OPTS=(--security-opt apparmor=omb-home --security-opt "seccomp=$SECCOMP" --security-opt systempaths=unconfined --cap-add SYS_ADMIN) ;;
  # The same host with kernel.apparmor_restrict_unprivileged_userns=0 (a host-wide change).
  e)    USERNS=0; OPTS=() ;;
  ec)   USERNS=0; OPTS=(--security-opt seccomp=unconfined) ;;
  ebc)  USERNS=0; OPTS=(--security-opt apparmor=unconfined --security-opt seccomp=unconfined) ;;
  ebcs) USERNS=0; OPTS=(--security-opt apparmor=unconfined --security-opt seccomp=unconfined --security-opt systempaths=unconfined) ;;
  eds)  USERNS=0; OPTS=(--security-opt apparmor=unconfined --security-opt "seccomp=$SECCOMP" --security-opt systempaths=unconfined) ;;
  *) echo "unknown variant $VARIANT" >&2; exit 2 ;;
esac
printf '%s\n' "${OPTS[@]}" | sed "s#$HERE/##" > "$OUT/opts.txt"

host_facts() {
  echo "kernel: $(uname -r) $(uname -m)"
  grep -E '^PRETTY_NAME=' /etc/os-release
  for key in kernel.apparmor_restrict_unprivileged_userns kernel.apparmor_restrict_unprivileged_unconfined kernel.unprivileged_userns_clone user.max_user_namespaces; do
    echo "sysctl $key = $(sysctl -n "$key" 2>&1)"
  done
  echo "apparmor enabled: $(cat /sys/module/apparmor/parameters/enabled 2>&1)"
  echo "apparmor features/namespaces: $(ls /sys/kernel/security/apparmor/features/namespaces 2>&1 | tr '\n' ' ')"
  echo "apparmor_parser: $(apparmor_parser --version 2>&1 | head -1)"
  echo "parser.conf: $(grep -vE '^[[:space:]]*(#|$)' /etc/apparmor/parser.conf 2>/dev/null | tr '\n' ' ')"
  sudo aa-status 2>&1 | grep -E 'profiles are (loaded|in enforce|in complain)|processes are' | sed 's/^/aa-status: /'
  echo "aa profiles of note: $(sudo aa-status 2>/dev/null | grep -E '^\s+(docker|unprivileged_userns|bwrap|omb-home)' | tr -s ' \n' ' ')"
  echo "/etc/apparmor.d naming bwrap or userns: $(grep -lE 'bwrap|userns' /etc/apparmor.d/* 2>/dev/null | wc -l) files, e.g. $(grep -lE '/usr/bin/bwrap' /etc/apparmor.d/* 2>/dev/null | head -3 | tr '\n' ' ')"
  echo "docker: $(docker version --format 'client {{.Client.Version}} / server {{.Server.Version}}' 2>&1)"
  echo "docker info: $(docker info --format 'security={{json .SecurityOptions}} cgroup=v{{.CgroupVersion}} driver={{.Driver}} runtime={{.DefaultRuntime}} init={{.InitBinary}}' 2>&1)"
  echo "host unprivileged userns (runner user, unconfined): $(unshare -Ur cat /proc/self/uid_map 2>&1 | tr -s ' \n' ' ')"
}

if [ "$VARIANT" = dn29 ]; then
  log "replace the runner's Docker with docker-ce from download.docker.com"
  {
    sudo systemctl stop docker.socket docker containerd
    dpkg-query -W -f '${Package}\n' 'moby-*' 2>/dev/null | xargs -r sudo apt-get remove -y -qq
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
    sudo apt-get update -qq && sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io
    sudo systemctl start docker
    docker version --format 'now: client {{.Client.Version}} / server {{.Server.Version}}'
  } > "$OUT/docker-upgrade.txt" 2>&1
  tail -5 "$OUT/docker-upgrade.txt"
fi

log "host facts as found"
host_facts > "$OUT/host-before.txt" 2>&1; cat "$OUT/host-before.txt"

log "host step: kernel.apparmor_restrict_unprivileged_userns=$USERNS${PROFILE:+, AppArmor profile $PROFILE}"
sudo sysctl -w "kernel.apparmor_restrict_unprivileged_userns=$USERNS" > "$OUT/host-step.txt" 2>&1
if [ -n "$PROFILE" ]; then
  sudo install -m 0644 "$HERE/$PROFILE.apparmor" "/etc/apparmor.d/$PROFILE"
  sudo apparmor_parser -r -W "/etc/apparmor.d/$PROFILE" >> "$OUT/host-step.txt" 2>&1 && echo "loaded $PROFILE" >> "$OUT/host-step.txt" || echo "LOAD FAILED $PROFILE" >> "$OUT/host-step.txt"
  sudo aa-status 2>/dev/null | grep -E "^\s+$PROFILE\$" >> "$OUT/host-step.txt" || echo "$PROFILE not listed by aa-status" >> "$OUT/host-step.txt"
fi
cat "$OUT/host-step.txt"
host_facts > "$OUT/host-after.txt" 2>&1
sudo dmesg -C

log "pull"
start=$(date +%s)
docker pull -q "$IMAGE" > "$OUT/pull.txt" 2>&1; echo "pull exit $? in $(( $(date +%s) - start )) s" >> "$OUT/pull.txt"
docker image inspect "$IMAGE" --format 'arch={{.Architecture}} os={{.Os}} version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}}' >> "$OUT/pull.txt" 2>&1
cat "$OUT/pull.txt"

# A throwaway bootstrap secret for this container only, masked in the log, handed over in a 0600 env file. The
# connected-apps broker points at a closed loopback port: a shipped home otherwise registers with the production one.
umask 077
SECRET_FILE=$(mktemp); ENV_FILE=$(mktemp)
head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "$SECRET_FILE"
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$(cat "$SECRET_FILE")"
cat > "$ENV_FILE" <<ENV
OMB_CLOUD_ROLE=$ROLE
OMB_CLOUD_MACHINE_ID=spike-$VARIANT
OMB_CLOUD_ADMIN_URL=https://admin.spike.invalid
OMB_PUBLIC_URL=https://$PUBLIC_HOST
OMB_CLOUD_IMAGE=$IMAGE
OMB_CLOUD_BOOTSTRAP_SECRET=$(cat "$SECRET_FILE")
OMB_COMPOSIO_BROKER_URL=http://127.0.0.1:9
OMB_HIGHLEVEL_RELAY_URL=off
ENV
# A Team Cloud also boots with its team (docs/team-cloud.md); the Admin's pairing then carries a member claim.
if [ "$ROLE" = team ]; then printf 'OMB_CLOUD_TEAM_ID=spike-team\nOMB_CLOUD_TEAM_NAME=Spike Team\n' >> "$ENV_FILE"; export TEAM_ID=spike-team; fi
umask 022
export SECRET_FILE HOME_PORT=$PORT HOME_HOST=$PUBLIC_HOST

start_home() {
  docker run -d --name "$NAME" --init --shm-size=512m --stop-timeout 30 \
    -p "127.0.0.1:$PORT:8080" -v "$VOLUME:/data" --env-file "$ENV_FILE" \
    "${OPTS[@]}" "$IMAGE"
}
running() { [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ]; }
# Prints the seconds until /api/health answers, or why it never did.
wait_health() {
  local limit=$1 began; began=$(date +%s)
  while [ $(( $(date +%s) - began )) -lt "$limit" ]; do
    if curl -sf -m 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q openmausbot; then echo "$(( $(date +%s) - began ))"; return 0; fi
    running || { echo "exited ($(docker inspect -f 'code {{.State.ExitCode}}' "$NAME" 2>&1))"; return 1; }
    sleep 1
  done
  echo "timeout after ${limit}s"; return 1
}
boot_lines() { docker logs "$NAME" 2>&1 | grep -aE '^(cloud home|bot box|Cloud home)|startup failed|lease|already using|EACCES|EPERM' | grep -avE 'GET /|POST /' | head -40; }

log "docker run"
docker volume rm -f "$VOLUME" > /dev/null 2>&1
start_home > "$OUT/run.txt" 2>&1; echo "run exit $?" >> "$OUT/run.txt"
cat "$OUT/run.txt"
docker inspect -f 'apparmor={{.AppArmorProfile}} securityopt={{json .HostConfig.SecurityOpt}} capadd={{json .HostConfig.CapAdd}} capdrop={{json .HostConfig.CapDrop}} init={{json .HostConfig.Init}} masked={{len .HostConfig.MaskedPaths}} readonly={{len .HostConfig.ReadonlyPaths}}' "$NAME" 2>&1 | sed "s#$HERE/##g" > "$OUT/inspect.txt"
cat "$OUT/inspect.txt"

HEALTH=$(wait_health 150); HEALTH_OK=$?
log "health: $HEALTH"
echo "$HEALTH" > "$OUT/health.txt"

if [ "$HEALTH_OK" -eq 0 ]; then
  node "$HERE/admin.mjs" wait-box 90 > "$OUT/signed-box.json" 2>&1; log "signed box: $(head -c 600 "$OUT/signed-box.json")"
  node "$HERE/admin.mjs" health > "$OUT/signed-health.json" 2>&1; log "signed health: $(head -c 600 "$OUT/signed-health.json")"
  node "$HERE/admin.mjs" pair > "$OUT/pair.json" 2>&1; log "pairing: $(cat "$OUT/pair.json")"

  log "box self-check by hand"
  check() { docker exec -u maus -e HOME=/data -e OMB_DATA_DIR=/data/.openmausbot "$NAME" node /app/dist-server/bot-box/box-check.js "$@"; }
  check > "$OUT/box-check.json" 2> "$OUT/box-check.err"; echo "$?" > "$OUT/box-check.exit"
  head -c 1500 "$OUT/box-check.json"; echo; head -c 400 "$OUT/box-check.err"
  if grep -q '"box":"bwrap"' "$OUT/box-check.json"; then
    for mutation in share-pid no-seccomp; do
      check "--mutate=$mutation" > "$OUT/mutate-$mutation.json" 2>&1
      log "mutate $mutation: $(python3 -c 'import json,sys; d=json.loads(open(sys.argv[1]).read().strip().splitlines()[-1]); print(d.get("passed"),"/",d.get("total"),"failed",d.get("failed"))' "$OUT/mutate-$mutation.json" 2>&1)"
    done
  fi
else
  log "never healthy; logs follow"
fi

# Probes run in an idle container with the same settings, so they answer even when the home never boots.
log "direct bubblewrap probes as maus"
docker run -d --name omb-probe --init "${OPTS[@]}" --entrypoint sleep "$IMAGE" 900 > "$OUT/probe-run.txt" 2>&1
docker exec -u maus omb-probe sh -c '
p() { label=$1; shift; out=$("$@" 2>&1 >/dev/null); rc=$?; printf "%s\trc=%s\t%s\n" "$label" "$rc" "$(printf %s "$out" | tr "\n" " " | cut -c1-220)"; }
p unshare-userns unshare -Ur true
p bwrap-userns bwrap --unshare-user --ro-bind / / true
p bwrap-hostname bwrap --unshare-user --unshare-uts --hostname omb-box --ro-bind / / true
p bwrap-netns bwrap --unshare-user --unshare-net --ro-bind / / true
p bwrap-pidns-proc bwrap --unshare-user --unshare-pid --ro-bind / / --proc /proc true
p bwrap-dev bwrap --unshare-user --ro-bind / / --dev /dev true
p bwrap-detect-probe bwrap --unshare-user --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp /bin/true
p tmpfs-in-userns unshare -Urm sh -c "d=\$(mktemp -d) && mount -t tmpfs none \$d"
p overlay-in-userns unshare -Urm sh -c "d=\$(mktemp -d) && mount -t tmpfs none \$d && mkdir \$d/l \$d/u \$d/w \$d/m && mount -t overlay overlay -o lowerdir=\$d/l,upperdir=\$d/u,workdir=\$d/w \$d/m"
p sysfs-in-userns unshare -Urmn sh -c "d=\$(mktemp -d) && mount -t sysfs sysfs \$d"
' > "$OUT/probes.txt" 2>&1
cat "$OUT/probes.txt"

log "container security context, /proc and /sys protections, oom scores"
docker exec omb-probe sh -c '
echo "label: $(cat /proc/1/attr/apparmor/current 2>/dev/null || cat /proc/1/attr/current 2>&1)"
grep -E "^(Seccomp|Seccomp_filters|NoNewPrivs|CapEff|CapBnd):" /proc/1/status | tr "\t" " "
echo "mounts over /proc and /sys: $(awk "\$5 ~ \"^/(proc|sys)/\" {print \$5}" /proc/self/mountinfo | tr "\n" " ")"
echo "hidepid: $(grep -oE "hidepid=[a-z0-9]+" /proc/mounts | head -1)"
' > "$OUT/security.txt" 2>&1
docker exec omb-probe sh -c '
# Docker masks a file with /dev/null and a folder with an empty tmpfs, so "readable" means real content came back.
r() {
  if [ ! -e "$1" ]; then echo "root read $1: absent"; return; fi
  err=$(head -c 1 "$1" 2>&1 >/dev/null)
  if [ -n "$err" ]; then echo "root read $1: denied ($err)"
  elif [ "$(head -c 64 "$1" 2>/dev/null | wc -c)" -gt 0 ]; then echo "root read $1: readable"
  else echo "root read $1: empty (masked)"; fi
}
for f in /proc/kcore /proc/keys /proc/timer_list /proc/interrupts /proc/latency_stats /proc/sched_debug; do r "$f"; done
err=$(ls -A /sys/firmware 2>&1 >/dev/null)
if [ -n "$err" ]; then echo "root list /sys/firmware: denied ($err)"; elif [ -n "$(ls -A /sys/firmware 2>/dev/null)" ]; then echo "root list /sys/firmware: readable"; else echo "root list /sys/firmware: empty (masked)"; fi
fw=$(find /sys/firmware -type f 2>/dev/null | head -1); if [ -n "$fw" ]; then r "$fw"; else echo "root find a file under /sys/firmware: none found"; fi
for f in /proc/sysrq-trigger /proc/sys/kernel/shmmax /proc/sys/vm/overcommit_memory; do err=$( ( : > "$f" ) 2>&1 ); if [ -z "$err" ]; then echo "root open-for-write $f: allowed"; else echo "root open-for-write $f: denied ($err)"; fi; done
' > "$OUT/paths.txt" 2>&1
docker exec -u maus "$NAME" sh -c '
sup=""; for d in /proc/[0-9]*; do case "$(tr "\0" " " < $d/cmdline 2>/dev/null)" in node\ /app/dist-server/cloud-home-start.js*) sup=${d#/proc/};; esac; done
for p in 1 $sup; do if head -c 1 /proc/$p/environ >/dev/null 2>&1; then echo "maus read /proc/$p/environ (root): allowed"; else echo "maus read /proc/$p/environ (root): denied"; fi; done
echo "maus sees $(ls -d /proc/[0-9]* | wc -l) processes, $(for d in /proc/[0-9]*; do stat -c %U $d; done 2>/dev/null | grep -c root) of them root'"'"'s"
' >> "$OUT/paths.txt" 2>&1
docker exec "$NAME" sh -c '
for d in /proc/[0-9]*; do c=$(tr "\0" " " < $d/cmdline 2>/dev/null | cut -c1-70); case "$c" in /sbin/docker-init*|node\ /app/dist-server/cloud-home-start.js*|/usr/local/bin/node\ /app/dist-server/index.js*|/usr/local/bin/caddy\ run*) echo "${d#/proc/} oom_score_adj=$(cat $d/oom_score_adj) $c";; esac; done
' > "$OUT/oom.txt" 2>&1
cat "$OUT/security.txt" "$OUT/paths.txt" "$OUT/oom.txt"

if [ "$HEALTH_OK" -eq 0 ]; then
  node "$HERE/admin.mjs" lockout > "$OUT/lockout.json" 2>&1; log "lockout: $(cat "$OUT/lockout.json")"
fi

boot_lines > "$OUT/boot-log.txt"; log "boot log"; cat "$OUT/boot-log.txt"

if [ "$HEALTH_OK" -eq 0 ] && [ "$RESTARTS" -eq 1 ]; then
  log "restarts"
  {
    began=$(date +%s); docker restart -t 30 "$NAME" > /dev/null 2>&1
    echo "graceful docker restart: stop+start $(( $(date +%s) - began ))s, health $(wait_health 150)"
    docker kill -s KILL "$NAME" > /dev/null 2>&1; sleep 2
    echo "lease left by SIGKILL: $(docker run --rm -v "$VOLUME:/data:ro" --entrypoint sh "$IMAGE" -c 'cat /data/.openmausbot/openmausbot-server.lease 2>/dev/null || echo none' | tr -d '\n' | cut -c1-300)"
    docker start "$NAME" > /dev/null 2>&1
    echo "SIGKILL then docker start (same container): health $(wait_health 150)"
    docker logs --since 3m "$NAME" 2>&1 | grep -aE 'already using|lease|startup failed' | head -3 | sed 's/^/  log: /'
    docker kill -s KILL "$NAME" > /dev/null 2>&1; docker rm -f "$NAME" > /dev/null 2>&1; sleep 1
    start_home > /dev/null 2>&1
    echo "SIGKILL then a new container on the same volume: health $(wait_health 150)"
    docker logs "$NAME" 2>&1 | grep -aE 'already using|lease|startup failed' | head -3 | sed 's/^/  log: /'
    # What a connector could do itself once it knows no other container holds the volume: remove the lease records.
    docker rm -f "$NAME" > /dev/null 2>&1
    docker run --rm -v "$VOLUME:/data" --entrypoint sh "$IMAGE" -c 'cd /data/.openmausbot && rm -f openmausbot-server.lease openmausbot-server.lease.reap-* openmausbot-server.lease.candidate-* .openmausbot-server-child/openmausbot-server.lease && echo "lease records removed"' 2>&1 | sed 's/^/  /'
    start_home > /dev/null 2>&1
    echo "lease records removed, then a new container on the same volume: health $(wait_health 150)"
    echo "  same volume kept its data: $(docker exec -u maus "$NAME" sh -c 'cat /data/.omb-cloud-home.json; ls /data/.openmausbot | wc -l' 2>&1 | tr '\n' ' ')"
    echo "after restarts, signed box: $(node "$HERE/admin.mjs" wait-box 60 | head -c 300)"
  } > "$OUT/restarts.txt" 2>&1
  cat "$OUT/restarts.txt"
fi

sudo dmesg 2>/dev/null | grep -aE 'apparmor="(DENIED|ALLOWED)"' | sed -E 's/^\[[^]]*\] //; s/audit\([0-9.:]+\): //; s/ pid=[0-9]+//g; s/ fsuid=[0-9]+ ouid=[0-9]+//' | sort | uniq -c | sort -rn | head -25 > "$OUT/apparmor-denials.txt"
log "AppArmor denials on the host"; cat "$OUT/apparmor-denials.txt"
docker logs "$NAME" > "$OUT/container.log" 2>&1

docker rm -f "$NAME" omb-probe > /dev/null 2>&1; docker volume rm -f "$VOLUME" > /dev/null 2>&1
rm -f "$SECRET_FILE" "$ENV_FILE"

python3 - "$OUT" "$VARIANT" "$USERNS" "$PROFILE" <<'PY'
import json, os, sys
out, variant, userns, profile = sys.argv[1:5]
def text(name):
    try: return open(os.path.join(out, name), encoding="utf-8", errors="replace").read().strip()
    except FileNotFoundError: return ""
def last_json(name):
    for line in reversed(text(name).splitlines()):
        try: return json.loads(line)
        except ValueError: continue
    return None
health = text("health.txt")
byhand = last_json("box-check.json")
result = {
    "variant": variant, "hostUsernsRestricted": userns, "profile": profile or None,
    "opts": [line for line in text("opts.txt").splitlines() if line],
    "healthy": health.isdigit(), "health": health,
    "signedBox": last_json("signed-box.json"), "signedHealth": last_json("signed-health.json"), "pairing": last_json("pair.json"),
    "byHand": None if byhand is None else {k: byhand.get(k) for k in ("box", "reason", "bridge", "passed", "total", "failed", "skipped", "durationMs", "error")},
    "mutations": {m: (lambda d: None if d is None else {"passed": d.get("passed"), "total": d.get("total"), "failed": d.get("failed")})(last_json(f"mutate-{m}.json")) for m in ("share-pid", "no-seccomp")},
    "probes": text("probes.txt").splitlines(), "security": text("security.txt").splitlines(), "paths": text("paths.txt").splitlines(),
    "oom": text("oom.txt").splitlines(), "lockout": last_json("lockout.json"), "restarts": text("restarts.txt").splitlines(),
    "bootLog": text("boot-log.txt").splitlines(), "apparmorDenials": text("apparmor-denials.txt").splitlines(),
    "hostStep": text("host-step.txt").splitlines(), "inspect": text("inspect.txt"), "pull": text("pull.txt").splitlines(),
}
json.dump(result, open(os.path.join(out, "result.json"), "w"), indent=1)
print("result.json written")
PY
