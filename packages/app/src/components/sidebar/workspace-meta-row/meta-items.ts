import type { PrHint } from "@/git/pr-hint";
import type { SidebarChecksDisplay } from "@/components/sidebar/display-preferences/checks-display";
import type { SidebarRowItems } from "@/components/sidebar/display-preferences/row-items";
import { selectCheckSummary, type CheckSummary } from "./check-summary";
import type { WorkspaceServiceSummary } from "./service-summary";

/**
 * What ends up on the line under a workspace title, in the order it is read: where the workspace
 * lives, what change it belongs to, whether that change is passing, what it is running, and what
 * you filed it under. The work first, then the work's state, then your own annotations.
 *
 * Labels come last because they are the only item on the line whose width is not bounded. The host
 * is a glyph, the change request a number, the checks a word — they cost the same on every row.
 * Labels cost whatever you called them, times however many you applied, and putting a variable
 * item first pushes the fixed ones to a different place on every row, so there is no column to
 * read down. At the end they take the space that is left and the rest of the line stays aligned.
 */
export type MetaRowItem =
  | { kind: "labels"; names: readonly string[] }
  | { kind: "host" }
  | { kind: "changeRequest"; hint: PrHint }
  | { kind: "checks"; summary: CheckSummary; label: boolean }
  | { kind: "services"; summary: WorkspaceServiceSummary }
  | { kind: "outsideFilter" };

/**
 * Which peers a row should draw, given what it knows and what the user left switched on.
 *
 * Kept out of the component because this — not the markup — is the part with rules in it: every
 * toggle answers for itself, so a row can end up showing checks with no change request beside
 * them, and CI resolves from the hint even when the hint itself is not drawn.
 *
 * The host is filtered upstream, where the badge map is built: a host that should show nothing
 * has no badge to hand down, so by the time a row sees one it is meant to be drawn.
 */
export function selectMetaRowItems(input: {
  labels: readonly string[];
  hasHostBadge: boolean;
  prHint: PrHint | null;
  serviceSummary: WorkspaceServiceSummary | null;
  visible: SidebarRowItems;
  checksDisplay: SidebarChecksDisplay;
  outsideFilter: boolean;
}): MetaRowItem[] {
  const { labels, hasHostBadge, prHint, serviceSummary, visible, checksDisplay, outsideFilter } =
    input;
  const items: MetaRowItem[] = [];

  if (hasHostBadge) {
    items.push({ kind: "host" });
  }
  if (prHint && visible.changeRequest) {
    items.push({ kind: "changeRequest", hint: prHint });
  }

  // Independent of the change request, even though checks are read off one. Tying them together
  // meant the checks setting could sit on a value while nothing was drawn, which is a control that
  // lies about its own state. Showing checks without the change request beside them is the
  // stranger combination, but it is the one you asked for and it is what you get.
  if (checksDisplay !== "none") {
    const summary = selectCheckSummary(prHint);
    if (summary) {
      items.push({ kind: "checks", summary, label: checksDisplay === "iconAndText" });
    }
  }

  if (serviceSummary && visible.services) {
    items.push({ kind: "services", summary: serviceSummary });
  }

  if (labels.length > 0 && visible.labels) {
    items.push({ kind: "labels", names: labels });
  }

  // Last, and not governed by any Show toggle. It is not a fact about the workspace but about why
  // this row is on screen when the filter says it should not be, and that has to be readable
  // whatever else the row has been asked to hide. It sits after the labels because they are what
  // it is usually explaining.
  if (outsideFilter) {
    items.push({ kind: "outsideFilter" });
  }

  return items;
}
