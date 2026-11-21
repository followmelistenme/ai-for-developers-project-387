#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_dir/backend"

if [[ "${1:-}" == "--check" ]]; then
  output_dir=$(mktemp -d)
  trap 'rm -rf "$output_dir"' EXIT
  go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2 \
    --config oapi-codegen.yaml -o "$output_dir/api.gen.go" ../api/openapi.yaml
  if ! cmp -s internal/api/api.gen.go "$output_dir/api.gen.go"; then
    echo "Go API generation is stale; run mise run generate" >&2
    exit 1
  fi
  npm --prefix "$repo_dir/api" run check
else
  go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2 \
    --config oapi-codegen.yaml -o internal/api/api.gen.go ../api/openapi.yaml
  npm --prefix "$repo_dir/api" run generate
fi
