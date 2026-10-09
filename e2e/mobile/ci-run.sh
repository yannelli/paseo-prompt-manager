#!/usr/bin/env bash
# Runs the mobile E2E suite from a CI emulator or simulator script. PROMPT_E2E_PATTERN narrows it to matching scenario titles.
set -euo pipefail
args=()
if [ -n "${PROMPT_E2E_PATTERN:-}" ]; then args+=(--test-name-pattern "$PROMPT_E2E_PATTERN"); fi
exec npm run e2e:mobile -- ${args[@]+"${args[@]}"}
