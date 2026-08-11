/**
 * Workspace labels. A label is a name plus a colour, and **the name is the identity** — there is
 * no id anywhere in the model.
 *
 * That is forced by multi-host. Each daemon keeps its own catalog, and the two are meant to
 * merge into one list in the client; two independent daemons have never seen each other's ids,
 * so the name is the only join key available. It also means `blocked` means the same thing on
 * every host for free. The cost is that renaming a label is a sweep over every workspace carrying
 * the old name — the daemon does that sweep, see `workspace.labels.catalog.rename`, because there
 * is no id to repoint and it is the one holding the workspaces.
 *
 * The wire schema stays a plain `string[]` (protocol schemas must not transform), so every write
 * path normalizes through here before it persists.
 */

export const MAX_WORKSPACE_LABEL_LENGTH = 32;
export const MAX_WORKSPACE_LABELS = 10;

/**
 * The colours a label can be. A key, never a hex: the daemon has no idea whether the client is
 * in light or dark mode, and one hex cannot clear the contrast band in both. The client owns the
 * two tables this key indexes into.
 *
 * These are the app's existing identity colours — the same ten that colour project icons and
 * host badges — so a label sits in a sidebar row next to them without introducing an eleventh
 * palette. Order is not load-bearing here; the name is what is stored.
 */
export const WORKSPACE_LABEL_COLORS = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;

export type WorkspaceLabelColor = (typeof WORKSPACE_LABEL_COLORS)[number];

export function isWorkspaceLabelColor(value: string): value is WorkspaceLabelColor {
  return (WORKSPACE_LABEL_COLORS as readonly string[]).includes(value);
}

/**
 * The colour a label gets when nobody has picked one. Deterministic from the name, so a label
 * created on one host looks the same on another before either has heard of the other's catalog,
 * and so a brand new label is never colourless while the write is in flight.
 *
 * Case-insensitive, because `Blocked` and `blocked` are one label.
 */
export function deriveWorkspaceLabelColor(name: string): WorkspaceLabelColor {
  const key = name.toLowerCase();
  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return WORKSPACE_LABEL_COLORS[hash % WORKSPACE_LABEL_COLORS.length];
}

/**
 * Normalize one label name. Whitespace is collapsed so `"needs  review"` and `"needs review"`
 * are the same label rather than two chips that look identical. Returns null when nothing is
 * left, which callers drop.
 */
export function normalizeWorkspaceLabel(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return null;
  }
  return collapsed.slice(0, MAX_WORKSPACE_LABEL_LENGTH);
}

/**
 * Normalize a workspace's label set: drop empties, dedupe case-insensitively keeping the first
 * spelling the user typed, and cap the count. Order is preserved because it is the order the
 * chips render in.
 */
export function normalizeWorkspaceLabels(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const candidate of raw) {
    const label = normalizeWorkspaceLabel(candidate);
    if (label === null) {
      continue;
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    labels.push(label);
    if (labels.length === MAX_WORKSPACE_LABELS) {
      break;
    }
  }

  return labels;
}

/** Case-insensitive membership, so a filter chip matches whatever spelling the workspace stored. */
export function hasWorkspaceLabel(labels: readonly string[], label: string): boolean {
  const key = label.toLowerCase();
  return labels.some((candidate) => candidate.toLowerCase() === key);
}

export type WorkspaceLabelRenameProblem = "emptyName" | "nameTaken";

export type WorkspaceLabelRenameCheck =
  | { ok: true; from: string; to: string }
  | { ok: false; problem: WorkspaceLabelRenameProblem };

/**
 * Whether a rename is allowed, decided the same way on both ends of the wire.
 *
 * The client asks so it can answer while the name is still in the box, and the daemon asks because
 * it is the authority and two clients can race. One function rather than two so the message you
 * read and the reason you were refused cannot drift apart.
 *
 * A name already in use is refused, not merged. Merging two labels is destructive in a way a
 * rename is not — every workspace carrying either name ends up carrying one — so it has to be
 * asked for as itself.
 *
 * Changing only the spelling (`blocked` → `Blocked`) is a rename, not a collision with itself.
 */
export function checkWorkspaceLabelRename(input: {
  from: string;
  to: string;
  existing: readonly string[];
}): WorkspaceLabelRenameCheck {
  const from = normalizeWorkspaceLabel(input.from);
  const to = normalizeWorkspaceLabel(input.to);
  if (from === null || to === null) {
    return { ok: false, problem: "emptyName" };
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return { ok: true, from, to };
  }
  if (hasWorkspaceLabel(input.existing, to)) {
    return { ok: false, problem: "nameTaken" };
  }
  return { ok: true, from, to };
}

/** One label's presentation. The daemon stores these; workspaces store only the name. */
export interface WorkspaceLabelDefinition {
  name: string;
  color: WorkspaceLabelColor;
}

/**
 * Normalize a whole catalog: normalize each name, drop the ones that normalize away, dedupe
 * case-insensitively keeping the first entry, and replace an unknown colour with the derived
 * one rather than dropping the label. A label whose colour a newer client invented should still
 * appear — losing the label to save its colour is the worse trade.
 */
export function normalizeWorkspaceLabelCatalog(
  raw: readonly { name: string; color?: string | null }[],
): WorkspaceLabelDefinition[] {
  const seen = new Set<string>();
  const catalog: WorkspaceLabelDefinition[] = [];

  for (const candidate of raw) {
    const name = normalizeWorkspaceLabel(candidate.name);
    if (name === null) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    catalog.push({
      name,
      color:
        typeof candidate.color === "string" && isWorkspaceLabelColor(candidate.color)
          ? candidate.color
          : deriveWorkspaceLabelColor(name),
    });
  }

  return catalog;
}

/**
 * The colour to draw a label in, given the catalog. A workspace can carry a label the catalog
 * has never heard of — it was labelled on another host, or the catalog write lost a race — and
 * that label still has to render, so the miss falls back to the derived colour instead of a
 * placeholder.
 */
export function resolveWorkspaceLabelColor(
  catalog: readonly WorkspaceLabelDefinition[],
  name: string,
): WorkspaceLabelColor {
  const key = name.toLowerCase();
  const entry = catalog.find((candidate) => candidate.name.toLowerCase() === key);
  return entry?.color ?? deriveWorkspaceLabelColor(name);
}
