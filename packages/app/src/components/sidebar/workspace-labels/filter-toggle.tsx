import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tag } from "lucide-react-native";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { countActiveLabelFilters } from "@/components/sidebar/sidebar-filter";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const ThemedTag = withUnistyles(Tag);

const ICON_SIZE = 14;

/**
 * The switch for the label chip track, in the Workspaces header beside Search.
 *
 * The track used to put itself away under its own heading, the way Pinned does, and a heading is
 * the wrong control for it: put away, it still cost a row of sidebar to say "Labels" and nothing
 * else, permanently, to everyone who had ever made a label. Someone living in saved views has
 * already decided which labels matter and reaches for the chips rarely, so that row is rent.
 *
 * Moving the switch up here makes the closed state free — no heading, no chips, nothing — while
 * keeping the way back one press, in a fixed place, next to the other two controls that decide
 * what the list below shows.
 *
 * The dot is what makes hiding the track safe: the track is the only place the sidebar names the
 * labels narrowing the list, so while it is hidden and filtering, this says so.
 *
 * Like the track, it exists only where there are labels to filter by.
 */
export function SidebarLabelFilterToggle(): ReactElement | null {
  const { t } = useTranslation();
  const { filterableLabels: labels } = useSidebarModel();
  const labelFilters = useSidebarViewStore((state) => state.labelFilters);
  const hidden = useSidebarCollapsedSectionsStore((state) => state.collapsedLabelFilters);
  const toggle = useSidebarCollapsedSectionsStore((state) => state.toggleLabelFiltersCollapsed);

  const buttonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (hovered || pressed) && styles.buttonHovered,
    ],
    [],
  );

  const accessibilityState = useMemo(() => ({ expanded: !hidden }), [hidden]);

  const activeCount = countActiveLabelFilters(labels, labelFilters);
  const label =
    activeCount > 0
      ? t("sidebar.labelTrack.accessibility.filtered", { count: activeCount })
      : t("sidebar.labelTrack.title");

  if (labels.length === 0) return null;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={label}
          accessibilityState={accessibilityState}
          style={buttonStyle}
          onPress={toggle}
          testID="sidebar-label-filter-toggle"
        >
          {({ hovered = false, pressed }) => (
            <>
              {/* Open, the mark is at full strength: the chips below are its doing, and a muted
                  icon over a track that is visibly on reads as a second, disagreeing switch. */}
              <ThemedTag
                size={ICON_SIZE}
                uniProps={hovered || pressed || !hidden ? foregroundIconMapping : mutedIconMapping}
              />
              {hidden && activeCount > 0 ? (
                <View style={styles.indicator} testID="sidebar-label-filter-toggle-indicator" />
              ) : null}
            </>
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // The same dot the display menu puts on a filter row, in the corner of the square rather than
  // beside a label, because there is no room beside a 14pt icon for anything else.
  indicator: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
