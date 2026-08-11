import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bookmark, ChevronDown, Pencil, Save, Trash2 } from "lucide-react-native";
import { MenuItem, MenuRoot, MenuSeparator, MenuSurface, MenuTrigger } from "@/components/ui/menu";
import { useHasSidebarFilters } from "@/components/sidebar/saved-views/model";
import { describeSidebarViewSwitcher } from "@/components/sidebar/saved-views/view-state";
import {
  promptToEditSidebarView,
  promptToSaveSidebarView,
} from "@/components/sidebar/saved-views/prompt-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedChevronDown = withUnistyles(ChevronDown);
/** Writing the sidebar back over the view you are in. */
const ThemedSave = withUnistyles(Save);
/** Saving, editing, and deleting a view — the three verbs beside the list. */
const ThemedBookmark = withUnistyles(Bookmark);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);

const TRIGGER_ICON_SIZE = 12;
/** Fits the item's 16pt leading slot with a hair of room, matching the trailing check. */
const ITEM_ICON_SIZE = 14;
const MENU_WIDTH = 232;

// Built once: these carry no props from the rows they sit in, and `withUnistyles` reads the theme
// when it renders rather than when the element is created, so hoisting them is safe.
const UPDATE_LEADING = <ThemedSave size={ITEM_ICON_SIZE} uniProps={mutedIconMapping} />;
const SAVE_LEADING = <ThemedBookmark size={ITEM_ICON_SIZE} uniProps={mutedIconMapping} />;
const EDIT_LEADING = <ThemedPencil size={ITEM_ICON_SIZE} uniProps={mutedIconMapping} />;
const DELETE_LEADING = <ThemedTrash2 size={ITEM_ICON_SIZE} uniProps={mutedIconMapping} />;

/**
 * The Workspaces heading, which is also the view you are in and everything you can do about it.
 *
 * Views were reachable only from the display menu, two levels down, which is fine for making one
 * and wrong for living in them: switching cost three presses and nothing on screen said which view
 * you were in, so a narrowed sidebar looked the same as a quiet one.
 *
 * It is the heading rather than a control beside it because a view renames the list. "Workspaces"
 * over a list showing eleven of forty is a heading that is wrong; "Review" over the same list is
 * the truth, and a second control saying it would leave the heading still lying next to it.
 *
 * Every verb lives here rather than being split with the display menu, because a feature with two
 * homes has no home — you would switch views in one place and update them in another. The display
 * menu keeps what it is for: what a row shows and how the list is arranged.
 *
 * With no view and no filter there is nothing to offer, so it is the plain heading it has always
 * been — no chevron, nothing to press.
 */
