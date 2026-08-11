import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type TextInput,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { ProjectIconView } from "@/components/project-icon-view";
import { HostStatusDot } from "@/components/host-status-dot";
import {
  WorkspaceLabelExcludedMark,
  WorkspaceLabelSwatch,
} from "@/components/sidebar/workspace-labels/label-chip";
import { useKnownWorkspaceLabels } from "@/components/sidebar/workspace-labels/model";
import { WorkspaceLabelMatchPill } from "@/components/sidebar/workspace-labels/match-pill";
import type { LabelMatchMode } from "@/components/sidebar/sidebar-filter";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import {
  SIDEBAR_GROUP_MODES,
  SIDEBAR_GROUP_MODE_LABEL_KEYS,
} from "@/components/sidebar/grouping-labels";
import { useProjectIcons } from "@/projects/icons";
import { projectIconInitialFromDisplayName } from "@/utils/project-display-name";
import { resolveSidebarProjectIconTargets } from "@/utils/sidebar-project-row-model";
import { useHosts } from "@/runtime/host-runtime";
import { useWorkspaceLabelColors } from "@/stores/workspace-label-catalog-store";
import {
  useSidebarViewStore,
  type SavedSidebarView,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { createSavedViewId, MAX_SAVED_VIEW_NAME_LENGTH } from "./model";
import { useSavedViewPromptStore } from "./prompt-store";
import {
  cycleDraftLabel,
  draftFromSavedView,
  planSavedViewEdit,
  toggleDraftEntry,
  type SavedViewDraft,
} from "./view-editor";

const CHIP_ICON_SIZE = 12;

/**
 * What a saved view holds, laid out so you can change it without going and rebuilding it in the
 * sidebar first.
 *
 * The other way to change a view — apply it, move the filters, press Update — only reaches the view
 * you are currently in, and only tells you what it will do by doing it. This one edits any view,
 * including one whose filters would hide everything you are looking at.
 *
 * Saving a new view opens the same dialog rather than a box asking only for a name. Naming is the
 * one part of a view you cannot see in the sidebar behind the dialog, and it was the only part the
 * old prompt let you set: everything else was whatever the filters happened to be at the moment
 * you pressed the row, adjustable only by saving, closing, and reopening the editor. Seeded from
 * those filters, so pressing Save without touching anything still saves what you are looking at.
 *
 * Mounted once at the app root; see `prompt-store.ts` for why it opens through a store.
 */
export function SavedViewEditorHost(): ReactElement | null {
  const creating = useSavedViewPromptStore((state) => state.creating);
  const viewId = useSavedViewPromptStore((state) => state.editingViewId);
  const close = useSavedViewPromptStore((state) => state.close);
  const view = useSidebarViewStore((state) =>
    state.savedViews.find((entry) => entry.id === viewId),
  );
  if (creating) return <SavedViewCreator onClose={close} />;
  // Keyed by id so the draft is seeded once per view rather than reset by every store write while
  // the dialog is open — deleting the view from another surface closes it instead.
  if (!view) return null;
  return <SavedViewEditorForView key={view.id} view={view} onClose={close} />;
}

/** The arrangement you are in, named. The id is minted once so the name check can exclude it. */
function SavedViewCreator({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation();
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const labelFilters = useSidebarViewStore((state) => state.labelFilters);
  const labelMatch = useSidebarViewStore((state) => state.labelMatch);
  const createSavedSidebarView = useSidebarViewStore((state) => state.createSavedSidebarView);
  const [viewId] = useState(createSavedViewId);

  // Seeded once, not tracked: the dialog holds the draft from here on, and a filter moving
  // underneath it must not overwrite what has been typed.
  const [initialDraft] = useState<SavedViewDraft>(() => ({
    name: "",
    groupMode,
    hostFilters,
    projectFilters,
    labelFilters,
    labelMatch,
  }));
  const handleSubmit = useCallback(
    (edit: Omit<SavedSidebarView, "id">) => createSavedSidebarView({ ...edit, id: viewId }),
    [createSavedSidebarView, viewId],
  );

  return (
    <SavedViewEditor
      viewId={viewId}
      initialDraft={initialDraft}
      title={t("sidebar.display.views.saveTitle")}
      onSubmit={handleSubmit}
      onClose={onClose}
    />
  );
}

function SavedViewEditorForView({
  view,
  onClose,
}: {
  view: SavedSidebarView;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const editSavedSidebarView = useSidebarViewStore((state) => state.editSavedSidebarView);
  const initialDraft = useMemo(() => draftFromSavedView(view), [view]);
  const handleSubmit = useCallback(
    (edit: Omit<SavedSidebarView, "id">) => editSavedSidebarView(view.id, edit),
    [editSavedSidebarView, view.id],
  );

  return (
    <SavedViewEditor
      viewId={view.id}
      initialDraft={initialDraft}
      title={t("sidebar.display.views.editTitle")}
      onSubmit={handleSubmit}
      onClose={onClose}
    />
  );
}

function SavedViewEditor({
  viewId,
  initialDraft,
  title,
  onSubmit,
  onClose,
}: {
  viewId: string;
  initialDraft: SavedViewDraft;
  title: string;
  onSubmit: (edit: Omit<SavedSidebarView, "id">) => void;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const savedViews = useSidebarViewStore((state) => state.savedViews);
  const nameInputRef = useRef<TextInput>(null);

  const [draft, setDraft] = useState<SavedViewDraft>(initialDraft);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => clearTimeout(timeout);
  }, []);

  const handleNameChange = useCallback((name: string) => {
    setDraft((current) => ({ ...current, name }));
    setNameError(null);
  }, []);

  const handleGroupMode = useCallback((groupMode: SidebarGroupMode | null) => {
    setDraft((current) => ({ ...current, groupMode }));
  }, []);

  const handleToggleHost = useCallback((serverId: string) => {
    setDraft((current) => ({
      ...current,
      hostFilters: toggleDraftEntry(current.hostFilters, serverId),
    }));
  }, []);

  const handleToggleProject = useCallback((viewKey: string) => {
    setDraft((current) => ({
      ...current,
      projectFilters: toggleDraftEntry(current.projectFilters, viewKey),
    }));
  }, []);

  const handleSetLabelMatch = useCallback((mode: LabelMatchMode) => {
    setDraft((current) => ({ ...current, labelMatch: mode }));
  }, []);

  const handleCycleLabel = useCallback((label: string) => {
    setDraft((current) => ({
      ...current,
      labelFilters: cycleDraftLabel(current.labelFilters, label),
    }));
  }, []);

  const handleSave = useCallback(() => {
    const plan = planSavedViewEdit({ viewId, draft, existing: savedViews });
    if (!plan.ok) {
      setNameError(
        t(
          plan.problem === "nameTaken"
            ? "sidebar.display.views.errors.duplicate"
            : "sidebar.display.views.errors.empty",
        ),
      );
      return;
    }
    onSubmit(plan.edit);
    onClose();
  }, [draft, onClose, onSubmit, savedViews, t, viewId]);

  const sheetHeader = useMemo<SheetHeader>(() => ({ title }), [title]);

  return (
    <AdaptiveModalSheet
      visible
      header={sheetHeader}
      onClose={onClose}
      desktopMaxWidth={460}
      testID="sidebar-saved-view-editor"
    >
      <View style={styles.body}>
        <Field
          label={t("sidebar.display.views.nameLabel")}
          error={nameError}
          testID="sidebar-saved-view-name-field"
        >
          <FormTextInput
            ref={nameInputRef}
            initialValue={initialDraft.name}
            resetKey={viewId}
            onChangeText={handleNameChange}
            placeholder={t("sidebar.display.views.placeholder")}
            maxLength={MAX_SAVED_VIEW_NAME_LENGTH}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSave}
            accessibilityLabel={t("sidebar.display.views.nameLabel")}
            testID="sidebar-saved-view-name-input"
          />
        </Field>

        <LabelsField
          labelFilters={draft.labelFilters}
          labelMatch={draft.labelMatch}
          onCycle={handleCycleLabel}
          onSetMatch={handleSetLabelMatch}
        />
        <ProjectsField selected={draft.projectFilters} onToggle={handleToggleProject} />
        <HostsField selected={draft.hostFilters} onToggle={handleToggleHost} />

        <Field label={t("sidebar.display.grouping.label")} testID="sidebar-saved-view-grouping">
          <View style={styles.chips}>
            {/* First, because it is the option that changes nothing. */}
            <GroupModeChip
              mode={null}
              selected={draft.groupMode === null}
              onSelect={handleGroupMode}
            />
            {SIDEBAR_GROUP_MODES.map((mode) => (
              <GroupModeChip
                key={mode}
                mode={mode}
                selected={draft.groupMode === mode}
                onSelect={handleGroupMode}
              />
            ))}
          </View>
        </Field>

        <View style={styles.actions}>
          <Button
            variant="secondary"
            style={styles.actionButton}
            onPress={onClose}
            testID="sidebar-saved-view-editor-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            style={styles.actionButton}
            onPress={handleSave}
            testID="sidebar-saved-view-editor-save"
          >
            {t("sidebar.display.views.submit")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

/**
 * The labels, tri-state: neutral, "only these", "never these" — the same three the chip track and
 * the filter menu cycle, and the same marks, so a label excluded here looks excluded there.
 */
function LabelsField({
  labelFilters,
  labelMatch,
  onCycle,
  onSetMatch,
}: {
  labelFilters: SavedViewDraft["labelFilters"];
  labelMatch: SavedViewDraft["labelMatch"];
  onCycle: (label: string) => void;
  onSetMatch: (mode: LabelMatchMode) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const labels = useKnownWorkspaceLabels();
  const colors = useWorkspaceLabelColors();
  if (labels.length === 0) return null;
  const empty = Object.keys(labelFilters).length === 0;
  return (
    <Field
      label={t("sidebar.display.labelFilter.label")}
      hint={empty ? t("sidebar.display.labelFilter.all") : undefined}
      testID="sidebar-saved-view-labels"
    >
      <View style={styles.chips}>
        {labels.map((label) => (
          <LabelChip
            key={label.toLowerCase()}
            label={label}
            mode={labelFilters[label.toLowerCase()]}
            colors={colors}
            onCycle={onCycle}
          />
        ))}
        {/* Last, for the reason it is last on the track: it appears with the second lit label, and
            from the front that would move every chip you have just been pressing. */}
        <WorkspaceLabelMatchPill
          labelFilters={labelFilters}
          labelMatch={labelMatch}
          onToggle={onSetMatch}
          testID="sidebar-saved-view-label-match"
        />
      </View>
    </Field>
  );
}

function LabelChip({
  label,
  mode,
  colors,
  onCycle,
}: {
  label: string;
  mode: SavedViewDraft["labelFilters"][string] | undefined;
  colors: ReturnType<typeof useWorkspaceLabelColors>;
  onCycle: (label: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onCycle(label), [label, onCycle]);
  const excluded = mode === "exclude";
  const leading = useMemo(
    () =>
      excluded ? (
        <WorkspaceLabelExcludedMark name={label} colors={colors} size={CHIP_ICON_SIZE} />
      ) : (
        <WorkspaceLabelSwatch name={label} colors={colors} />
      ),
    [colors, excluded, label],
  );
  return (
    <SelectableChip
      label={label}
      leading={leading}
      selected={mode !== undefined}
      strikethrough={excluded}
      onPress={handlePress}
      testID={`sidebar-saved-view-label-${label.toLowerCase()}`}
    />
  );
}

/** Projects the view narrows to. No third state — a workspace is in exactly one project. */
function ProjectsField({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (viewKey: string) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const { projects } = useSidebarModel();
  const iconTargets = useMemo(() => resolveSidebarProjectIconTargets(projects), [projects]);
  const icons = useProjectIcons({ projects: iconTargets });
  if (projects.length < 2) return null;
  return (
    <Field
      label={t("sidebar.display.projectFilter.label")}
      hint={selected.length === 0 ? t("sidebar.display.projectFilter.all") : undefined}
      testID="sidebar-saved-view-projects"
    >
      <View style={styles.chips}>
        {projects.map((project) => (
          <ProjectChip
            key={project.viewKey}
            viewKey={project.viewKey}
            label={project.projectName}
            iconDataUri={icons.get(project.viewKey) ?? null}
            selected={selected.includes(project.viewKey)}
            onToggle={onToggle}
          />
        ))}
      </View>
    </Field>
  );
}

function ProjectChip({
  viewKey,
  label,
  iconDataUri,
  selected,
  onToggle,
}: {
  viewKey: string;
  label: string;
  iconDataUri: string | null;
  selected: boolean;
  onToggle: (viewKey: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(viewKey), [onToggle, viewKey]);
  const leading = useMemo(
    () => (
      <ProjectIconView
        iconDataUri={iconDataUri}
        initial={projectIconInitialFromDisplayName(label)}
        projectViewKey={viewKey}
        size={CHIP_ICON_SIZE}
        textStyle={styles.projectIconText}
      />
    ),
    [iconDataUri, label, viewKey],
  );
  return (
    <SelectableChip
      label={label}
      leading={leading}
      selected={selected}
      onPress={handlePress}
      testID={`sidebar-saved-view-project-${viewKey}`}
    />
  );
}

/** Hosts the view narrows to. Hidden on a single-host setup, where the answer is always "this one". */
function HostsField({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (serverId: string) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const hosts = useHosts();
  if (hosts.length < 2) return null;
  return (
    <Field
      label={t("sidebar.display.hostFilter.label")}
      hint={selected.length === 0 ? t("sidebar.display.hostFilter.all") : undefined}
      testID="sidebar-saved-view-hosts"
    >
      <View style={styles.chips}>
        {hosts.map((host) => (
          <HostChip
            key={host.serverId}
            serverId={host.serverId}
            label={host.label?.trim() || host.serverId}
            selected={selected.includes(host.serverId)}
            onToggle={onToggle}
          />
        ))}
      </View>
    </Field>
  );
}

function HostChip({
  serverId,
  label,
  selected,
  onToggle,
}: {
  serverId: string;
  label: string;
  selected: boolean;
  onToggle: (serverId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(serverId), [onToggle, serverId]);
  const leading = useMemo(() => <HostStatusDot serverId={serverId} />, [serverId]);
  return (
    <SelectableChip
      label={label}
      leading={leading}
      selected={selected}
      onPress={handlePress}
      testID={`sidebar-saved-view-host-${serverId}`}
    />
  );
}

function GroupModeChip({
  mode,
  selected,
  onSelect,
}: {
  mode: SidebarGroupMode | null;
  selected: boolean;
  onSelect: (mode: SidebarGroupMode | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(mode), [mode, onSelect]);
  return (
    <SelectableChip
      label={
        mode === null
          ? t("sidebar.display.views.groupingUnchanged")
          : t(SIDEBAR_GROUP_MODE_LABEL_KEYS[mode])
      }
      selected={selected}
      onPress={handlePress}
      testID={`sidebar-saved-view-grouping-${mode ?? "keep"}`}
    />
  );
}

/**
 * One choice, on or off.
 *
 * Chips rather than a column of rows: five facets as lists is a dialog you scroll to read, and
 * these are short names that wrap into two lines apiece.
 */
function SelectableChip({
  label,
  leading,
  selected,
  strikethrough = false,
  onPress,
  testID,
}: {
  label: string;
  leading?: ReactElement;
  selected: boolean;
  strikethrough?: boolean;
  onPress: () => void;
  testID: string;
}): ReactElement {
  const style = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.chip,
      selected && styles.chipSelected,
      hovered && !pressed && styles.chipHovered,
      pressed && styles.chipPressed,
    ],
    [selected],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      style={style}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID={testID}
    >
      {leading ?? null}
      <Text
        numberOfLines={1}
        style={[
          styles.chipText,
          selected && styles.chipTextSelected,
          strikethrough && styles.chipTextExcluded,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 26,
    maxWidth: "100%",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  chipSelected: {
    borderColor: theme.colors.foreground,
  },
  chipHovered: {
    opacity: 0.82,
  },
  chipPressed: {
    opacity: 0.65,
  },
  chipText: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  chipTextSelected: {
    color: theme.colors.foreground,
  },
  chipTextExcluded: {
    textDecorationLine: "line-through",
  },
  projectIconText: {
    fontSize: 8,
    lineHeight: 10,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
