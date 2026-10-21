#!/usr/bin/env bash
# One-shot PR open: uses the GitHub credential stored by Git Credential Manager
# (created the first time you sign in during a push). Stores nothing.
set -euo pipefail
cd "$(dirname "$0")"

REPO=$(git remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# The branch often lives in a fork, not in the base repository, and a
# cross-fork pull request has to name the head owner. Derive it from the
# push remote rather than assuming the branch is in `origin`.
HEAD_OWNER=""
FORK_URL=$(git remote get-url fork 2>/dev/null || true)
if [ -n "$FORK_URL" ]; then
  FORK_REPO=$(printf '%s' "$FORK_URL" | sed -E 's#.*github.com[:/]##; s#\.git$##')
  FORK_OWNER=${FORK_REPO%%/*}
  BASE_OWNER=${REPO%%/*}
  if [ -n "$FORK_OWNER" ] && [ "$FORK_OWNER" != "$BASE_OWNER" ]; then
    HEAD_OWNER="$FORK_OWNER:"
  fi
fi

# GCM_INTERACTIVE=Never makes `git credential fill` fail fast instead of
# popping a sign-in window — sign-in belongs to `git push`, not to this script.
CRED=$(printf "protocol=https\nhost=github.com\n\n" | GCM_INTERACTIVE=Never git credential fill 2>/dev/null || true)
TOKEN=$(printf '%s' "$CRED" | grep '^password=' | cut -d= -f2- || true)
if [ -z "${TOKEN:-}" ]; then
  echo "No GitHub credential stored yet."
  echo "Run:  git push -u origin $BRANCH   (sign in once at the popup)"
  exit 1
fi

export OMB_REPO="$REPO" OMB_BRANCH="$HEAD_OWNER$BRANCH" OMB_TOKEN="$TOKEN"
node -e '
const { OMB_REPO: repo, OMB_BRANCH: branch, OMB_TOKEN: token } = process.env;
const body = require("fs").readFileSync(".omb-pr-body.md", "utf8");
fetch(`https://api.github.com/repos/${repo}/pulls`, {
  method: "POST",
  headers: {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: "Windows CUA packaging, Vision unified driver + fleet model picker, REA reverse-engineering skill, Deepgram dictate + call STT, API-engine computer use",
    base: "main",
    head: branch,
    body,
  }),
}).then(async (r) => {
  const data = await r.json();
  if (r.ok) console.log("PR opened:", data.html_url);
  else { console.error("Failed:", r.status, JSON.stringify(data).slice(0, 500)); process.exit(1); }
});
'