export function SidebarViewSwitcher(): ReactElement {
  const { t } = useTranslation();
  const savedViews = useSidebarViewStore((state) => state.savedViews);
  const activeSavedViewId = useSidebarViewStore((state) => state.activeSavedViewId);
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const labelFilters = useSidebarViewStore((state) => state.labelFilters);
  const labelMatch = useSidebarViewStore((state) => state.labelMatch);
  const applySavedView = useSidebarViewStore((state) => state.applySavedSidebarView);
  const updateSavedView = useSidebarViewStore((state) => state.updateSavedSidebarView);
  const deleteSavedView = useSidebarViewStore((state) => state.deleteSavedSidebarView);
  const clearActiveView = useSidebarViewStore((state) => state.clearActiveSidebarView);
  const hasFilters = useHasSidebarFilters();

  const state = useMemo(
    () =>
      describeSidebarViewSwitcher({
        savedViews,
        activeSavedViewId,
        current: { groupMode, hostFilters, projectFilters, labelFilters, labelMatch },
        hasFilters,
      }),
    [
      savedViews,
      activeSavedViewId,
      groupMode,
      hostFilters,
      projectFilters,
      labelFilters,
      labelMatch,
      hasFilters,
    ],
  );

  const triggerStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      (hovered || pressed) && styles.triggerHovered,
    ],
    [],
  );

  const activeView = state.activeView;
  const handleUpdate = useCallback(() => {
    if (activeView) updateSavedView(activeView.id);
  }, [activeView, updateSavedView]);
  const handleEdit = useCallback(() => {
    if (activeView) promptToEditSidebarView(activeView.id);
  }, [activeView]);
  const handleDelete = useCallback(() => {
    if (activeView) deleteSavedView(activeView.id);
  }, [activeView, deleteSavedView]);

  // Three answers, narrowest first: the view you are in, the fact that you are narrowed without
  // having named it, or the whole list under its own name.
  const label =
    activeView?.name ??
    t(hasFilters ? "sidebar.display.views.filtered" : "sidebar.display.views.none");

  if (!state.visible) {
    return (
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    );
  }

  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t(
          state.edited ? "sidebar.display.views.switcherEdited" : "sidebar.display.views.switcher",
          { name: label },
        )}
        testID="sidebar-view-switcher"
      >
        {/* The name gives way before the chevron does: a long view name loses letters rather than
            the mark that says this is a control at all. */}
        <Text style={activeView ? styles.labelActive : styles.label} numberOfLines={1}>
          {label}
        </Text>
        {/* The heading names a view the sidebar has since moved off, and without this it says so
            with no qualification. The dot is the qualification, and Update in the menu below is
            what it sends you to. */}
        {state.edited ? (
          <View style={styles.editedDot} testID="sidebar-view-switcher-edited" />
        ) : null}
        <ThemedChevronDown size={TRIGGER_ICON_SIZE} uniProps={mutedIconMapping} />
      </MenuTrigger>
      <MenuSurface
        align="start"
        width={MENU_WIDTH}
        sheetTitle={t("sidebar.display.views.label")}
        testID="sidebar-view-switcher-content"
      >
        {/* The head of the list rather than a verb after it: with no view applied this is the one
            you are on, so it is checked like a view and sits where a view would. Always drawn —
            a first row that comes and goes shifts every view under the pointer, and with nothing
            to reset it is simply the row already checked. */}
        <MenuItem
          selected={!state.canReset}
          onSelect={clearActiveView}
          testID="sidebar-view-switcher-reset"
        >
          {t("sidebar.display.views.all")}
        </MenuItem>
        {state.views.length > 0 ? <MenuSeparator /> : null}
        {state.views.map((view) => (
          <SwitcherItem
            key={view.id}
            id={view.id}
            name={view.name}
            selected={view.id === activeView?.id}
            onApply={applySavedView}
          />
        ))}
        {/* Which list you are looking at is one group; the verbs that change what a view *is* are
            another. The group above is never empty, so the rule turns only on there being a verb
            below it — two rules in a row is what the alternative looks like. */}
        {state.canSave || activeView ? <MenuSeparator /> : null}
        {/* Update only appears once the sidebar has drifted, so the menu never offers to save what
            is already saved. There is no Discard — applying the view again is the same thing, and
            its row is right there with a check on it. */}
        {activeView && state.edited ? (
          <MenuItem
            leading={UPDATE_LEADING}
            closeOnSelect={false}
            onSelect={handleUpdate}
            testID="sidebar-saved-view-update"
          >
            {t("sidebar.display.views.update", { name: activeView.name })}
          </MenuItem>
        ) : null}
        {/* Says "as new" only where there is something for it to be new beside. On its own it is
            just Save, and naming the alternative to a row that is not there is noise. */}
        {state.canSave ? (
          <MenuItem
            leading={SAVE_LEADING}
            onSelect={promptToSaveSidebarView}
            testID="sidebar-saved-view-save"
          >
            {t(activeView ? "sidebar.display.views.saveAsNew" : "sidebar.display.views.save")}
          </MenuItem>
        ) : null}
        {activeView ? (
          <>
            <MenuItem leading={EDIT_LEADING} onSelect={handleEdit} testID="sidebar-saved-view-edit">
              {t("sidebar.display.views.edit")}
            </MenuItem>
            <MenuItem
              leading={DELETE_LEADING}
              closeOnSelect={false}
              onSelect={handleDelete}
              testID="sidebar-saved-view-delete"
            >
              {t("sidebar.display.views.delete")}
            </MenuItem>
          </>
        ) : null}
      </MenuSurface>
    </MenuRoot>
  );
}

/**
 * A view by name, with a check on the one applied.
 *
 * Closes on select: you came here to switch, and the answer is the sidebar behind the menu.
 *
 * Nothing marks a view the sidebar has moved off. The trigger above carries that, and the Update
 * row says it in words, so a third mark on the list would be the same fact told a third time.
 */
function SwitcherItem({
  id,
  name,
  selected,
  onApply,
}: {
  id: string;
  name: string;
  selected: boolean;
  onApply: (id: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onApply(id), [id, onApply]);
  return (
    <MenuItem selected={selected} onSelect={handleSelect} testID={`sidebar-view-switcher-${id}`}>
      {name}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    // The header's other controls are 28pt squares and set its height; matching them keeps the
    // hover fill the same band as theirs rather than a shorter one floating in the row.
    height: 28,
    flexShrink: 1,
    minWidth: 0,
    paddingHorizontal: theme.spacing[1.5],
    // Pulled back by its own padding so the heading sits on the rail it sat on as plain text, with
    // the hover fill bleeding into the gutter instead of the words moving.
    marginLeft: -theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // The same dot, at the same size and colour, that a display-menu row uses to say a filter is on
  // underneath it — one mark for "there is state in here you cannot see from out here".
  editedDot: {
    width: 6,
    height: 6,
    marginLeft: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 16,
    flexShrink: 1,
    minWidth: 0,
  },
  // A view being applied is the sidebar showing you less than everything, so its name is drawn at
  // full strength — the same reason the hidden rail is permanent while filtering.
  labelActive: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 16,
    flexShrink: 1,
    minWidth: 0,
  },
}));
