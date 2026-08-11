import type {
  AgentPermissionRequest,
  AgentPlanImplementMode,
} from "@getpaseo/protocol/agent-types";

/**
 * Permission modes this plan request offers as implementation choices.
 *
 * The daemon sends these in `metadata` rather than as extra `actions` because a
 * permission request is built once and broadcast to every client: extra actions
 * would render as extra buttons on apps that predate the picker. Fewer than two
 * entries means no picker — an older daemon, or a provider that does not change
 * mode on plan approval at all.
 */
export function getPlanImplementModes(
  request: Pick<AgentPermissionRequest, "metadata">,
): AgentPlanImplementMode[] {
  const raw = request.metadata?.["implementModes"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const modes = raw.flatMap((entry): AgentPlanImplementMode[] => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const { id, label, isDefault } = entry as {
      id?: unknown;
      label?: unknown;
      isDefault?: unknown;
    };
    if (typeof id !== "string" || typeof label !== "string" || id.length === 0) {
      return [];
    }
    const mode: AgentPlanImplementMode = { id, label };
    if (isDefault === true) {
      mode.isDefault = true;
    }
    return [mode];
  });
  return modes.length > 1 ? modes : [];
}

/**
 * Bucket the remembered implement mode is stored under.
 *
 * The project, not the workspace: worktrees of one repo share a workflow, so
 * scoping any narrower would forget the choice every time you branch. Falls back
 * to the checkout path for agents with no project placement (a non-git or
 * ungrouped directory), and to one shared bucket when even that is missing.
 */
export function getPlanImplementModeScope(input: {
  projectKey?: string | null;
  cwd?: string | null;
}): string {
  return input.projectKey?.trim() || input.cwd?.trim() || "";
}

/**
 * The mode a plan card should start on.
 *
 * Returns `null` while the remembered choice is still loading from storage, so
 * callers can hold the decision rather than freeze the fallback and silently
 * discard what the user actually picked last time.
 *
 * With no usable remembered choice it falls back to whatever the request marked
 * `isDefault`, and only then to the first entry. The app never names a mode id
 * of its own: what an id means is the provider's knowledge, not the client's.
 */
export function resolvePlanImplementMode(
  offeredModes: readonly AgentPlanImplementMode[],
  rememberedModeId: string | null | undefined,
): AgentPlanImplementMode | null {
  if (rememberedModeId === undefined || offeredModes.length === 0) {
    return null;
  }
  const remembered = offeredModes.find((mode) => mode.id === rememberedModeId);
  if (remembered) {
    return remembered;
  }
  return offeredModes.find((mode) => mode.isDefault) ?? offeredModes[0] ?? null;
}
