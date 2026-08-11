import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarViewStore, type LabelFilterCycleDirection } from "@/stores/sidebar-view-store";
import { useWorkspaceLabelColors } from "@/stores/workspace-label-catalog-store";
import type { LabelFilterMode } from "@/components/sidebar/sidebar-filter";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { WorkspaceLabelMatchPill } from "./match-pill";
import type { WorkspaceLabelColors } from "./catalog";
import {
  WORKSPACE_LABEL_SWATCH_SIZE,
  WorkspaceLabelExcludedMark,
  WorkspaceLabelSwatch,
  workspaceLabelBorder,
  workspaceLabelFill,
  workspaceLabelText,
} from "./label-chip";

/**
 * The label filter as a row of chips above the list, rather than three taps into a menu.
 *
 * Multi-select: every chip is its own tri-state, and picking two includes widens the list rather
 * than narrowing it. That is the shape the sidebar already has — a workspace can carry several
 * labels — and it is what makes the track worth its vertical space over the menu page, which says
 * the same thing one row at a time.
 *
 * It appears with the first label anyone creates and goes away with the last one. There is no
 * setting to find first: a track that has to be switched on is a track nobody finds, and labels
 * are invisible until something shows them.
 *
 * It can be put away, from the Tag button in the Workspaces header — see
 * `SidebarLabelFilterToggle`, which owns that state and says when the hidden track is filtering.
 * Away means gone: no heading left behind, because a heading over nothing is the cost this track
 * was being put away to avoid.
 *
 * The chips wrap rather than scroll sideways. A horizontal scroller in a 300px column hides its
 * own contents: the last chip is cut by the viewport edge with nothing on screen saying there is
 * more, and reaching it needs a swipe nobody knows to try.
 *
 * Which labels those are is the sidebar model's answer, not the whole catalog: with a host or
 * project facet on, the track offers the labels the surviving workspaces carry (plus any already
 * filtering). See `selectFilterableLabels`.
 *
 * Every label in scope is drawn, however many there are. A cap with a "+2" behind it costs the
 * width of a chip to hide two, and it hides them from the one control whose whole job is showing
 * you what you
 * can filter by — a filter you cannot see is a filter you do not use. The track wraps, so the price
 * of a long list is paid in rows, where it is visible and where scrolling the list still works.
 */
export function SidebarLabelTrack(): ReactElement | null {
  const { filterableLabels: labels } = useSidebarModel();
  const colors = useWorkspaceLabelColors();
  const labelFilters = useSidebarViewStore((state) => state.labelFilters);
  const cycleLabelFilter = useSidebarViewStore((state) => state.cycleLabelFilter);
  const labelMatch = useSidebarViewStore((state) => state.labelMatch);
  const setLabelMatch = useSidebarViewStore((state) => state.setLabelMatch);
  const hidden = useSidebarCollapsedSectionsStore((state) => state.collapsedLabelFilters);

  if (labels.length === 0 || hidden) return null;

  return (
    <View style={styles.track} testID="sidebar-label-track">
      {labels.map((label) => (
        <LabelTrackChip
          key={label.toLowerCase()}
          label={label}
          mode={labelFilters[label.toLowerCase()]}
          colors={colors}
          onCycle={cycleLabelFilter}
        />
      ))}
      {/* After the chips, not before them. It comes and goes with the second lit label, and
          anything ahead of the chips that does that shoves the whole track sideways under the
          pointer that just lit one. Last, it appends. */}
      <WorkspaceLabelMatchPill
        labelFilters={labelFilters}
        labelMatch={labelMatch}
        onToggle={setLabelMatch}
      />
    </View>
  );
}

/**
 * Neutral, included, excluded — the same three states the menu page cycles, drawn to be told apart
 * at a glance in a row: included takes the label's own colour, excluded strikes its name through,
 * neutral is neither.
 *
 * The swatch is drawn in the two states that are not excluded, where it gives way to the crossed-out
 * eye in the label's own colour, the same mark the filter page and the view editor use. The fill
 * arrives only when the label is included. A track that
 * showed no colour until you pressed something opened as a row of identical grey pills, which
 * reads as disabled and is the one state the track is in almost all the time; the swatch is what
 * ties a chip here to the same label on a row and in the hover card. Keeping the swatch when the
 * fill arrives is what stops a press from resizing the chip and reflowing the line under your
 * pointer.
 *
 * The cost is a row of coloured dots above a list that has status dots of its own. They are
 * separated by the divider and by being square rather than round, and the alternative — no colour
 * at rest — was worse.
 */
