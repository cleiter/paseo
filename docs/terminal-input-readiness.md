# Terminal input readiness

Paseo runs `paseo.json` scripts and worktree bootstrap commands by **typing them
into a real terminal** — `spawnWorkspaceScript` and `runWorktreeTerminalBootstrap`
create a PTY running the user's interactive shell and send `<command>\r` as input.
That is deliberate: the command gets the user's real shell environment, aliases and
functions, the output lands in a terminal the user can read and Ctrl-C, and the
shell (not us) parses the command line.

The catch: **input is a shared channel.** Whatever is reading stdin at that moment
receives the keystrokes. If shell startup is blocked on `read`, it — not the line
editor — eats them.

## The bug this exists to prevent

oh-my-zsh prints `[oh-my-zsh] Would you like to update? [Y/n]` during startup and
blocks on `read -k 1`. Paseo's old readiness check resolved as soon as the terminal
produced **any output**, so it typed the command into that prompt. The `read` ate
the first character and the rest replayed onto the shell line:

```
PASEO_DEV_MANAGED_HOME=1 … npm run dev     ← what we sent
ASEO_DEV_MANAGED_HOME=1 … npm run dev      ← what ran (the P answered the prompt)
```

A silently wrong env var. Had the first character been `y`, it would have answered
"yes, update oh-my-zsh" instead.

## The invariant

**Only type when the shell's line editor owns stdin.** Two properties make that
checkable:

1. **At-prompt is current state, not history.** `TerminalSession.isAtPrompt()` is
   true only while ZLE holds the line. It goes false on OSC `633;C` (a command took
   the foreground) and on shell exit. "It printed a prompt once" is not evidence
   that stdin is free now — which is also what makes reusing a script terminal safe.
2. **The marker is nonce-tagged.** Each terminal gets a `PASEO_TERMINAL_NONCE` in
   its env; the shell hook echoes it back in the marker. Stray OSC 633 traffic and
   replayed scrollback cannot fake readiness. This is a collision guard, not a
   security boundary — anything that can read the env can type into the PTY anyway.

## Why `zle-line-init`, not `precmd`

The obvious hook is `precmd` (which already emits OSC `633;A`). It is **too early**:

- `precmd` runs _before_ prompt expansion, which can itself run command
  substitutions and prompt plugins that read input.
- Our hook is registered from `.zshenv`, so it runs _before_ any `precmd` hook a
  later `.zshrc` adds — including one that blocks on `read`.

`zle-line-init` fires only once the line editor has actually taken the line. That is
the moment injected input is safe, so that is where the marker is emitted
(`packages/server/src/terminal/shell-integration/zsh/paseo-integration.zsh`).

Two gotchas in that hook:

- It is registered lazily **from `precmd`**, not at source time. The integration is
  sourced from `.zshenv`, where zle is not loaded yet and `zle -N` is a no-op.
- It uses `add-zle-hook-widget` (zsh 5.3+), never `zle -N zle-line-init`, which
  would silently replace a user's own widget. If the helper is unavailable the hook
  emits nothing and the daemon falls back to the legacy heuristic rather than
  waiting for a marker that never comes.

## Protocol

| OSC              | Meaning                                 | Emitted from    |
| ---------------- | --------------------------------------- | --------------- |
| `633;R;<nonce>`  | Line editor has the line — safe to type | `zle-line-init` |
| `633;C`          | Command took the foreground — not safe  | `preexec`       |
| `633;D;<status>` | Command finished                        | `precmd`        |

`633;R` is Paseo's own; the rest follow VS Code's shell integration shape. Terminals
live in a worker process, so prompt state crosses to the daemon as a
`terminalPromptState` event (`terminal-worker-protocol.ts`). Ordering rules that the
manager must keep — each has a test in `worker-terminal-manager.test.ts`:

- A prompt event can arrive **before** `terminalCreated`; it is buffered, not dropped.
- `terminalCreated` and the create response both register the same record, so
  re-registration must not roll live prompt state back to the spawn-time snapshot.
  This is why `atPrompt` lives on the record, not inside `info`.
- Exit forces `atPrompt` false.

## Failure behavior

`waitForTerminalInputReadiness` subscribes **before** re-reading the state (the
marker can land in the gap), rejects immediately on terminal exit, and otherwise
times out after 15s with a `TerminalNotReadyError`. It never types anyway — that
would reintroduce the exact bug.

On a readiness timeout the terminal is **left open**: it holds the prompt the user
needs to answer. For plain scripts the runtime entry is preserved with its
`terminalId`, so re-running reuses that same shell — answer the prompt, run again,
and the command lands intact. Service scripts get a freshly planned port on the next
run and their terminal's env carries the old one, so reuse would be wrong; their
entry is dropped and the retry starts clean.

## Known gap: non-zsh shells

Only zsh ships an integration, so `shellIntegrationExpected` is zsh-only. bash, fish
and custom shells fall back to the old heuristic (first output, or 1.5s) and remain
exposed to the corruption above. There is no reliable shell-agnostic PTY readiness
signal — foreground process ownership and terminal modes cannot tell a line editor
from a `read` inside an rc file — so each shell needs its own integration. The nonce
env var is injected for every shell so a bash/fish hook can adopt the same marker
without a protocol change.
