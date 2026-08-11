import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Pencil, Save } from "lucide-react-native";
import { useHasSidebarFilters } from "@/components/sidebar/saved-views/model";
import {
  promptToEditSidebarView,
  promptToSaveSidebarView,
} from "@/components/sidebar/saved-views/prompt-store";
import { useSavedViewSummaryLabels } from "@/components/sidebar/saved-views/summary-labels";
import {
  resolveActiveSavedView,
  summarizeSavedView,
} from "@/components/sidebar/saved-views/view-state";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { getCommandCenterIcon } from "./icon";
import { useCommandCenterActions } from "./provider";
import {
  buildSavedViewContributions,
  type SavedViewCommandCenterView,
} from "./saved-view-contributions";

const SAVED_VIEW_ICONS = {
  view: getCommandCenterIcon(Bookmark),
  save: getCommandCenterIcon(Bookmark),
  update: getCommandCenterIcon(Save),
  edit: getCommandCenterIcon(Pencil),
};

/**
 * The saved views in the palette.
 *
 * The switcher in the sidebar header is where views live, so this is not the only way to reach one.
 * It is the fastest — typing a name beats reading a list — and it is the only way at all when the
 * sidebar is hidden.
 */
export function CommandCenterSavedViewActions() {
  const { t } = useTranslation();
  const summaryLabels = useSavedViewSummaryLabels();
  const savedViews = useSidebarViewStore((state) => state.savedViews);
  const activeSavedViewId = useSidebarViewStore((state) => state.activeSavedViewId);
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const labelFilters = useSidebarViewStore((state) => state.labelFilters);
  const labelMatch = useSidebarViewStore((state) => state.labelMatch);
  const applySavedSidebarView = useSidebarViewStore((state) => state.applySavedSidebarView);
  const updateSavedSidebarView = useSidebarViewStore((state) => state.updateSavedSidebarView);
  const canSave = useHasSidebarFilters();

  const resolved = useMemo(
    () =>
      resolveActiveSavedView({
        savedViews,
        activeSavedViewId,
        current: { groupMode, hostFilters, projectFilters, labelFilters, labelMatch },
      }),
    [
      activeSavedViewId,
      groupMode,
      hostFilters,
      labelFilters,
      labelMatch,
      projectFilters,
      savedViews,
    ],
  );

  const views = useMemo<SavedViewCommandCenterView[]>(
    () =>
      savedViews.map((view) => ({
        id: view.id,
        name: view.name,
        summary: summarizeSavedView(view, summaryLabels),
      })),
    [savedViews, summaryLabels],
  );

  // Both open a dialog, and a dialog that opens while the palette is still holding focus takes it
  // back the moment the palette closes — the same restore the workspace commands clear.
  const openSave = useCallback(() => {
    clearCommandCenterFocusRestoreElement();
    promptToSaveSidebarView();
  }, []);
  const openEditor = useCallback((id: string) => {
    clearCommandCenterFocusRestoreElement();
    promptToEditSidebarView(id);
  }, []);

  const actions = useMemo(
    () =>
      buildSavedViewContributions({
        views,
        active: resolved
          ? { id: resolved.view.id, name: resolved.view.name, edited: resolved.edited }
          : null,
        // Drifted from the view you are in is something to save even with the filters cleared.
        canSave: canSave || (resolved?.edited ?? false),
        labels: {
          section: t("sidebar.display.views.label"),
          show: (name) => t("sidebar.display.views.showNamed", { name }),
          // "as new" only next to an Update that could be mistaken for it, same as the menu.
          save: t(resolved ? "sidebar.display.views.saveAsNew" : "sidebar.display.views.save"),
          update: (name) => t("sidebar.display.views.update", { name }),
          edit: (name) => t("sidebar.display.views.editNamed", { name }),
          keywords: [t("shell.commandCenter.viewSearchKeywords")],
        },
        icons: SAVED_VIEW_ICONS,
        apply: applySavedSidebarView,
        save: openSave,
        update: updateSavedSidebarView,
        edit: openEditor,
      }),
    [
      applySavedSidebarView,
      canSave,
      openEditor,
      openSave,
      resolved,
      t,
      updateSavedSidebarView,
      views,
    ],
  );

  useCommandCenterActions({ sourceId: "saved-views", enabled: true, actions });
  return null;
}
