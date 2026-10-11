#!/usr/bin/env bash
# Removes the symlinks install.sh created (only links that point into this repo). Seeded copies and backups are left alone.
set -euo pipefail
DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VSCODE_USER="$HOME/Library/Application Support/Code/User"
for dst in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.gitconfig" "$HOME/.gitignore_global" "$HOME/.ssh/config" \
           "$HOME/.config/gh/config.yml" "$HOME/.claude/settings.json" "$HOME/.claude/CLAUDE.md" \
           "$HOME/.claude/statusline.sh" "$HOME/.claude/agents" "$HOME/.claude/commands" "$HOME/.claude/rules" \
           "$VSCODE_USER/keybindings.json"; do
  if [[ -L "$dst" && "$(readlink "$dst")" == "$DOTFILES"/* ]]; then rm "$dst"; echo "removed  $dst"; fi
done
echo "Done. Restore originals from ~/.dotfiles-backup/ if you need them."
