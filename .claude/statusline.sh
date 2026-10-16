#!/bin/bash
input=$(cat)

# Extract fields
MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
CTX_SIZE=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
FIVE_H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
SEVEN_D=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
CACHE_WARM=$(echo "$input" | jq -r '.prompt_cache.warm // false')
CACHE_TTL=$(echo "$input" | jq -r '.prompt_cache.ttl // empty')
CACHE_EXP=$(echo "$input" | jq -r '.prompt_cache.expires_at // empty')

# Token count (approximate from percentage)
USED_TOKENS=$((PCT * CTX_SIZE / 100))
if [ "$USED_TOKENS" -ge 1000 ]; then
  TOKEN_DISPLAY="$((USED_TOKENS / 1000))k"
else
  TOKEN_DISPLAY="$USED_TOKENS"
fi

# --- Line 1: robbyrussell style ---
dir_name=$(basename "$DIR")
if git -C "$DIR" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if git -C "$DIR" diff --quiet --no-lock-index 2>/dev/null && \
     git -C "$DIR" diff --cached --quiet --no-lock-index 2>/dev/null; then
    git_status=""
  else
    git_status=" \033[33m✗\033[0m"
  fi
  git_info=" \033[1;34mgit:(${branch})\033[0m${git_status}"
else
  git_info=""
fi

printf '%b' "\033[1;32m➜\033[0m \033[36m${dir_name}\033[0m${git_info}\n"

# --- Line 2: Model | bar X% [tokens] (plan/cost) | 📎 repo (session) timer ---

# Bar color
if [ "$PCT" -ge 90 ]; then BAR_CLR="\033[31m"
elif [ "$PCT" -ge 70 ]; then BAR_CLR="\033[33m"
else BAR_CLR="\033[32m"; fi

# Build progress bar with explicit coloring
BAR_WIDTH=10
FILLED=$((PCT * BAR_WIDTH / 100))
EMPTY=$((BAR_WIDTH - FILLED))
BAR="${BAR_CLR}"
for ((i=0; i<FILLED; i++)); do BAR+="█"; done
BAR+="\033[2m"
for ((i=0; i<EMPTY; i++)); do BAR+="░"; done
BAR+="\033[0m"

# Plan (rate limits) or cost
if [ -n "$FIVE_H" ]; then
  FIVE_H_INT=$(printf '%.0f' "$FIVE_H")
  USAGE="\033[35m(Max Plan)\033[0m \033[2m5h:\033[0m ${FIVE_H_INT}%"
  if [ -n "$SEVEN_D" ]; then
    SEVEN_D_INT=$(printf '%.0f' "$SEVEN_D")
    USAGE="${USAGE} \033[2m7d:\033[0m ${SEVEN_D_INT}%"
  fi
else
  COST_FMT=$(printf '$%.4f' "$COST")
  USAGE="\033[33m${COST_FMT}\033[0m"
fi

# Clickable repo link (OSC 8)
REMOTE=$(git -C "$DIR" remote get-url origin 2>/dev/null \
  | sed 's|git@github.com:|https://github.com/|' \
  | sed 's|git@bitbucket.org:|https://bitbucket.org/|' \
  | sed 's|\.git$||')
if [ -n "$REMOTE" ]; then
  REPO_LINK="\033]8;;${REMOTE}\a\033[36m📎\033[0m\033]8;;\a"
else
  REPO_LINK=""
fi

# Prompt cache window countdown (⚡ time left before the cached prefix expires)
CACHE_SEG=""
if [ -n "$CACHE_EXP" ] && [ "$CACHE_EXP" != "null" ]; then
  CACHE_LEFT=$((CACHE_EXP - $(date +%s)))
  if [ "$CACHE_WARM" = "true" ] && [ "$CACHE_LEFT" -gt 0 ]; then
    if [ "$CACHE_LEFT" -ge 3600 ]; then
      CACHE_TXT="$((CACHE_LEFT / 3600))h$(( (CACHE_LEFT % 3600) / 60 ))m"
    elif [ "$CACHE_LEFT" -ge 60 ]; then
      CACHE_TXT="$((CACHE_LEFT / 60))m"
    else
      CACHE_TXT="${CACHE_LEFT}s"
    fi
    if [ "$CACHE_LEFT" -le 300 ]; then CACHE_CLR="\033[31m"
    elif [ "$CACHE_LEFT" -le 900 ]; then CACHE_CLR="\033[33m"
    else CACHE_CLR="\033[32m"; fi
    CACHE_SEG=" \033[2m|\033[0m \033[2m⚡\033[0m ${CACHE_CLR}${CACHE_TXT}\033[0m"
    [ -n "$CACHE_TTL" ] && CACHE_SEG="${CACHE_SEG} \033[2m/${CACHE_TTL}\033[0m"
  else
    CACHE_SEG=" \033[2m|\033[0m \033[2m⚡ cold\033[0m"
  fi
fi

# Duration
MINS=$((DURATION_MS / 60000))
SECS=$(((DURATION_MS % 60000) / 1000))

printf '%b' "Model: ${MODEL} \033[2m|\033[0m ${BAR} ${PCT}% \033[2m[${TOKEN_DISPLAY}]\033[0m ${USAGE} \033[2m|\033[0m ${REPO_LINK} \033[2m(session)\033[0m ${MINS}m ${SECS}s${CACHE_SEG}\n"

# --- Line 3: slash commands ---

# Effort levels, the one in force highlighted (a level not listed here is added at the end)
EFFORT=$(echo "$input" | jq -r '.effort.level // empty')
LEVELS="low medium high xhigh max"
if [ -n "$EFFORT" ] && [[ " $LEVELS " != *" $EFFORT "* ]]; then LEVELS="$LEVELS $EFFORT"; fi
EFFORT_SEG=""
for level in $LEVELS; do
  [ -n "$EFFORT_SEG" ] && EFFORT_SEG+="\033[2m|\033[0m"
  if [ "$level" = "$EFFORT" ]; then EFFORT_SEG+="\033[1;32m${level}\033[0m"
  else EFFORT_SEG+="\033[2m${level}\033[0m"; fi
done

printf '%b' "\033[2m/model\033[0m \033[36mmodel\033[0m \033[2m·\033[0m \033[2m/plan\033[0m \033[36mmode\033[0m \033[2m(shift+tab)\033[0m \033[2m·\033[0m \033[2m/effort\033[0m \033[36meffort\033[0m \033[2m(\033[0m${EFFORT_SEG}\033[2m)\033[0m\n"
