import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useSidebarModel } from "./sidebar-model";

/**
 * What the filter took away, said out loud, with the way back beside it.
 *
 * The sidebar is where you find out an agent needs input, so a filter that removes rows removes
 * notifications with them. This rail is the answer: it is always there while a filter is on.
 * Without it, a filtered sidebar and a quiet one look the same.
 *
 * Pressing it clears every facet at once — the only thing you want from a row that says workspaces
 * are missing is to stop them missing, and having to work out which of two filters is responsible
 * is not that. The host filter is left alone: it is not what this rail is counting.
 */
export function SidebarHiddenRail(): ReactElement | null {
  const { t } = useTranslation();
  const { filter } = useSidebarModel();
  const clearLabelFilters = useSidebarViewStore((state) => state.clearLabelFilters);
  const clearProjectFilters = useSidebarViewStore((state) => state.clearProjectFilters);
  const handlePress = useCallback(() => {
    clearLabelFilters();
    clearProjectFilters();
  }, [clearLabelFilters, clearProjectFilters]);

  if (!filter.isFiltering || filter.hiddenCount === 0) return null;

  const hidden = t("sidebar.filter.hidden", { count: filter.hiddenCount });
  const clear = t("sidebar.filter.clear");

  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={`${hidden}, ${clear}`}
      onPress={handlePress}
      style={railStyle}
      testID="sidebar-hidden-rail"
    >
      {({ hovered, pressed }) => (
        <View style={styles.content}>
          <Text style={styles.hidden} numberOfLines={1}>
            {hidden}
          </Text>
          <Text style={styles.separator}>·</Text>
          <Text style={hovered || pressed ? styles.clearHovered : styles.clear} numberOfLines={1}>
            {clear}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function railStyle({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.rail, hovered && !pressed && styles.railHovered, pressed && styles.railPressed];
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    marginHorizontal: theme.spacing[2],
    marginBottom: theme.spacing[1],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    userSelect: "none",
  },
  railHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  railPressed: {
    backgroundColor: theme.colors.surface2,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
  },
  hidden: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    minWidth: 0,
    flexShrink: 1,
  },
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 0,
  },
  // Only the verb brightens under the pointer, the way "Show more" does at the end of a truncated
  // group. The count beside it is what the row reports, not what pressing it will do.
  clear: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 0,
  },
  clearHovered: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    flexShrink: 0,
  },
}));
