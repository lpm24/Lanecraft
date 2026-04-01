#!/usr/bin/env bash
# deploy-notify.sh — Cloudflare Pages build + Discord changelog notification
#
# Cloudflare Pages build command:  bash scripts/deploy-notify.sh
#
# Required env vars (set in Cloudflare Pages > Settings > Environment variables):
#   DISCORD_WEBHOOK  — Discord webhook URL
#
# Provided automatically by Cloudflare Pages:
#   CF_PAGES_COMMIT_SHA — current commit SHA
#   CF_PAGES_URL        — deploy preview URL

set -euo pipefail

DEPLOY_URL="${CF_PAGES_URL:-https://lanecraft-i3l.pages.dev}"
SITE_URL="https://lanecraft-i3l.pages.dev"
COMMIT_SHA="${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD)}"

# --- 1. Find last deployed SHA ---
LAST_SHA=""
if curl -sf "${SITE_URL}/.deploy-sha" -o /tmp/last-sha 2>/dev/null; then
  LAST_SHA=$(cat /tmp/last-sha | tr -d '[:space:]')
  # Verify it exists in our history
  if ! git cat-file -t "$LAST_SHA" >/dev/null 2>&1; then
    echo "[deploy-notify] Last deployed SHA ${LAST_SHA} not in history, falling back to last 5"
    LAST_SHA=""
  fi
fi

# --- 2. Build changelog ---
DESCFILE=$(mktemp)
echo "**Changes since last deploy:**" > "$DESCFILE"

if [ -n "$LAST_SHA" ]; then
  RANGE="${LAST_SHA}..${COMMIT_SHA}"
else
  RANGE="-5"
fi

REPO_URL="https://github.com/$(git remote get-url origin | sed -E 's#.*github\.com[:/](.+?)(\.git)?$#\1#')"

git log --oneline --no-decorate $RANGE | while IFS= read -r line; do
  HASH=$(echo "$line" | cut -d' ' -f1)
  MSG=$(echo "$line" | cut -d' ' -f2-)
  echo "- [${HASH}](${REPO_URL}/commit/${HASH}) ${MSG}" >> "$DESCFILE"
done

# --- 3. Build the site ---
npm run build

# --- 4. Stamp the deployed SHA ---
echo -n "$COMMIT_SHA" > dist/.deploy-sha

# --- 5. Send Discord notification ---
if [ -n "${DISCORD_WEBHOOK:-}" ]; then
  AUTHOR=$(git log -1 --format='%an')
  PAYLOAD=$(jq -n \
    --rawfile desc "$DESCFILE" \
    --arg title "Lanecraft Deployed" \
    --arg url "$SITE_URL" \
    --arg footer "Deployed by ${AUTHOR} via Cloudflare Pages" \
    '{embeds: [{title: $title, description: ($desc | rtrimstr("\n")), url: $url, color: 5763719, footer: {text: $footer}}]}')
  curl -sf -H "Content-Type: application/json" -d "$PAYLOAD" "$DISCORD_WEBHOOK" || echo "[deploy-notify] Discord webhook failed (non-fatal)"
else
  echo "[deploy-notify] No DISCORD_WEBHOOK set, skipping notification"
fi

rm -f "$DESCFILE" /tmp/last-sha
echo "[deploy-notify] Done — deployed ${COMMIT_SHA:0:7}"
