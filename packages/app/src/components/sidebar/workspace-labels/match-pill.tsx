import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  countIncludedLabelFilters,
  type LabelFilterMode,
  type LabelMatchMode,
} from "@/components/sidebar/sidebar-filter";
import { isWeb } from "@/constants/platform";

/**
 * What two lit labels mean together, after the labels it governs.
 *
 * Only from two: with one label lit the two modes produce the same list, so a control there offers
 * a decision that cannot change anything. It appears at the moment the question exists — the
 * second tap — which is also the moment someone wonders why they got more workspaces rather than
 * fewer.
 *
 * Last rather than first: it comes and goes as the second label lights, and a control that does
 * that from the front pushes every chip along under the pointer that just pressed one.
 *
 * Drawn deliberately unlike a chip: no swatch, a dashed border, and a word rather than a name, so a
 * row that reads "Backend · Review · Match all" cannot be read as three labels one of which is
 * called "Match all".
 */
export function WorkspaceLabelMatchPill({
  labelFilters,
  labelMatch,
  onToggle,
  testID = "sidebar-label-match",
}: {
  labelFilters: Readonly<Record<string, LabelFilterMode>>;
  labelMatch: LabelMatchMode;
  onToggle: (mode: LabelMatchMode) => void;
  testID?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const handlePress = useCallback(
    () => onToggle(labelMatch === "all" ? "any" : "all"),
    [labelMatch, onToggle],
  );
  const pillStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.pill,
      hovered && !pressed && styles.pillHovered,
      pressed && styles.pillPressed,
    ],
    [],
  );

  if (countIncludedLabelFilters(labelFilters) < 2) return null;

  const all = labelMatch === "all";
  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={t(all ? "sidebar.labelTrack.match.all" : "sidebar.labelTrack.match.any")}
      onPress={handlePress}
      style={pillStyle}
      testID={testID}
    >
      {/* The narrowing mode is the loud one: "all" is the sidebar showing you less, so it is drawn
          at full strength the way an applied view's name is. */}
      <Text style={all ? styles.textAll : styles.text} numberOfLines={1}>
        {t(all ? "sidebar.labelTrack.match.all" : "sidebar.labelTrack.match.any")}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The chip's metrics exactly, so it sits on the same line without nudging the row it heads.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 20,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    userSelect: "none",
  },
  pillHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  pillPressed: {
    opacity: 0.7,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  textAll: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
