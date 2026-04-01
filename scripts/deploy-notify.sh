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

set -euo pipefail

SITE_URL="https://lanecraft-i3l.pages.dev"
COMMIT_SHA="${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD)}"

# --- 1. Find last deployed SHA ---
LAST_SHA=""
RAW=$(curl -sf "${SITE_URL}/.deploy-sha" 2>/dev/null || true)
# Only accept if it looks like a hex SHA (not HTML fallback)
if echo "$RAW" | grep -qE '^[0-9a-f]{40}$'; then
  LAST_SHA="$RAW"
  if ! git cat-file -t "$LAST_SHA" >/dev/null 2>&1; then
    echo "[deploy-notify] Last deployed SHA ${LAST_SHA} not in history, falling back to last 5"
    LAST_SHA=""
  fi
fi

# --- 2. Build changelog ---
if [ -n "$LAST_SHA" ]; then
  RANGE="${LAST_SHA}..${COMMIT_SHA}"
else
  RANGE="-5"
fi

REPO_URL="https://github.com/$(git remote get-url origin | sed -E 's#.*github\.com[:/](.+?)(\.git)?$#\1#')"

DESCFILE=$(mktemp)
echo "**Changes since last deploy:**" > "$DESCFILE"
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
  node -e "
    const fs = require('fs');
    const https = require('https');
    const desc = fs.readFileSync('$DESCFILE', 'utf8').trimEnd();
    const payload = JSON.stringify({
      embeds: [{
        title: 'Lanecraft Deployed',
        description: desc,
        url: '$SITE_URL',
        color: 5763719,
        footer: { text: 'Deployed by $AUTHOR via Cloudflare Pages' }
      }]
    });
    const url = new URL(process.env.DISCORD_WEBHOOK);
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      if (res.statusCode >= 400) console.log('[deploy-notify] Discord returned', res.statusCode);
    });
    req.on('error', e => console.log('[deploy-notify] Discord webhook failed:', e.message));
    req.end(payload);
  " || echo "[deploy-notify] Discord webhook failed (non-fatal)"
else
  echo "[deploy-notify] No DISCORD_WEBHOOK set, skipping notification"
fi

rm -f "$DESCFILE"
echo "[deploy-notify] Done — deployed ${COMMIT_SHA:0:7}"
