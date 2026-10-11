#!/usr/bin/env bash
# Construye la imagen ofdt-mcp y la prueba contra el ambiente de mcp/.env.
# La prueba stdio carga xml/fpv4020_fmb.xml (modifica datos): usar solo en DEV.
# Uso: mcp/scripts/docker-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== build"
docker build -t ofdt-mcp .
docker image ls ofdt-mcp --format 'imagen {{.Repository}}:{{.Tag}} {{.Size}}'

echo "== usuario y /data"
docker run --rm --entrypoint sh ofdt-mcp -c 'id -un; ls -ld /data'

echo "== stdio"
node test/smoke.e2e.mjs docker run -i --rm --env-file .env -v "$PWD/../xml:/data:ro" ofdt-mcp

echo "== http"
docker rm -f ofdt-mcp-smoke >/dev/null 2>&1 || true
docker run -d --name ofdt-mcp-smoke -p 127.0.0.1:3917:3000 -e MCP_TRANSPORT=http --env-file .env ofdt-mcp >/dev/null
trap 'docker rm -f ofdt-mcp-smoke >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 20); do curl -fs http://127.0.0.1:3917/healthz >/dev/null && break; sleep 0.5; done
echo "healthz: $(curl -s http://127.0.0.1:3917/healthz)"
body='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
hdr=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
echo "whoami: $(curl -s -X POST http://127.0.0.1:3917/mcp "${hdr[@]}" -d "$body" | grep -o '"empresa_id":[0-9]*' | head -1)"
echo "origin ajeno: HTTP $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3917/mcp "${hdr[@]}" -H 'Origin: http://evil.example' -d "$body")"
docker logs ofdt-mcp-smoke 2>&1 | tail -2
echo "== DOCKER SMOKE OK"
