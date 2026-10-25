#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  printf 'This workflow must be dispatched from main; received %s.\n' "${GITHUB_REF:-unset}" >&2
  exit 1
fi
