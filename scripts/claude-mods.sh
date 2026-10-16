#!/usr/bin/env bash
# Registers the Claude Code mods kept in this repo and installs the ones Anthropic publishes. Idempotent.
#   scripts/claude-mods.sh
# Mine are read straight from .claude/mods/, so an edit there is live after /reload-plugins.
# The panel (/mods), Zen, Peek and the done alert start on (plain code, no tokens); every other mod starts
# switched off and is switched on from the panel. What is on lives in .claude/settings.json (enabledPlugins, pluginConfigs), and a choice
# already made there is never changed here.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODS="$DOTFILES/.claude/mods"
SETTINGS="$DOTFILES/.claude/settings.json"
# blast-radius ships in a subfolder of a repository, which a marketplace cannot point at: it needs a clone.
PLAYGROUND="${XDG_DATA_HOME:-$HOME/.local/share}/claude-code-playground"

if ! command -v claude >/dev/null 2>&1; then
  echo "claude is not installed yet; run this again once it is."; exit 0
fi

marketplaces="$(claude plugin marketplace list --json 2>/dev/null || echo '[]')"
plugins="$(claude plugin list --json 2>/dev/null || echo '[]')"

has_marketplace() { grep -q "\"name\": *\"$1\"" <<<"$marketplaces"; }
has_plugin()      { grep -q "\"id\": *\"$1\"" <<<"$plugins"; }
# setting_of <plugin id>: true or false as settings.json has it, nothing when it does not name the plugin
setting_of()      { grep -E -o "\"$1\": *(true|false)" "$SETTINGS" 2>/dev/null | grep -E -o '(true|false)$' | head -1 || true; }

# add_folder <name> <dir>: (re)point a folder marketplace at <dir>, wherever this repo is cloned
add_folder() {
  if has_marketplace "$1" && grep -q "\"path\": *\"$2\"" <<<"$marketplaces"; then echo "ok         marketplace $1"; return; fi
  if has_marketplace "$1"; then claude plugin marketplace remove "$1" >/dev/null; fi
  claude plugin marketplace add "$2" >/dev/null && echo "added      marketplace $1 -> $2"
}

# install <plugin id> <true|false>: installs a plugin that is not there yet. An install switches a plugin
# on, so afterwards it is set back to what settings.json said about it (that file travels between
# machines, an install does not), or to the second argument where settings.json does not name it.
install() {
  if has_plugin "$1"; then echo "ok         $1"; return; fi
  local on; on="$(setting_of "$1")"
  if ! claude plugin install "$1" --scope user >/dev/null; then echo "FAILED     $1"; return; fi
  echo "installed  $1"
  if [[ "${on:-$2}" == false ]]; then
    claude plugin disable "$1" >/dev/null && echo "off        $1"
  fi
}

# Mine: the plugins are enabled, and each mod's own switch (off until flipped in /mods) decides what runs
add_folder jv-mods "$MODS"
for mod in mods flow look keepwarm reflect peek; do install "$mod@jv-mods" true; done

# Anthropic's next-steps, from the community marketplace (only its folder is checked out)
if has_marketplace claude-community; then echo "ok         marketplace claude-community"
else claude plugin marketplace add anthropics/claude-plugins-community --sparse .claude-plugin next-steps >/dev/null && echo "added      marketplace claude-community"; fi
install next-steps@claude-community false

# Anthropic's blast-radius, from a sparse clone of its repository
if [[ ! -d "$PLAYGROUND/.git" ]]; then
  mkdir -p "$(dirname "$PLAYGROUND")"
  git clone --quiet --depth 1 --filter=blob:none --sparse https://github.com/anthropics/claude-code-playground.git "$PLAYGROUND"
  git -C "$PLAYGROUND" sparse-checkout set claude-code/mods >/dev/null
  echo "cloned     $PLAYGROUND"
fi
add_folder claude-code-playground-mods "$PLAYGROUND/claude-code/mods"
install blast-radius@claude-code-playground-mods false

# You should know is built into Claude Code, so there is nothing to install: it starts off like the rest
YOU_SHOULD_KNOW=cc-plugin-you-should-know@builtin
if [[ -n "$(setting_of "$YOU_SHOULD_KNOW")" ]]; then echo "ok         $YOU_SHOULD_KNOW"
elif claude plugin disable "$YOU_SHOULD_KNOW" >/dev/null 2>&1; then echo "off        $YOU_SHOULD_KNOW"; fi

# Claude Code records a folder marketplace by its full path; settings.json is shared between machines,
# so those paths are kept home-relative there (Claude Code reads them the same).
if grep -q "\"path\": \"$HOME/" "$SETTINGS"; then
  sed -i.bak "s#\"path\": \"$HOME/#\"path\": \"~/#" "$SETTINGS" && rm -f "$SETTINGS.bak"
  echo "tidied     folder paths in .claude/settings.json"
fi

echo "Mods are in place. Each one is off unless settings.json already has it on. In a running session: /reload-plugins, then /mods to switch on the ones you want."
