import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { withUnistyles } from "react-native-unistyles";
import { Plus, Settings2, Tag } from "lucide-react-native";
import { hasWorkspaceLabel } from "@getpaseo/protocol/workspace-labels";
import {
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { useWorkspaceLabelColors } from "@/stores/workspace-label-catalog-store";
import type { Theme } from "@/styles/theme";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import type { WorkspaceLabelColors } from "./catalog";
import { promptForNewWorkspaceLabel } from "./dialog-store";
import { WorkspaceLabelSwatch } from "./label-chip";
import {
  parseWorkspaceKey,
  useOfferedWorkspaceLabels,
  useToggleWorkspaceLabel,
  useWorkspaceLabels,
} from "./model";

/** The id the surface's page list and the row that opens it agree on. */
export const WORKSPACE_LABELS_MENU_PAGE_ID = "workspaceLabels";

const OPTION_ICON_SIZE = 14;

const ThemedTag = withUnistyles(Tag);
const ThemedPlus = withUnistyles(Plus);
const ThemedSettings2 = withUnistyles(Settings2);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const tagLeadingIcon = <ThemedTag size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />;
const newLabelLeadingIcon = <ThemedPlus size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />;
const editLabelsLeadingIcon = (
  <ThemedSettings2 size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />
);

/**
 * The row in a workspace's menu that opens its labels.
 *
 * It carries no value even though it has one, because the value is a list: two labels already
 * overflow the row, and a truncated one reads as a second line of label rather than an answer.
 * The chips on the workspace row are where you read which labels it carries.
 */
export function WorkspaceLabelsSubTrigger({
  workspaceKey,
}: {
  workspaceKey: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <MenuSubTrigger
      id={WORKSPACE_LABELS_MENU_PAGE_ID}
      leading={tagLeadingIcon}
      testID={`sidebar-workspace-menu-labels-${workspaceKey}`}
    >
      {t("sidebar.workspace.labels.menu")}
    </MenuSubTrigger>
  );
}

/**
 * Multi-select, so selecting a label leaves the page open: labelling is something you do two or
 * three at a time, and a menu that closed after each one would make the second label cost as much
 * as the first.
 *
 * The list is what was offered when the page opened plus anything added since — never less. An
 * uncoloured label exists only through the workspaces carrying it, so taking it off the last one
 * un-knows it, and the row would leave the menu mid-press with the row below sliding under the
 * pointer. See `useOfferedWorkspaceLabels`.
 *
 * The two verbs at the bottom both leave: one opens the dialog that names and colours a new label,
 * the other goes to the settings page that owns all of them. Before any label exists they are the
 * whole page, and the separator above them goes with the list it was separating.
 */
export function WorkspaceLabelsMenuPage({ workspaceKey }: { workspaceKey: string }): ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const target = useMemo(() => parseWorkspaceKey(workspaceKey), [workspaceKey]);
  const labels = useWorkspaceLabels(target);
  const offered = useOfferedWorkspaceLabels();
  const colors = useWorkspaceLabelColors();

  const handleError = useCallback(
    (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("sidebar.workspace.labels.failed"));
    },
    [t, toast],
  );
  const toggle = useToggleWorkspaceLabel({
    target,
    hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
    onError: handleError,
  });
  const handleNewLabel = useCallback(() => {
    if (target) promptForNewWorkspaceLabel(target);
  }, [target]);
  const handleEditLabels = useCallback(() => {
    router.push(buildSettingsSectionRoute("labels"));
  }, [router]);

  return (
    <>
      {offered.map((label) => (
        <WorkspaceLabelMenuItem
          key={label.toLowerCase()}
          label={label}
          colors={colors}
          selected={hasWorkspaceLabel(labels, label)}
          onToggle={toggle}
        />
      ))}
      {/* Nothing above it before the first label exists, and a rule with nothing on one side of it
          reads as a section that failed to load. */}
      {offered.length > 0 ? <MenuSeparator /> : null}
      <MenuItem
        leading={newLabelLeadingIcon}
        onSelect={handleNewLabel}
        testID="workspace-label-new"
      >
        {t("sidebar.workspace.labels.newLabel")}
      </MenuItem>
      <MenuItem
        leading={editLabelsLeadingIcon}
        onSelect={handleEditLabels}
        testID="workspace-label-edit-labels"
      >
        {t("sidebar.workspace.labels.editLabels")}
      </MenuItem>
    </>
  );
}

function WorkspaceLabelMenuItem({
  label,
  colors,
  selected,
  onToggle,
}: {
  label: string;
  colors: WorkspaceLabelColors;
  selected: boolean;
  onToggle: (label: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onToggle(label), [label, onToggle]);
  // The colour goes beside the name rather than on it: a coloured name in a list of names reads as
  // a state — disabled, selected, failing — and this palette is identity, not status.
  const leading = useMemo(
    () => <WorkspaceLabelSwatch name={label} colors={colors} />,
    [colors, label],
  );
  return (
    <MenuItem
      selected={selected}
      closeOnSelect={false}
      leading={leading}
      onSelect={handleSelect}
      testID={`workspace-label-${label.toLowerCase()}`}
    >
      {label}
    </MenuItem>
  );
}

export function workspaceLabelsMenuPage(input: {
  workspaceKey: string;
  title: string;
}): MenuPageDefinition {
  return {
    id: WORKSPACE_LABELS_MENU_PAGE_ID,
    title: input.title,
    content: <WorkspaceLabelsMenuPage workspaceKey={input.workspaceKey} />,
  };
}
