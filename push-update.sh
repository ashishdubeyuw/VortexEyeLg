#!/usr/bin/env bash
# push-update.sh — Zip www/, bump version.json, push to GitHub so the app auto-updates.
# Usage: ./push-update.sh [patch|minor|major]  (default: patch)

set -e

##############################################
# CONFIG — edit these two lines
GH_USER="ashishdubeyuw"
GH_REPO="VortexEyeLg"
##############################################

BUMP="${1:-patch}"
VER_FILE="version.json"
ZIP_OUT="www.zip"
BRANCH="main"

# ── helpers ────────────────────────────────────────────────────────────────────
require() { command -v "$1" &>/dev/null || { echo "❌ '$1' not found. Install it and retry."; exit 1; }; }
require jq
require zip
require git

# ── read current version ────────────────────────────────────────────────────────
CUR=$(jq -r .version "$VER_FILE")
IFS='.' read -r M m p <<< "$CUR"

case "$BUMP" in
  major) M=$((M+1)); m=0; p=0 ;;
  minor) m=$((m+1)); p=0 ;;
  *)     p=$((p+1)) ;;
esac

NEW_VER="$M.$m.$p"
ZIP_URL="https://raw.githubusercontent.com/${GH_USER}/${GH_REPO}/${BRANCH}/${ZIP_OUT}"

echo "📦  Bumping version: $CUR → $NEW_VER"
echo "🔗  Zip URL will be: $ZIP_URL"

# ── build the zip ───────────────────────────────────────────────────────────────
rm -f "$ZIP_OUT"
(cd www && zip -r "../$ZIP_OUT" . -x "*.DS_Store" -x "__MACOSX/*")
echo "✅  Created $ZIP_OUT ($(du -sh $ZIP_OUT | cut -f1))"

# ── update version.json ─────────────────────────────────────────────────────────
TMP=$(mktemp)
jq --arg v "$NEW_VER" --arg u "$ZIP_URL" \
   '.version=$v | .url=$u | .updated=now | .notes="Auto-pushed from desktop"' \
   "$VER_FILE" > "$TMP" && mv "$TMP" "$VER_FILE"
echo "✅  Updated $VER_FILE"

# ── commit & push ───────────────────────────────────────────────────────────────
git add "$VER_FILE" "$ZIP_OUT"
git commit -m "chore: release v${NEW_VER}"
git push origin "$BRANCH"

echo ""
echo "🚀  v${NEW_VER} pushed to GitHub — your app will update on next launch!"
