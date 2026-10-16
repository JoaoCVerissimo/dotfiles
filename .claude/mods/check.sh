#!/usr/bin/env bash
# Validates and tests every mod in this folder. Run it before committing a change to one.
#   .claude/mods/check.sh [mod ...]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mods=("$@"); [[ ${#mods[@]} -eq 0 ]] && mods=(mods flow look keepwarm reflect peek)
claude plugin validate . >/dev/null && echo "ok    marketplace"
failed=0
for mod in "${mods[@]}"; do
  if ! claude plugin validate "./$mod" >/dev/null 2>&1; then echo "FAIL  $mod: validate"; claude plugin validate "./$mod" | tail -5; failed=1; continue; fi
  if out="$(cd "$mod" && claude plugin test 2>&1)"; then echo "ok    $mod: $(grep -E '^ *[0-9]+ pass' <<<"$out" | xargs)"
  else echo "FAIL  $mod: tests"; tail -20 <<<"$out"; failed=1; fi
done
exit $failed
