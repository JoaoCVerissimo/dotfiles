#!/usr/bin/env bash
# Pulls the live VS Code settings back into the repo (sanitized) and reports extension drift against the Brewfile.
set -euo pipefail
DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="$HOME/Library/Application Support/Code/User/settings.json"
node "$DOTFILES/scripts/sanitize-vscode.js" "$LIVE" "$DOTFILES/vscode/settings.json"
if command -v code >/dev/null; then
  installed="$(code --list-extensions | sort -f)"
  listed="$(grep -E '^vscode "' "$DOTFILES/Brewfile" | sed -E 's/^vscode "([^"]+)"/\1/' | sort -f)"
  echo "Installed but not in Brewfile:"; comm -23 <(echo "$installed") <(echo "$listed") | sed 's/^/  vscode "/; s/$/"/'
  echo "In Brewfile but not installed:"; comm -13 <(echo "$installed") <(echo "$listed") | sed 's/^/  /'
fi
echo "Review with: git -C \"$DOTFILES\" diff"
