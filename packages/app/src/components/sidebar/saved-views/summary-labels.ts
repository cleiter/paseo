import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SIDEBAR_GROUP_MODE_LABEL_KEYS } from "@/components/sidebar/grouping-labels";
import type { SavedViewSummaryLabels } from "./view-state";

/**
 * The words a view's one-line summary is built from, memoised so a row's description is not a new
 * string every render.
 *
 * A module rather than a helper inside the palette, because a view has to describe itself the same
 * way wherever you meet it: the switcher lists views by name where you can watch the sidebar move,
 * and everywhere you choose one blind owes you the same sentence.
 */
export function useSavedViewSummaryLabels(): SavedViewSummaryLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      includes: (names) => t("sidebar.display.views.summary.includes", { names }),
      includesAll: (names) => t("sidebar.display.views.summary.includesAll", { names }),
      excludes: (names) => t("sidebar.display.views.summary.excludes", { names }),
      projects: (count) => t("sidebar.display.views.summary.projects", { count }),
      hosts: (count) => t("sidebar.display.views.summary.hosts", { count }),
      grouping: (mode) =>
        t("sidebar.display.views.summary.grouping", {
          mode: t(SIDEBAR_GROUP_MODE_LABEL_KEYS[mode]),
        }),
      everything: t("sidebar.display.views.summary.everything"),
    }),
    [t],
  );
}
