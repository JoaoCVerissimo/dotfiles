#!/usr/bin/env bash
# Registers the Claude Code mods kept in this repo and installs the ones Anthropic publishes. Idempotent.
#   scripts/claude-mods.sh
# Mine are read straight from .claude/mods/, so an edit there is live after /reload-plugins.
# Which mods are switched on lives in .claude/settings.json (enabledPlugins, pluginConfigs).
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODS="$DOTFILES/.claude/mods"
# blast-radius ships in a subfolder of a repository, which a marketplace cannot point at: it needs a clone.
PLAYGROUND="${XDG_DATA_HOME:-$HOME/.local/share}/claude-code-playground"

if ! command -v claude >/dev/null 2>&1; then
  echo "claude is not installed yet; run this again once it is."; exit 0
fi

marketplaces="$(claude plugin marketplace list --json 2>/dev/null || echo '[]')"
plugins="$(claude plugin list --json 2>/dev/null || echo '[]')"

has_marketplace() { grep -q "\"name\": *\"$1\"" <<<"$marketplaces"; }
has_plugin()      { grep -q "\"id\": *\"$1\"" <<<"$plugins"; }

# add_folder <name> <dir>: (re)point a folder marketplace at <dir>, wherever this repo is cloned
add_folder() {
  if has_marketplace "$1" && grep -q "\"path\": *\"$2\"" <<<"$marketplaces"; then echo "ok         marketplace $1"; return; fi
  if has_marketplace "$1"; then claude plugin marketplace remove "$1" >/dev/null; fi
  claude plugin marketplace add "$2" >/dev/null && echo "added      marketplace $1 -> $2"
}

install() {
  if has_plugin "$1"; then echo "ok         $1"; return 1; fi
  claude plugin install "$1" --scope user >/dev/null && echo "installed  $1"
}

# Mine
add_folder jv-mods "$MODS"
for mod in mods flow look keepwarm reflect browser; do install "$mod@jv-mods" || true; done

# Anthropic's next-steps, from the community marketplace (only its folder is checked out)
if has_marketplace claude-community; then echo "ok         marketplace claude-community"
else claude plugin marketplace add anthropics/claude-plugins-community --sparse .claude-plugin next-steps >/dev/null && echo "added      marketplace claude-community"; fi
install next-steps@claude-community || true

# Anthropic's blast-radius, from a sparse clone of its repository; it starts switched off
if [[ ! -d "$PLAYGROUND/.git" ]]; then
  mkdir -p "$(dirname "$PLAYGROUND")"
  git clone --quiet --depth 1 --filter=blob:none --sparse https://github.com/anthropics/claude-code-playground.git "$PLAYGROUND"
  git -C "$PLAYGROUND" sparse-checkout set claude-code/mods >/dev/null
  echo "cloned     $PLAYGROUND"
fi
add_folder claude-code-playground-mods "$PLAYGROUND/claude-code/mods"
if install blast-radius@claude-code-playground-mods; then
  claude plugin disable blast-radius@claude-code-playground-mods >/dev/null && echo "disabled   blast-radius (switch it on from /mods)"
fi

# Claude Code records a folder marketplace by its full path; settings.json is shared between machines,
# so those paths are kept home-relative there (Claude Code reads them the same).
SETTINGS="$DOTFILES/.claude/settings.json"
if grep -q "\"path\": \"$HOME/" "$SETTINGS"; then
  sed -i.bak "s#\"path\": \"$HOME/#\"path\": \"~/#" "$SETTINGS" && rm -f "$SETTINGS.bak"
  echo "tidied     folder paths in .claude/settings.json"
fi

echo "Mods are in place. In a running session: /reload-plugins, then /mods."