function LabelTrackChip({
  label,
  mode,
  colors,
  onCycle,
}: {
  label: string;
  mode: LabelFilterMode | undefined;
  colors: WorkspaceLabelColors;
  onCycle: (label: string, direction: LabelFilterCycleDirection) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(
    (event: GestureResponderEvent) => onCycle(label, pressCycleDirection(event)),
    [label, onCycle],
  );
  const included = mode === "include";

  const chipStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.chip,
      included && workspaceLabelFill(colors, label),
      included && workspaceLabelBorder(colors, label),
      hovered && !pressed && !included && styles.chipHovered,
      pressed && styles.chipPressed,
    ],
    [colors, included, label],
  );

  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={t(ACCESSIBILITY_KEYS[mode ?? "neutral"], { label })}
      onPress={handlePress}
      style={chipStyle}
      testID={`sidebar-label-track-${label.toLowerCase()}`}
    >
      {mode === "exclude" ? (
        // Sized to the swatch it stands in for, so cycling into excluded does not resize the chip.
        <WorkspaceLabelExcludedMark
          name={label}
          colors={colors}
          size={WORKSPACE_LABEL_SWATCH_SIZE}
        />
      ) : (
        <WorkspaceLabelSwatch name={label} colors={colors} />
      )}
      <Text style={chipTextStyle(mode, colors, label)} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Held down, a press walks the ring the other way: neutral straight to excluded, and excluded back
 * to included. Three states is a short ring, so this saves one press — worth having on the chips
 * because hiding a label is the thing you reach for while looking at the row you want gone.
 *
 * Cmd or Shift, and not Ctrl, for a reason outside our control: react-native-web builds the press
 * event's `nativeEvent` with `ctrlKey` and `altKey` hardcoded to false and only carries `metaKey`
 * and `shiftKey` through from the DOM (`createResponderEvent.js`). Shift is the one that works
 * everywhere, Cmd is there because macOS reaches for it first.
 *
 * Undiscoverable on purpose: everything it does is one extra press away without it, so nothing is
 * lost by not knowing, and a chip is too small to advertise a second gesture on.
 */
function pressCycleDirection(event: GestureResponderEvent): LabelFilterCycleDirection {
  const native = event.nativeEvent as { metaKey?: boolean; shiftKey?: boolean };
  return native.metaKey === true || native.shiftKey === true ? "backward" : "forward";
}

// Read inside render, never from a module-scope table — see docs/unistyles.md.
function chipTextStyle(
  mode: LabelFilterMode | undefined,
  colors: WorkspaceLabelColors,
  label: string,
) {
  if (mode === "include") return [styles.text, workspaceLabelText(colors, label)];
  if (mode === "exclude") return styles.textExcluded;
  return styles.text;
}

const ACCESSIBILITY_KEYS = {
  neutral: "sidebar.labelTrack.accessibility.neutral",
  include: "sidebar.labelTrack.accessibility.included",
  exclude: "sidebar.labelTrack.accessibility.excluded",
} as const;

const styles = StyleSheet.create((theme) => ({
  track: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    // Drawn above the scroll view, so it pays for itself the inset the list's contentContainer
    // gives Pinned: spacing[2] of gutter plus spacing[2] more, the same rail as the Workspaces
    // heading above and the project glyphs below.
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1.5],
    flexGrow: 0,
    flexShrink: 0,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    minHeight: 20,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
    // Carried in every state, coloured in one. A border that appears on press would grow the chip
    // by two pixels and shove the chips after it along the line.
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    userSelect: "none",
    // A label long enough to fill the column wraps to a line of its own and ellipsizes there
    // rather than pushing the track wider than the sidebar.
    maxWidth: "100%",
  },
  // A chip that is not included carries no fill in either scheme, so a fill means one thing. The
  // resting fill used to be `surface2`, which is the sidebar's own colour in light mode and a
  // visible pill in dark — the same chip reading as a control on one scheme and as loose text on
  // the other.
  chipHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  chipPressed: {
    opacity: 0.82,
  },
  // The name gives way before the swatch does: a chip too long for the column loses letters, not
  // the mark that says which label it is.
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    flexShrink: 1,
    minWidth: 0,
  },
  textExcluded: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    textDecorationLine: "line-through",
    flexShrink: 1,
    minWidth: 0,
  },
}));
