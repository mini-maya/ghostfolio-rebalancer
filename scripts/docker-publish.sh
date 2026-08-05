#!/usr/bin/env bash
# ============================================================
# Lokales Build & Push Script für ghcr.io
#
# Verwendung:
#   ./scripts/docker-publish.sh v1.2.3
#
# Voraussetzungen:
#   - Docker mit Buildx Plugin
#   - GITHUB_USER und GITHUB_TOKEN als Umgebungsvariablen
#     oder interaktiver Login via 'docker login ghcr.io'
# ============================================================

set -euo pipefail

# --- Argumente prüfen -----------------------------------------------------------
if [[ $# -lt 1 ]]; then
  echo "Fehler: Kein Tag angegeben."
  echo "Verwendung: $0 <tag>   (z. B. $0 v1.2.3)"
  exit 1
fi

TAG="$1"
REGISTRY="ghcr.io"

# --- GitHub-User auflösen (Env-Variable → git remote → Abfrage) ----------------
if [[ -z "${GITHUB_USER:-}" ]]; then
  # Versuche, den User aus der git-Remote-URL zu lesen
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
  if [[ "$REMOTE_URL" =~ github\.com[:/]([^/]+)/ ]]; then
    GITHUB_USER="${BASH_REMATCH[1]}"
    echo "GitHub-User aus Remote erkannt: $GITHUB_USER"
  else
    read -rp "GitHub-Username eingeben: " GITHUB_USER
  fi
fi

IMAGE="${REGISTRY}/${GITHUB_USER}/ghostfolio-rebalancer"

echo ""
echo "================================================="
echo "  Image : ${IMAGE}"
echo "  Tags  : ${TAG}, latest"
echo "  Arch  : linux/amd64, linux/arm64"
echo "================================================="
echo ""

# --- Login (nur wenn GITHUB_TOKEN gesetzt) ------------------------------------
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "» Einloggen bei ${REGISTRY} ..."
  echo "${GITHUB_TOKEN}" | docker login "${REGISTRY}" -u "${GITHUB_USER}" --password-stdin
else
  echo "» GITHUB_TOKEN nicht gesetzt – überspringe Login (bestehende Session wird verwendet)."
fi

# --- Buildx Builder sicherstellen ---------------------------------------------
if ! docker buildx inspect multiarch-builder &>/dev/null; then
  echo "» Erstelle Buildx-Builder 'multiarch-builder' ..."
  docker buildx create --name multiarch-builder --use --bootstrap
else
  docker buildx use multiarch-builder
fi

# --- Build & Push -------------------------------------------------------------
echo "» Starte Multi-Arch-Build und Push ..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "${IMAGE}:${TAG}" \
  --tag "${IMAGE}:latest" \
  --push \
  .

echo ""
echo "✓ Erfolgreich gepusht:"
echo "    ${IMAGE}:${TAG}"
echo "    ${IMAGE}:latest"

