#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "$0")/.." && pwd)
output_dir=$(mktemp -d)
trap 'rm -rf "$output_dir"' EXIT

api_dir="$repo_dir/api"
backend_dir="$repo_dir/backend"
sdk_dir="$repo_dir/frontend/src/api/generated"
openapi="$output_dir/openapi.yaml"

npm --prefix "$api_dir" run generate:openapi -- --output-dir "$output_dir"
node "$api_dir/normalize-openapi.mjs" "$openapi"
(
  cd "$backend_dir"
  go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2 \
    --config oapi-codegen.yaml -o "$output_dir/api.gen.go" "$openapi"
)
npm --prefix "$api_dir" run generate:sdk -- "$openapi" "$output_dir/sdk"

if [[ "${1:-}" == "--check" ]]; then
  stale=0
  if ! cmp -s "$api_dir/openapi.yaml" "$openapi"; then
    echo "OpenAPI generation is stale" >&2
    stale=1
  fi
  if ! cmp -s "$backend_dir/internal/api/api.gen.go" "$output_dir/api.gen.go"; then
    echo "Go API generation is stale" >&2
    stale=1
  fi
  if ! diff -qr "$sdk_dir" "$output_dir/sdk"; then
    echo "Client SDK generation is stale" >&2
    stale=1
  fi
  if [[ "$stale" == 1 ]]; then
    echo "Run mise run generate" >&2
    exit 1
  fi
else
  mv "$openapi" "$api_dir/openapi.yaml"
  mv "$output_dir/api.gen.go" "$backend_dir/internal/api/api.gen.go"
  rm -rf "$sdk_dir"
  cp -R "$output_dir/sdk/." "$sdk_dir"
fi
