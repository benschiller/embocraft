#!/usr/bin/env bash
# Local mirror of upstream CI (.github/workflows/ci.yml): lint, typecheck, unit tests,
# build, world-client integration and PostgreSQL persistence, against a throwaway
# Postgres 17 test database in Docker (container floperati-testdb, 127.0.0.1:55433).
# Plus the Floperati voice-strip check (no whisper/piper/webrtc outside schema/changelog).
#
# Usage: scripts/floperati/check.sh [--keep-db]
set -euo pipefail
cd "$(dirname "$0")/../.."

# Node 22 + pnpm 10.6.2 (upstream's pins). Use nvm's Node 22 binary directly if the
# current node is another major (works even when `nvm use` is blocked by ~/.npmrc prefix).
if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != "22" ]; then
  n22=$(ls -d "$HOME"/.nvm/versions/node/v22.* 2>/dev/null | sort -V | tail -1 || true)
  [ -n "$n22" ] || { echo "Node 22 not found (install with: nvm install 22)"; exit 1; }
  export PATH="$n22/bin:$PATH"
fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm() { corepack pnpm "$@"; }
echo "node $(node -v), pnpm $(pnpm -v)"

DB=floperati-testdb
export DATABASE_URL='postgresql://voxel:voxel@127.0.0.1:55433/voxel_test?schema=public'
export TEST_DATABASE_URL="$DATABASE_URL"
if ! docker ps --format '{{.Names}}' | grep -qx "$DB"; then
  docker rm -f "$DB" >/dev/null 2>&1 || true
  docker run -d --name "$DB" -e POSTGRES_USER=voxel -e POSTGRES_PASSWORD=voxel \
    -e POSTGRES_DB=voxel_test -p 127.0.0.1:55433:5432 postgres:17 >/dev/null
fi
for _ in $(seq 1 60); do docker exec "$DB" pg_isready -U voxel -d voxel_test >/dev/null 2>&1 && break; sleep 1; done
[ "${1:-}" = "--keep-db" ] || trap 'docker rm -f "$DB" >/dev/null 2>&1 || true' EXIT

results=()
step() {
  local name=$1; shift
  echo; echo "=== $name"
  if "$@"; then results+=("PASS  $name"); else results+=("FAIL  $name"); fi
}
voice_grep() {
  local hits
  hits=$(grep -rIil "whisper\|piper\|webrtc" . \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=generated \
    --exclude=CHANGELOG.md --exclude=schema.prisma --exclude=check.sh \
    | grep -v '/prisma/migrations/' | grep -v 'docs/changelog/' || true)
  [ -z "$hits" ] && echo "no whisper/piper/webrtc outside DB schema, migrations and docs/changelog" && return 0
  echo "$hits"; return 1
}

pnpm install --frozen-lockfile >/dev/null
pnpm db:generate >/dev/null
pnpm db:deploy
step lint pnpm lint
step typecheck pnpm typecheck
step "unit tests" pnpm test
step build pnpm build
step "integration: world-client" pnpm --filter @voxel/server exec tsx test/integration/world-client.ts
step "persistence" pnpm --filter @voxel/server exec vitest run test/database-persistence.test.ts --config ../../vitest.config.ts
step "voice strip grep" voice_grep

echo; echo "=== Summary"; printf '%s\n' "${results[@]}"
printf '%s\n' "${results[@]}" | grep -q '^FAIL' && { echo "OVERALL: FAIL"; exit 1; }
echo "OVERALL: PASS"
