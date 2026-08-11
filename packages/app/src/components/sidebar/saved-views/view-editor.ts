import type { LabelFilterMode, LabelMatchMode } from "@/components/sidebar/sidebar-filter";
import type { SavedSidebarView, SidebarGroupMode } from "@/stores/sidebar-view-store";

/**
 * A view being edited, before it is written back.
 *
 * The same shape a view stores, plus the name. The editor holds one of these rather than driving
 * the live sidebar, so closing the dialog throws the edit away instead of leaving you filtered by
 * something you were only trying out.
 */
export interface SavedViewDraft {
  name: string;
  /** Null keeps whatever grouping you are on — see `SavedSidebarView.groupMode`. */
  groupMode: SidebarGroupMode | null;
  hostFilters: readonly string[];
  projectFilters: readonly string[];
  labelFilters: Readonly<Record<string, LabelFilterMode>>;
  labelMatch: LabelMatchMode;
}

export function draftFromSavedView(view: SavedSidebarView): SavedViewDraft {
  return {
    name: view.name,
    groupMode: view.groupMode,
    hostFilters: [...view.hostFilters],
    projectFilters: [...view.projectFilters],
    labelFilters: { ...view.labelFilters },
    labelMatch: view.labelMatch,
  };
}

/** An allowlist entry on or off. Empty still means "all", the same as it does in the store. */
export function toggleDraftEntry(entries: readonly string[], entry: string): string[] {
  return entries.includes(entry) ? entries.filter((value) => value !== entry) : [...entries, entry];
}

/** Neutral → "only these" → "never these" → neutral, matching the chip track and the filter menu. */
export function cycleDraftLabel(
  filters: Readonly<Record<string, LabelFilterMode>>,
  name: string,
): Record<string, LabelFilterMode> {
  const key = name.trim().toLowerCase();
  const { [key]: current, ...rest } = filters;
  if (key.length === 0) return { ...filters };
  if (current === undefined) return { ...rest, [key]: "include" };
  if (current === "include") return { ...rest, [key]: "exclude" };
  return rest;
}

export type SavedViewEditProblem = "nameEmpty" | "nameTaken";

export type SavedViewEditPlan =
  | { ok: true; edit: Omit<SavedSidebarView, "id"> }
  | { ok: false; problem: SavedViewEditProblem };

/**
 * The draft as the store will hold it, or why it cannot be saved.
 *
 * Names are how a view is picked out of the list, so two views called "Review" is a list you have
 * to apply to read. The comparison is case-insensitive for the same reason the label catalog's is:
 * "review" and "Review" are the same name to everyone but the code. A name already in use is
 * refused rather than taken as "replace that one" — writing over a view is the Update row, which
 * needs no name and no dialog.
 *
 * Creating a view runs through here too, with the id it is about to be saved under: nothing holds
 * that id yet, so the exclusion below covers both cases without a second function.
 */
export function planSavedViewEdit(input: {
  viewId: string;
  draft: SavedViewDraft;
  existing: readonly SavedSidebarView[];
}): SavedViewEditPlan {
  const name = input.draft.name.trim();
  if (name.length === 0) return { ok: false, problem: "nameEmpty" };
  const taken = input.existing.some(
    (view) => view.id !== input.viewId && view.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) return { ok: false, problem: "nameTaken" };
  return {
    ok: true,
    edit: {
      name,
      groupMode: input.draft.groupMode,
      hostFilters: [...input.draft.hostFilters],
      projectFilters: [...input.draft.projectFilters],
      labelFilters: { ...input.draft.labelFilters },
      labelMatch: input.draft.labelMatch,
    },
  };
}
