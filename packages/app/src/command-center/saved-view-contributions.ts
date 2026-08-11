import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface SavedViewCommandCenterView {
  id: string;
  name: string;
  /** What the view narrows to, in one line — you are picking it here without seeing the sidebar. */
  summary: string;
}

export interface SavedViewCommandCenterLabels {
  section: string;
  /**
   * Titles a view's command with a verb, not just its name. A row reading "Review" alone is
   * indistinguishable from a workspace called Review two rows down, and the palette matches on the
   * title — the verb is what lets one query find the view and skip everything else called that.
   */
  show(name: string): string;
  save: string;
  /** Names the view for the same reason `edit` does. */
  update(name: string): string;
  /**
   * Names the view, unlike the menu's "Edit view…". The menu row sits under the view you picked;
   * a palette command has only its own title, and this one matches on the view's name — a command
   * found by a word it does not show reads as a mismatch.
   */
  edit(name: string): string;
  /** Terms that should find these commands whatever the views are called. */
  keywords: readonly string[];
}

export interface SavedViewCommandCenterIcons {
  view?: CommandCenterIcon;
  save?: CommandCenterIcon;
  update?: CommandCenterIcon;
  edit?: CommandCenterIcon;
}

export interface SavedViewCommandCenterSource {
  views: readonly SavedViewCommandCenterView[];
  /**
   * The view Edit and Update act on, and whether the sidebar has moved away from it. Null when no
   * view is applied; `edited` false means Update would write back what is already there.
   */
  active: { id: string; name: string; edited: boolean } | null;
  /** Whether there is anything worth naming — the sidebar's default arrangement is not. */
  canSave: boolean;
  labels: SavedViewCommandCenterLabels;
  icons: SavedViewCommandCenterIcons;
  apply(id: string): void;
  save(): void;
  update(id: string): void;
  edit(id: string): void;
}

/**
 * The saved views, and the verbs that change them, as palette commands.
 *
 * A view is reached by name, which is the whole point of naming it — so each view is its own
 * command, titled "Show view <name>" so one query reaches it past everything else that shares the
 * name, with the summary as the subtitle so the palette answers "what does this one do" without
 * you applying it first. One command per view rather than a "Switch view…" that opens a second
 * list: the palette is already the list.
 *
 * Query-only. Views are personal and there can be a dozen; a palette that leads with them before
 * you have typed anything buries the actions everyone has.
 */
export function buildSavedViewContributions(
  source: SavedViewCommandCenterSource,
): CommandCenterContribution[] {
  const contributions: CommandCenterContribution[] = source.views.map((view, index) => ({
    id: `saved-view:${view.id}`,
    group: "views",
    groupRank: 1,
    rank: index,
    keywords: [...source.labels.keywords, view.name],
    visibility: "query",
    run: () => source.apply(view.id),
    presentation: {
      kind: "action",
      title: source.labels.show(view.name),
      subtitle: view.summary,
      sectionTitle: source.labels.section,
      icon: source.icons.view,
    },
  }));

  const nextRank = source.views.length;
  if (source.canSave) {
    contributions.push({
      id: "saved-view:save",
      group: "views",
      groupRank: 1,
      rank: nextRank,
      keywords: [...source.labels.keywords, "save", "new"],
      visibility: "query",
      run: () => source.save(),
      presentation: {
        kind: "action",
        title: source.labels.save,
        sectionTitle: source.labels.section,
        icon: source.icons.save,
      },
    });
  }

  const active = source.active;
  if (!active) return contributions;

  // Only where it would do something. Update on a view the sidebar still matches writes back what
  // is already stored, which is a command that reports success and changes nothing.
  if (active.edited) {
    contributions.push({
      id: "saved-view:update",
      group: "views",
      groupRank: 1,
      rank: nextRank + 1,
      keywords: [...source.labels.keywords, "update", "overwrite", active.name],
      visibility: "query",
      run: () => source.update(active.id),
      presentation: {
        kind: "action",
        title: source.labels.update(active.name),
        sectionTitle: source.labels.section,
        icon: source.icons.update,
      },
    });
  }

  contributions.push({
    id: "saved-view:edit",
    group: "views",
    groupRank: 1,
    rank: nextRank + 2,
    keywords: [...source.labels.keywords, "edit", "rename", active.name],
    visibility: "query",
    run: () => source.edit(active.id),
    presentation: {
      kind: "action",
      title: source.labels.edit(active.name),
      sectionTitle: source.labels.section,
      icon: source.icons.edit,
    },
  });

  return contributions;
}
