#!/bin/sh
set -eu

encode_base64() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

cat >/usr/share/nginx/html/env.js <<EOF
window.__GHOSTFOLIO_REBALANCER_CONFIG = {
  accessTokenBase64: "$(encode_base64 "${ACCESS_TOKEN:-}")",
  allocationsTextBase64: "$(encode_base64 "${ALLOCATIONS_TEXT:-}")",
  baseUrlBase64: "$(encode_base64 "${BASE_URL:-}")"
};
EOF

chmod 0644 /usr/share/nginx/html/env.js
