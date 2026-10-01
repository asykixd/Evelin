#!/usr/bin/env bash
# PostToolUse: requirements.txt must stay UTF-16 LE with CRLF line endings.
# Exit 2 = feed the error back to Claude.
set -uo pipefail

f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[[ "$(basename -- "$f")" == "requirements.txt" && -f "$f" ]] || exit 0

info=$(file -b "$f")
if [[ "$info" != *"UTF-16, little-endian"* || "$info" != *"CRLF"* ]]; then
  echo "requirements.txt lost its encoding (now: $info). It must be UTF-16 LE with CRLF line endings." >&2
  echo "Fix: iconv -f UTF-8 -t UTF-16LE, prepend BOM (FF FE), and use \\r\\n line endings." >&2
  exit 2
fi
exit 0
