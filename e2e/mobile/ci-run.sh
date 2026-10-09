#!/usr/bin/env bash
# Runs the mobile E2E suite from a CI emulator or simulator script.
# PROMPT_E2E_PATTERN (a regular expression) narrows the run to scenarios whose title matches.
set -euo pipefail
exec npm run e2e:mobile
