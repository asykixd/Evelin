#!/usr/bin/env bash
# PreToolUse: block Claude from reading, editing or staging files that hold secrets.
# Exit 2 = block the tool call; stderr is shown to Claude.
set -euo pipefail

SECRETS_RE='(^|[^A-Za-z0-9_.-])(api_keys\.json|proxies\.txt)($|[^A-Za-z0-9_.-])'

input=$(cat)
tool=$(jq -r '.tool_name // empty' <<<"$input")

case "$tool" in
  Bash)
    target=$(jq -r '.tool_input.command // empty' <<<"$input")
    ;;
  Grep|Glob)
    target=$(jq -r '[.tool_input.path // "", .tool_input.glob // "", .tool_input.pattern // ""] | join(" ")' <<<"$input")
    ;;
  *)
    target=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
    ;;
esac

if [[ -n "$target" ]] && grep -Eq "$SECRETS_RE" <<<"$target"; then
  echo "Blocked: api_keys.json / proxies.txt contain secrets (API tokens, proxy credentials). Ask the user to inspect or change them manually." >&2
  exit 2
fi
exit 0
