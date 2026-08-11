/**
 * Turning what the hosts know about label colours into one lookup the sidebar can paint from.
 *
 * Every daemon keeps its own catalog and they are merged here by name, because the name is the
 * only join key two daemons share — see the docblock in `@getpaseo/protocol/workspace-labels`.
 * The merge is first-host-wins, in the order the caller hands them over: a label that means the
 * same thing on both machines should look the same on both, and picking one answer is the only
 * way to get that from two independent lists. The alternative — a chip that changes colour when
 * you switch hosts — makes the colour say something it doesn't mean.
 *
 * A label nobody has coloured is not a hole. It falls back to the colour derived from its name,
 * so a label reads correctly the instant it exists and long before anyone opens a colour picker.
 */

import {
  deriveWorkspaceLabelColor,
  isWorkspaceLabelColor,
  type WorkspaceLabelColor,
} from "@getpaseo/protocol/workspace-labels";

export interface WorkspaceLabelCatalogEntry {
  name: string;
  color: string;
  /** The daemon filled this colour in from the name; nobody chose it. */
  derived?: boolean;
}

export type WorkspaceLabelColors = ReadonlyMap<string, WorkspaceLabelColor>;

/**
 * Colours are keyed by the lowercased name because that is what identity means here: `Blocked`
 * and `blocked` are the same label wearing two spellings, and the spelling belongs to whoever
 * typed it, not to the palette.
 *
 * A colour this client does not recognise is dropped rather than kept — it can only come from a
 * host running a newer palette, and a name we cannot paint is better served by the derived
 * colour than by a blank.
 */
export function mergeWorkspaceLabelCatalogs(
  catalogs: Iterable<readonly WorkspaceLabelCatalogEntry[]>,
): WorkspaceLabelColors {
  const colors = new Map<string, WorkspaceLabelColor>();
  for (const catalog of catalogs) {
    for (const entry of catalog) {
      const key = entry.name.trim().toLowerCase();
      if (key.length === 0 || colors.has(key)) continue;
      if (isWorkspaceLabelColor(entry.color)) {
        colors.set(key, entry.color);
      }
    }
  }
  return colors;
}

export function workspaceLabelColor(
  colors: WorkspaceLabelColors,
  name: string,
): WorkspaceLabelColor {
  return colors.get(name.trim().toLowerCase()) ?? deriveWorkspaceLabelColor(name);
}

/**
 * The labels somebody picked a colour for, as opposed to the ones wearing the colour their name
 * hashes to. One host having chosen is enough — a colour that is a choice anywhere is a choice
 * you can take back, and the merge means it is the one on screen.
 */
export function collectChosenWorkspaceLabelColors(
  catalogs: Iterable<readonly WorkspaceLabelCatalogEntry[]>,
): ReadonlySet<string> {
  const chosen = new Set<string>();
  for (const catalog of catalogs) {
    for (const entry of catalog) {
      if (entry.derived === true) continue;
      const key = entry.name.trim().toLowerCase();
      if (key.length > 0) chosen.add(key);
    }
  }
  return chosen;
}
