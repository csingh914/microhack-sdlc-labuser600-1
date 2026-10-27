#!/bin/sh

set -eu

: "${API_HOST:=api}"
: "${API_PORT:=3000}"
export API_HOST API_PORT

cat > /usr/share/nginx/html/runtime-config.js <<'EOF'
window.RUNTIME_CONFIG = {
  API_URL: window.location.origin
};
console.log("Runtime config loaded:", window.RUNTIME_CONFIG);
EOF

exec /docker-entrypoint.sh nginx -g 'daemon off;'