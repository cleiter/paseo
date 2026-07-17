if [[ -n "${_PASEO_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _PASEO_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _PASEO_ZSH_COMMAND_ACTIVE=0

function _paseo_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _paseo_precmd() {
  local command_status=$?
  if [[ "$_PASEO_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _paseo_osc633 "D;${command_status}"
    _PASEO_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _paseo_osc633 "A"
  _paseo_register_zle_hook
}

function _paseo_preexec() {
  _PASEO_ZSH_COMMAND_ACTIVE=1
  _paseo_osc633 "B"
  _paseo_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _paseo_precmd
add-zsh-hook preexec _paseo_preexec

# Readiness marker. precmd is too early to type into: it runs before prompt
# expansion and before any precmd hook a later .zshrc registers, either of which
# can still block on `read`. zle-line-init fires only once the line editor has
# actually taken the line, which is the moment injected input is safe.
#
# The nonce proves the marker came from this terminal's integration rather than
# from stray output that happens to contain OSC 633.
function _paseo_zle_line_init() {
  [[ -n "${PASEO_TERMINAL_NONCE-}" ]] && _paseo_osc633 "R;${PASEO_TERMINAL_NONCE}"
}

# Registered from precmd, not at source time: this file is sourced from .zshenv,
# where zle is not loaded yet and `zle -N` is a no-op. By the first precmd the
# shell is interactive and zle exists.
#
# add-zle-hook-widget (zsh 5.3+) composes with the user's own zle-line-init;
# `zle -N zle-line-init` would silently replace theirs. If it is unavailable,
# emit nothing: the daemon then falls back to its legacy behavior instead of
# waiting for a marker that will never arrive.
function _paseo_register_zle_hook() {
  (( _PASEO_ZLE_HOOK_REGISTERED )) && return
  typeset -g _PASEO_ZLE_HOOK_REGISTERED=1
  autoload -Uz add-zle-hook-widget 2>/dev/null || return
  (( $+functions[add-zle-hook-widget] )) || return
  add-zle-hook-widget zle-line-init _paseo_zle_line_init 2>/dev/null
}
typeset -g _PASEO_ZLE_HOOK_REGISTERED=0
