/**
 * What a label dialog has to send, worked out from the draft alone.
 *
 * The dialog edits a name and a colour together, but they are two different writes with two
 * different blast radii: renaming sweeps every workspace on every host, recolouring touches only
 * the catalog. Deciding which of them the draft actually needs is the part worth testing, and this
 * repo has no component tests, so it lives here rather than inside the modal.
 *
 * `color: null` in a draft means automatic — the colour the name hashes to, which is what a label
 * wears when nobody has chosen for it.
 */

import {
  checkWorkspaceLabelRename,
  deriveWorkspaceLabelColor,
  hasWorkspaceLabel,
  normalizeWorkspaceLabel,
  type WorkspaceLabelColor,
  type WorkspaceLabelRenameProblem,
} from "@getpaseo/protocol/workspace-labels";

export interface WorkspaceLabelDraft {
  name: string;
  color: WorkspaceLabelColor | null;
}

export type WorkspaceLabelEditStep =
  | { kind: "rename"; from: string; to: string }
  | { kind: "setColor"; name: string; color: WorkspaceLabelColor }
  | { kind: "resetColor"; name: string };

export type WorkspaceLabelPlan<Success> =
  | ({ ok: true } & Success)
  | { ok: false; problem: WorkspaceLabelRenameProblem };

/**
 * A new label always gets an explicit colour, even when the draft never touched the picker.
 *
 * Assignments are what make a label exist on a workspace, but a label created from Settings has no
 * workspace — the catalog entry is the only thing holding it. Writing the colour the dialog was
 * showing is what keeps "New label" from producing a label that vanishes the moment you close it.
 */
export function planWorkspaceLabelCreate(input: {
  draft: WorkspaceLabelDraft;
  existing: readonly string[];
}): WorkspaceLabelPlan<{ name: string; color: WorkspaceLabelColor }> {
  const name = normalizeWorkspaceLabel(input.draft.name);
  if (name === null) {
    return { ok: false, problem: "emptyName" };
  }
  if (hasWorkspaceLabel(input.existing, name)) {
    return { ok: false, problem: "nameTaken" };
  }
  return { ok: true, name, color: input.draft.color ?? deriveWorkspaceLabelColor(name) };
}

/**
 * The steps an edit needs, in the order they have to happen: the rename first, so the colour lands
 * on the name that exists afterwards.
 *
 * A colour equal to the one already chosen produces no step. The daemon's rename carries the
 * catalog entry across with the assignments, so re-sending the same colour under the new name
 * would be a second write to say what the first one already said.
 */
export function planWorkspaceLabelEdit(input: {
  original: string;
  /** The chosen colour, or null when the label is wearing its derived one. */
  originalColor: WorkspaceLabelColor | null;
  draft: WorkspaceLabelDraft;
  existing: readonly string[];
}): WorkspaceLabelPlan<{ name: string; steps: WorkspaceLabelEditStep[] }> {
  const check = checkWorkspaceLabelRename({
    from: input.original,
    to: input.draft.name,
    // `existing` may name the label being edited; that is not a collision with itself, and the
    // check already exempts it — changing only the spelling is a rename, not a clash.
    existing: input.existing,
  });
  if (!check.ok) {
    return { ok: false, problem: check.problem };
  }

  const steps: WorkspaceLabelEditStep[] = [];
  if (check.from !== check.to) {
    steps.push({ kind: "rename", from: check.from, to: check.to });
  }
  const color = input.draft.color;
  if (color === null) {
    if (input.originalColor !== null) {
      steps.push({ kind: "resetColor", name: check.to });
    }
  } else if (color !== input.originalColor) {
    steps.push({ kind: "setColor", name: check.to, color });
  }
  return { ok: true, name: check.to, steps };
}
