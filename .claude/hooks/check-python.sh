#!/usr/bin/env bash
# PostToolUse: syntax-check edited Python files (no linter in this repo).
# Uses ast.parse instead of py_compile so no __pycache__ is written.
# Exit 2 = feed the error back to Claude.
set -uo pipefail

f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[[ "$f" == *.py && -f "$f" ]] || exit 0

if ! out=$(python3 -c 'import ast, sys; p = sys.argv[1]; ast.parse(open(p, encoding="utf-8").read(), p)' "$f" 2>&1); then
  echo "Syntax error in $f:" >&2
  echo "$out" >&2
  exit 2
fi
exit 0
