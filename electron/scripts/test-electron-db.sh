#!/usr/bin/env bash
# Run database-backed test suites under Electron's Node runtime so that
# better-sqlite3 (compiled against Electron headers) loads correctly.
#
# Usage:
#   ./scripts/test-electron-db.sh                    # run all DB test suites
#   ./scripts/test-electron-db.sh dao/task-dao       # run a specific suite
#
# Why:
#   better-sqlite3 is rebuilt via electron-rebuild during postinstall,
#   which links it against Electron's Node ABI. Regular `vitest run`
#   uses the system Node and gets ERR_DLOPEN_FAILED. Using
#   ELECTRON_RUN_AS_NODE=1 with the local Electron binary solves this.

set -euo pipefail
cd "$(dirname "$0")/.."

ELECTRON_BIN="./node_modules/.bin/electron"
VITEST_BIN="./node_modules/vitest/vitest.mjs"

if [ ! -f "$ELECTRON_BIN" ]; then
  echo "Error: electron binary not found at $ELECTRON_BIN"
  echo "Run 'npm install' first."
  exit 1
fi

# Default: run all suites that touch better-sqlite3
DB_SUITES=(
  "src/__tests__/database/dao/note-dao.test.ts"
  "src/__tests__/database/dao/project-dao.test.ts"
  "src/__tests__/database/dao/task-dao.test.ts"
  "src/__tests__/database/migrator.test.ts"
  "src/__tests__/database/search/chunk-dao.test.ts"
  "src/__tests__/database/search/hybrid-search.test.ts"
  "src/__tests__/database/search/vector-search.test.ts"
  "src/__tests__/database/migrations.test.ts"
  "src/__tests__/services/codebase-tool-service.test.ts"
  "src/__tests__/services/search-engine.test.ts"
)

if [ $# -gt 0 ]; then
  # Run specific suite(s) passed as arguments
  SUITES=("$@")
else
  SUITES=("${DB_SUITES[@]}")
fi

echo "Running DB test suites under Electron runtime..."
echo "Suites: ${SUITES[*]}"
echo ""

ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" "$VITEST_BIN" run "${SUITES[@]}"
