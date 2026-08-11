import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Pencil, Plus, Trash2 } from "lucide-react-native";
import { workspaceLabelColor } from "@/components/sidebar/workspace-labels/catalog";
import {
  deleteWorkspaceLabelEverywhere,
  type WorkspaceLabelCatalogWriteVerdict,
} from "@/components/sidebar/workspace-labels/catalog-writes";
import {
  promptToCreateWorkspaceLabel,
  promptToEditWorkspaceLabel,
} from "@/components/sidebar/workspace-labels/dialog-store";
import { workspaceLabelSwatchFill } from "@/components/sidebar/workspace-labels/label-chip";
import {
  useKnownWorkspaceLabels,
  useWorkspaceLabelCatalogWriteDeps,
  useWorkspaceLabelUsageCounts,
} from "@/components/sidebar/workspace-labels/model";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useWorkspaceLabelColors } from "@/stores/workspace-label-catalog-store";
import type { WorkspaceLabelColors } from "@/components/sidebar/workspace-labels/catalog";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedPlus = withUnistyles(Plus);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const editIcon = <ThemedPencil size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const deleteIcon = <ThemedTrash2 size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

/**
 * Every label there is, with its colour and how much of the sidebar it accounts for.
 *
 * Labels live in app settings rather than under a host even though the daemons store them, because
 * there is one merged list: a label means the same thing on every machine you have connected, and
 * a catalog write fans out to all of them. A host-scoped page would either show a list that
 * disagrees with itself or carry a host breadcrumb that changes nothing.
 */
export function LabelsSection() {
  const { t } = useTranslation();
  const labels = useKnownWorkspaceLabels();
  const colors = useWorkspaceLabelColors();
  const counts = useWorkspaceLabelUsageCounts();

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={addIcon}
        onPress={promptToCreateWorkspaceLabel}
        accessibilityLabel={t("settings.labels.add")}
        testID="workspace-labels-add-button"
      />
    ),
    [t],
  );

  return (
    <SettingsSection
      title={t("settings.labels.sectionTitle")}
      trailing={addButton}
      testID="workspace-labels-section"
    >
      <View style={settingsStyles.card} testID="workspace-labels-card">
        {labels.length > 0 ? (
          labels.map((label, index) => (
            <LabelRow
              key={label.toLowerCase()}
              label={label}
              colors={colors}
              usage={counts.get(label.toLowerCase()) ?? 0}
              isFirst={index === 0}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText} testID="workspace-labels-empty">
              {t("settings.labels.empty")}
            </Text>
          </View>
        )}
      </View>
    </SettingsSection>
  );
}

function LabelRow({
  label,
  colors,
  usage,
  isFirst,
}: {
  label: string;
  colors: WorkspaceLabelColors;
  usage: number;
  isFirst: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const deps = useWorkspaceLabelCatalogWriteDeps();
  const forgetLabelFilter = useSidebarViewStore((state) => state.forgetLabelFilter);

  const handleEdit = useCallback(() => promptToEditWorkspaceLabel(label), [label]);

  const report = useCallback(
    (verdict: WorkspaceLabelCatalogWriteVerdict) => {
      if (verdict.status === "ok") return;
      if (verdict.status === "noHost") {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }
      if (verdict.status === "partial") {
        toast.error(t("settings.labels.partial", { failed: verdict.failed, total: verdict.total }));
        return;
      }
      toast.error(verdict.error || t("settings.labels.failed"));
    },
    [t, toast],
  );

  // Deleting strips the label off every workspace on every host, and nothing in the app puts it
  // back. The one place in this feature that earns a confirm.
  const handleDelete = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("settings.labels.deleteTitle"),
        message: t("settings.labels.deleteMessage", { label }),
        confirmLabel: t("settings.labels.deleteConfirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      const verdict = await deleteWorkspaceLabelEverywhere(deps, { name: label });
      // Only once it is gone everywhere. A host that rejected the delete still carries the label,
      // so a filter naming it still selects something.
      if (verdict.status === "ok") forgetLabelFilter(label);
      report(verdict);
    })();
  }, [deps, forgetLabelFilter, label, report, t]);

  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && settingsStyles.rowBorder, styles.row],
    [isFirst],
  );
  const swatchStyle = useMemo(
    () => [styles.swatch, workspaceLabelSwatchFill(workspaceLabelColor(colors, label))],
    [colors, label],
  );

  const usageText = t(usageKey(usage), { count: usage });

  return (
    <View style={rowStyle} testID={`workspace-label-row-${label.toLowerCase()}`}>
      <View style={styles.swatchWrapper}>
        <View style={swatchStyle} />
      </View>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {usageText}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={editIcon}
          onPress={handleEdit}
          accessibilityLabel={t("settings.labels.edit", { label })}
          testID={`workspace-label-edit-${label.toLowerCase()}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={deleteIcon}
          onPress={handleDelete}
          accessibilityLabel={t("settings.labels.delete", { label })}
          testID={`workspace-label-delete-${label.toLowerCase()}`}
        />
      </View>
    </View>
  );
}

/** i18next plural rules differ per locale; three explicit keys keep every locale's wording its own. */
function usageKey(usage: number): string {
  if (usage === 0) return "settings.labels.usageNone";
  return usage === 1 ? "settings.labels.usageOne" : "settings.labels.usageMany";
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
    minHeight: 56,
  },
  swatchWrapper: {
    width: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: theme.borderRadius.sm,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
