# ~/.zshrc — managed by the dotfiles repo (symlinked by install.sh).
# Machine-specific values and secrets go in ~/.zshrc.local (never committed).

# ---------- oh-my-zsh ----------
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git poetry)
source "$ZSH/oh-my-zsh.sh"

# ---------- PATH ----------
export PATH="$HOME/.local/bin:$PATH"                     # claude, poetry, pipx, uv, ...
export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"
# Rust: rustup from Homebrew keeps its proxies (rustc, cargo, ...) in its own bin; ~/.cargo/bin holds `cargo install`ed tools
[[ -n "$HOMEBREW_PREFIX" && -d "$HOMEBREW_PREFIX/opt/rustup/bin" ]] && export PATH="$HOMEBREW_PREFIX/opt/rustup/bin:$PATH"
[[ -d "$HOME/.cargo/bin" ]] && export PATH="$HOME/.cargo/bin:$PATH"

# Go: newest toolchain under ~/sdk (golang.org/dl wrappers) wins; otherwise the official installer in /usr/local/go.
# Do not export GOROOT elsewhere: a stale GOROOT makes `go` fail with "compile: version ... does not match go tool version".
_go_sdk="$(ls -d "$HOME"/sdk/go[0-9]* 2>/dev/null | sort -V | tail -1)"
if [[ -n "$_go_sdk" ]]; then
  export GOROOT="$_go_sdk"
  export PATH="$GOROOT/bin:$PATH"
elif [[ -d /usr/local/go/bin ]]; then
  unset GOROOT
  export PATH="$PATH:/usr/local/go/bin"
fi
unset _go_sdk
[[ -d "$HOME/go/bin" ]] && export PATH="$PATH:$HOME/go/bin"

# Postgres client/server binaries, resolved through the active Homebrew prefix
if [[ -n "$HOMEBREW_PREFIX" ]]; then
  [[ -d "$HOMEBREW_PREFIX/opt/libpq/bin" ]] && export PATH="$HOMEBREW_PREFIX/opt/libpq/bin:$PATH"
  [[ -d "$HOMEBREW_PREFIX/opt/postgresql@17/bin" ]] && export PATH="$HOMEBREW_PREFIX/opt/postgresql@17/bin:$PATH"
fi

# ---------- Version managers ----------
# Node (nvm): the curl-installed copy in ~/.nvm if present, else Homebrew's
export NVM_DIR="$HOME/.nvm"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh"
elif [[ -n "$HOMEBREW_PREFIX" && -s "$HOMEBREW_PREFIX/opt/nvm/nvm.sh" ]]; then
  source "$HOMEBREW_PREFIX/opt/nvm/nvm.sh"
fi
[[ -s "$NVM_DIR/bash_completion" ]] && source "$NVM_DIR/bash_completion"

# Python (pyenv, with the pyenv-virtualenv plugin in ~/.pyenv/plugins)
export PYENV_ROOT="$HOME/.pyenv"
[[ -d "$PYENV_ROOT/bin" ]] && export PATH="$PYENV_ROOT/bin:$PATH"
command -v pyenv >/dev/null && eval "$(pyenv init - zsh)"

# Ruby (rbenv)
command -v rbenv >/dev/null && eval "$(rbenv init - zsh)"

# ---------- Java ----------
_jh="$(/usr/libexec/java_home -v 17 2>/dev/null)" && export JAVA_HOME="$_jh"; unset _jh

# ---------- Tool hooks & completions ----------
command -v direnv >/dev/null && eval "$(direnv hook zsh)"
if command -v terraform >/dev/null; then
  autoload -U +X bashcompinit && bashcompinit
  complete -o nospace -C "$(command -v terraform)" terraform
fi

# Legacy: pins the Docker API for the old Docker Desktop 4.6. Remove after updating Docker Desktop.
export DOCKER_API_VERSION=1.41

# ---------- Aliases ----------
alias zesh='code ~/.zshrc'
alias reload='source ~/.zshrc'
alias tf='terraform'
alias migrations='python manage.py makemigrations'
alias migrate='python manage.py migrate'
alias dk='docker compose -f ./docker-compose.yml'
alias dk-up='docker compose -f ./docker-compose.yml up -d'
alias dk-down='docker compose -f ./docker-compose.yml down'

# ---------- Local overrides (secrets, work-only exports) ----------
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"
