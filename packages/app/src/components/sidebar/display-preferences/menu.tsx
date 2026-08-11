import { useCallback, useMemo, type ComponentType, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, type PressableStateCallbackType } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Captions,
  CircleCheck,
  CircleDashed,
  Clock,
  Diff,
  EyeOff,
  Folder,
  GitBranch,
  GitPullRequest,
  Globe,
  Layers,
  Plus,
  Server,
  Settings2,
  Tag,
  Type,
} from "lucide-react-native";
import {
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuSubTrigger,
  MenuSurface,
  MenuTrigger,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { HostStatusDot } from "@/components/host-status-dot";
import { ProjectIconView } from "@/components/project-icon-view";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useProjectIcons } from "@/projects/icons";
import { projectIconInitialFromDisplayName } from "@/utils/project-display-name";
import { resolveSidebarProjectIconTargets } from "@/utils/sidebar-project-row-model";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  WorkspaceLabelExcludedMark,
  WorkspaceLabelSwatch,
} from "@/components/sidebar/workspace-labels/label-chip";
import { promptToCreateWorkspaceLabel } from "@/components/sidebar/workspace-labels/dialog-store";
import type { WorkspaceLabelColors } from "@/components/sidebar/workspace-labels/catalog";
import {
  SIDEBAR_GROUP_MODES,
  SIDEBAR_GROUP_MODE_LABEL_KEYS,
} from "@/components/sidebar/grouping-labels";
import { useWorkspaceLabelColors } from "@/stores/workspace-label-catalog-store";
import { isWeb } from "@/constants/platform";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";
import { SIDEBAR_CHECKS_DISPLAYS, type SidebarChecksDisplay } from "./checks-display";
import { useSidebarDisplayPreferences, type SidebarTrailingChoice } from "./model";
import { SIDEBAR_ROW_ITEMS, type SidebarRowItem } from "./row-items";
import type { LabelFilterMode } from "@/components/sidebar/sidebar-filter";

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedSettings2 = withUnistyles(Settings2);
/** CI's mark: the subject of the checks row, and the shape the icon-only option leaves behind. */
const ThemedCircleCheck = withUnistyles(CircleCheck);
/** Two lit labels read as either-of or all-of — see `LabelMatchMode`. */
const ThemedLayers = withUnistyles(Layers);
/** Making a label, and going to the page that owns them all. */
const ThemedPlus = withUnistyles(Plus);

/** Fits the item's 16pt leading slot with a hair of room, matching the trailing check. */
const OPTION_ICON_SIZE = 14;
/** The size `MenuItem` draws its check at, for the marks that stand in the same slot. */
const SELECTED_ICON_SIZE = 16;
const MENU_WIDTH = 232;

// Built once: these carry no props from the rows they sit in, and `withUnistyles` reads the theme
// when it renders rather than when the element is created, so hoisting them is safe.
const MATCH_ALL_LEADING = <ThemedLayers size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />;
const NEW_LABEL_LEADING = <ThemedPlus size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />;
const EDIT_LABELS_LEADING = <ThemedSettings2 size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />;

type OptionIcon = ComponentType<{
  size: number;
  uniProps: (theme: Theme) => { color: string };
}>;

// Options carry icons; the root rows deliberately do not. The root is four labels with their
// current values, and a column of icons there would be decoration competing with the values.
const GROUPING_ICONS: Record<SidebarGroupMode, OptionIcon> = {
  project: withUnistyles(Folder),
  status: withUnistyles(CircleDashed),
  label: withUnistyles(Tag),
};

const TITLE_SOURCE_ICONS: Record<WorkspaceTitleSource, OptionIcon> = {
  title: withUnistyles(Type),
  branch: withUnistyles(GitBranch),
};

// The same marks these things carry on the workspace row itself, so the menu and the row it
// configures name each item the same way twice.
const ROW_ITEM_ICONS: Record<SidebarRowItem, OptionIcon> = {
  labels: withUnistyles(Tag),
  host: withUnistyles(Server),
  changeRequest: withUnistyles(GitPullRequest),
  services: withUnistyles(Globe),
};

// These mark how much of the row an option spends, not what CI is, so they are the shapes each
// answer produces: a glyph with words beside it, the glyph on its own, nothing.
const CHECKS_DISPLAY_ICONS: Record<SidebarChecksDisplay, OptionIcon> = {
  iconAndText: withUnistyles(Captions),
  icon: ThemedCircleCheck,
  none: withUnistyles(EyeOff),
};

const TRAILING_ICONS: Record<SidebarTrailingChoice, OptionIcon> = {
  diff: withUnistyles(Diff),
  timestamp: withUnistyles(Clock),
};

const TITLE_SOURCES: readonly WorkspaceTitleSource[] = ["title", "branch"];
const TRAILING_CHOICES: readonly SidebarTrailingChoice[] = ["diff", "timestamp"];

const TITLE_SOURCE_LABEL_KEYS: Record<WorkspaceTitleSource, string> = {
  title: "sidebar.display.titleSource.title",
  branch: "sidebar.display.titleSource.branch",
};

const ROW_ITEM_LABEL_KEYS: Record<SidebarRowItem, string> = {
  labels: "sidebar.display.show.labels",
  host: "sidebar.display.show.host",
  changeRequest: "sidebar.display.show.changeRequest",
  services: "sidebar.display.show.services",
};

const CHECKS_DISPLAY_LABEL_KEYS: Record<SidebarChecksDisplay, string> = {
  iconAndText: "sidebar.display.checks.iconAndText",
  icon: "sidebar.display.checks.icon",
  none: "sidebar.display.checks.none",
};

const TRAILING_LABEL_KEYS: Record<SidebarTrailingChoice, string> = {
  diff: "sidebar.display.show.diff",
  timestamp: "sidebar.display.show.timestamp",
};

/**
 * What the sidebar shows and how it is arranged.
 *
 * The root is one row per decision with its current value; the options live a level down. The
 * shape is deliberate — every option of every decision on one surface is what this menu used to
 * be, and it grew a row for each host on top of that.
 */
export function SidebarDisplayPreferencesMenu(): ReactElement {
  const { t } = useTranslation();
  const preferences = useSidebarDisplayPreferences();
  const hosts = useHosts();
  // The label filter page offers the same labels the chip track does: with a host or project
  // facet on, the ones the workspaces still on screen carry.
  const { projects, filterableLabels } = useSidebarModel();

  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      hovered && styles.triggerHovered,
    ],
    [],
  );

  const showHostFilter = hosts.length > 1;
  // One project is the whole sidebar, so filtering to it is a no-op with a menu row attached.
  const showProjectFilter = projects.length > 1;
  // No labels means no decision to make. The branch appears with the first label someone creates.
  const showLabelFilter = filterableLabels.length > 0;
  const labelFilterCount = Object.keys(preferences.labelFilters).length;

  const pages = useMemo<MenuPageDefinition[]>(() => {
    const definitions: MenuPageDefinition[] = [
      {
        id: "grouping",
        title: t("sidebar.display.grouping.label"),
        content: (
          <OptionList
            values={SIDEBAR_GROUP_MODES}
            icons={GROUPING_ICONS}
            labelKeys={SIDEBAR_GROUP_MODE_LABEL_KEYS}
            selectedValue={preferences.grouping}
            onSelect={preferences.setGrouping}
            testIDPrefix="sidebar-grouping"
          />
        ),
      },
      {
        id: "titleSource",
        title: t("sidebar.display.titleSource.label"),
        content: (
          <OptionList
            values={TITLE_SOURCES}
            icons={TITLE_SOURCE_ICONS}
            labelKeys={TITLE_SOURCE_LABEL_KEYS}
            selectedValue={preferences.titleSource}
            onSelect={preferences.setTitleSource}
            testIDPrefix="sidebar-workspace-title-source"
          />
        ),
      },
      {
        id: "show",
        title: t("sidebar.display.show.label"),
        content: <ShowPage preferences={preferences} />,
      },
      {
        id: "checks",
        title: t("sidebar.display.show.checks"),
        content: (
          <OptionList
            values={SIDEBAR_CHECKS_DISPLAYS}
            icons={CHECKS_DISPLAY_ICONS}
            labelKeys={CHECKS_DISPLAY_LABEL_KEYS}
            selectedValue={preferences.checksDisplay}
            onSelect={preferences.setChecksDisplay}
            testIDPrefix="sidebar-checks-display"
          />
        ),
      },
    ];

    if (showHostFilter) {
      definitions.push({
        id: "hostFilter",
        title: t("sidebar.display.hostFilter.label"),
        content: <HostFilterPage preferences={preferences} hosts={hosts} />,
      });
    }
    if (showProjectFilter) {
      definitions.push({
        id: "projectFilter",
        title: t("sidebar.display.projectFilter.label"),
        content: <ProjectFilterPage preferences={preferences} projects={projects} />,
      });
    }
    if (showLabelFilter) {
      definitions.push({
        id: "labelFilter",
        title: t("sidebar.display.labelFilter.label"),
        content: <LabelFilterPage preferences={preferences} labels={filterableLabels} />,
      });
    }
    return definitions;
  }, [
    t,
    preferences,
    hosts,
    projects,
    showHostFilter,
    showProjectFilter,
    showLabelFilter,
    filterableLabels,
  ]);

  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.display.trigger")}
        testID="sidebar-display-preferences-menu"
      >
        <ThemedSettings2 size={14} uniProps={mutedIconMapping} />
      </MenuTrigger>
      <MenuSurface
        align="end"
        width={MENU_WIDTH}
        pages={pages}
        sheetTitle={t("sidebar.display.heading")}
        testID="sidebar-display-preferences-content"
      >
        <MenuSubTrigger
          id="grouping"
          value={t(SIDEBAR_GROUP_MODE_LABEL_KEYS[preferences.grouping])}
          testID="sidebar-display-grouping"
        >
          {t("sidebar.display.grouping.label")}
        </MenuSubTrigger>
        <MenuSubTrigger
          id="titleSource"
          value={t(TITLE_SOURCE_LABEL_KEYS[preferences.titleSource])}
          testID="sidebar-display-title-source"
        >
          {t("sidebar.display.titleSource.label")}
        </MenuSubTrigger>
        <MenuSubTrigger id="show" testID="sidebar-display-show">
          {t("sidebar.display.show.label")}
        </MenuSubTrigger>
        {showHostFilter || showProjectFilter || showLabelFilter ? <MenuSeparator /> : null}
        {/* A filtered sidebar looks like workspaces went missing, so the branch says so from the
            root rather than making you open it to find out. */}
        {showHostFilter ? (
          <MenuSubTrigger
            id="hostFilter"
            indicator={preferences.hostFilters.length > 0}
            testID="sidebar-display-host-filter"
          >
            {t("sidebar.display.hostFilter.label")}
          </MenuSubTrigger>
        ) : null}
        {showProjectFilter ? (
          <MenuSubTrigger
            id="projectFilter"
            indicator={preferences.projectFilters.length > 0}
            testID="sidebar-display-project-filter"
          >
            {t("sidebar.display.projectFilter.label")}
          </MenuSubTrigger>
        ) : null}
        {showLabelFilter ? (
          <MenuSubTrigger
            id="labelFilter"
            indicator={labelFilterCount > 0}
            testID="sidebar-display-label-filter"
          >
            {t("sidebar.display.labelFilter.label")}
          </MenuSubTrigger>
        ) : null}
      </MenuSurface>
    </MenuRoot>
  );
}

type Preferences = ReturnType<typeof useSidebarDisplayPreferences>;

/** One option row: its mark on the left, its label, and a check when it is the chosen one. */
function OptionItem<Value extends string>({
  value,
  icon: Icon,
  label,
  selected,
  closeOnSelect = true,
  onSelect,
  testID,
}: {
  value: Value;
  icon: OptionIcon;
  label: string;
  selected: boolean;
  closeOnSelect?: boolean;
  onSelect: (value: Value) => void;
  testID: string;
}): ReactElement {
  const handleSelect = useCallback(() => onSelect(value), [onSelect, value]);
  const leading = useMemo(
    () => <Icon size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />,
    [Icon],
  );
  return (
    <MenuItem
      selected={selected}
      leading={leading}
      closeOnSelect={closeOnSelect}
      onSelect={handleSelect}
      testID={testID}
    >
      {label}
    </MenuItem>
  );
}

/** A page of mutually exclusive options — pick one and the menu closes. */
function OptionList<Value extends string>({
  values,
  icons,
  labelKeys,
  selectedValue,
  onSelect,
  testIDPrefix,
}: {
  values: readonly Value[];
  icons: Record<Value, OptionIcon>;
  labelKeys: Record<Value, string>;
  selectedValue: Value;
  onSelect: (value: Value) => void;
  testIDPrefix: string;
}): ReactNode {
  const { t } = useTranslation();
  return values.map((value) => (
    <OptionItem
      key={value}
      value={value}
      icon={icons[value]}
      label={t(labelKeys[value])}
      selected={value === selectedValue}
      onSelect={onSelect}
      testID={`${testIDPrefix}-${value}`}
    />
  ));
}

/**
 * Two groups, split by the separator. Above it, what a row may say about a workspace — each one
 * independent. Below it, the one thing the slot to the right of the title holds, so picking the
 * one already showing empties the slot and gives the width back to the title.
 *
 * CI is the one item above the separator with three answers rather than two, so it opens a page
 * instead of ticking, and it goes last: a row that navigates does not belong in the middle of a
 * column you are running down with your eyes ticking things on and off.
 */
function ShowPage({ preferences }: { preferences: Preferences }): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {SIDEBAR_ROW_ITEMS.map((item) => (
        <OptionItem
          key={item}
          value={item}
          icon={ROW_ITEM_ICONS[item]}
          label={t(ROW_ITEM_LABEL_KEYS[item])}
          selected={preferences.rowItems[item]}
          closeOnSelect={false}
          onSelect={preferences.toggleRowItem}
          testID={`sidebar-row-item-${item}`}
        />
      ))}
      <ChecksSubTrigger />
      <MenuSeparator />
      {TRAILING_CHOICES.map((choice) => (
        <OptionItem
          key={choice}
          value={choice}
          icon={TRAILING_ICONS[choice]}
          label={t(TRAILING_LABEL_KEYS[choice])}
          selected={preferences.trailing === choice}
          closeOnSelect={false}
          onSelect={preferences.toggleTrailing}
          testID={`sidebar-workspace-trailing-${choice}`}
        />
      ))}
    </>
  );
}

/**
 * No value on the row, only the chevron. The three answers are all long enough that the value
 * fills the row and stops reading as an answer sitting at the right edge — it turns into a second
 * line of label. The chevron alone says there is a decision in here, and the page says what it is.
 */
function ChecksSubTrigger(): ReactElement {
  const { t } = useTranslation();
  const leading = useMemo(
    () => <ThemedCircleCheck size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />,
    [],
  );
  return (
    <MenuSubTrigger id="checks" leading={leading} testID="sidebar-display-checks">
      {t("sidebar.display.show.checks")}
    </MenuSubTrigger>
  );
}

function HostFilterPage({
  preferences,
  hosts,
}: {
  preferences: Preferences;
  hosts: ReturnType<typeof useHosts>;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <MenuItem
        selected={preferences.hostFilters.length === 0}
        closeOnSelect={false}
        onSelect={preferences.clearHostFilters}
        testID="sidebar-host-filter-all"
      >
        {t("sidebar.display.hostFilter.all")}
      </MenuItem>
      {hosts.map((host) => (
        <HostFilterItem
          key={host.serverId}
          serverId={host.serverId}
          label={host.label?.trim() || host.serverId}
          selected={preferences.hostFilters.includes(host.serverId)}
          onToggle={preferences.toggleHostFilter}
        />
      ))}
    </>
  );
}

/** The one option row whose mark is live state rather than an icon. */
function HostFilterItem({
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
  const handleSelect = useCallback(() => onToggle(serverId), [onToggle, serverId]);
  const leading = useMemo(
    () => (
      <View testID={`sidebar-host-filter-status-${serverId}`}>
        <HostStatusDot serverId={serverId} />
      </View>
    ),
    [serverId],
  );

  return (
    <MenuItem
      selected={selected}
      closeOnSelect={false}
      leading={leading}
      onSelect={handleSelect}
      testID={`sidebar-host-filter-${serverId}`}
    >
      {label}
    </MenuItem>
  );
}

/**
 * Which projects the sidebar shows, as a plain allowlist — no third state, unlike labels.
 *
 * A workspace belongs to exactly one project, so "not these" is expressible as "all the others"
 * and a tri-state here would be two ways to say the same thing. Labels earn their exclude state
 * because a workspace can carry several at once.
 */
function ProjectFilterPage({
  preferences,
  projects,
}: {
  preferences: Preferences;
  projects: readonly SidebarProjectEntry[];
}): ReactElement {
  const { t } = useTranslation();
  const iconTargets = useMemo(() => resolveSidebarProjectIconTargets(projects), [projects]);
  const icons = useProjectIcons({ projects: iconTargets });
  return (
    <>
      <MenuItem
        selected={preferences.projectFilters.length === 0}
        closeOnSelect={false}
        onSelect={preferences.clearProjectFilters}
        testID="sidebar-project-filter-all"
      >
        {t("sidebar.display.projectFilter.all")}
      </MenuItem>
      {projects.map((project) => (
        <ProjectFilterItem
          key={project.viewKey}
          viewKey={project.viewKey}
          label={project.projectName}
          iconDataUri={icons.get(project.viewKey) ?? null}
          selected={preferences.projectFilters.includes(project.viewKey)}
          onToggle={preferences.toggleProjectFilter}
        />
      ))}
    </>
  );
}

function ProjectFilterItem({
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
  const handleSelect = useCallback(() => onToggle(viewKey), [onToggle, viewKey]);
  const leading = useMemo(
    () => (
      <ProjectIconView
        iconDataUri={iconDataUri}
        initial={projectIconInitialFromDisplayName(label)}
        projectViewKey={viewKey}
        size={OPTION_ICON_SIZE}
        textStyle={styles.projectIconText}
      />
    ),
    [iconDataUri, label, viewKey],
  );

  return (
    <MenuItem
      selected={selected}
      closeOnSelect={false}
      leading={leading}
      onSelect={handleSelect}
      testID={`sidebar-project-filter-${viewKey}`}
    >
      {label}
    </MenuItem>
  );
}

/**
 * The filter, and under it the two verbs that change the labels themselves — the same pair, in the
 * same order, that a workspace's Labels page ends with.
 *
 * Filtering by a label is where you notice one is missing or misnamed, and the page you have open
 * is the page listing every label there is. Without these you close the menu, find a workspace,
 * open its menu, and go two pages in to reach the same two rows.
 *
 * New label makes one with nothing to hang it on. From a workspace's menu the label lands on that
 * workspace; there is no workspace here, so it joins the catalog and waits to be put on something —
 * which is what makes the chip track show it and this page offer it.
 */
function LabelFilterPage({
  preferences,
  labels,
}: {
  preferences: Preferences;
  labels: readonly string[];
}): ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useWorkspaceLabelColors();
  const handleEditLabels = useCallback(() => {
    router.push(buildSettingsSectionRoute("labels"));
  }, [router]);
  const { labelMatch, setLabelMatch } = preferences;
  const handleToggleMatch = useCallback(
    () => setLabelMatch(labelMatch === "all" ? "any" : "all"),
    [labelMatch, setLabelMatch],
  );
  return (
    <>
      <MenuItem
        selected={Object.keys(preferences.labelFilters).length === 0}
        closeOnSelect={false}
        onSelect={preferences.clearLabelFilters}
        testID="sidebar-label-filter-all"
      >
        {t("sidebar.display.labelFilter.all")}
      </MenuItem>
      {labels.map((label) => (
        <LabelFilterItem
          key={label.toLowerCase()}
          label={label}
          mode={preferences.labelFilters[label.toLowerCase()]}
          colors={colors}
          onCycle={preferences.cycleLabelFilter}
        />
      ))}
      {/* Under the labels, because it is about the set rather than any one of them, and worded
          "Match all" rather than "All labels" — that is the clear row at the top, meaning the
          opposite. Permanent, unlike the track's pill, so the mode stays reachable and readable
          with the chips put away. */}
      <MenuSeparator />
      <MenuItem
        selected={preferences.labelMatch === "all"}
        leading={MATCH_ALL_LEADING}
        closeOnSelect={false}
        onSelect={handleToggleMatch}
        testID="sidebar-label-filter-match-all"
      >
        {t("sidebar.display.labelFilter.matchAll")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        leading={NEW_LABEL_LEADING}
        onSelect={promptToCreateWorkspaceLabel}
        testID="sidebar-label-filter-new-label"
      >
        {t("sidebar.workspace.labels.newLabel")}
      </MenuItem>
      <MenuItem
        leading={EDIT_LABELS_LEADING}
        onSelect={handleEditLabels}
        testID="sidebar-label-filter-edit-labels"
      >
        {t("sidebar.workspace.labels.editLabels")}
      </MenuItem>
    </>
  );
}

/**
 * Three states per label, cycled by pressing the row: neutral, "only these", "never these".
 *
 * The two slots say two different things. On the left is which label this is, so the swatch stays
 * put in every state and the page reads with the same colours the rows do. On the right is what
 * the filter is doing with it: a check for "only these", the crossed-out eye for "never these",
 * nothing for a label the filter is not using. Excluded never fills the row — a check and a fill
 * on one row is two answers to one question (docs/menus.md).
 *
 * The mark carries it alone. A word under the name doubled every excluded row's height to repeat
 * what the eye already says, and a list where some rows are twice as tall as their neighbours is
 * harder to run down than one that is only marked.
 */
function LabelFilterItem({
  label,
  mode,
  colors,
  onCycle,
}: {
  label: string;
  mode: LabelFilterMode | undefined;
  colors: WorkspaceLabelColors;
  onCycle: (label: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onCycle(label), [label, onCycle]);
  const leading = useMemo(
    () => <WorkspaceLabelSwatch name={label} colors={colors} />,
    [colors, label],
  );
  // Sized to the check it stands in for, and in the label's own colour, the same mark the chip
  // track and the view editor use for an excluded label.
  const trailing = useMemo(
    () =>
      mode === "exclude" ? (
        <WorkspaceLabelExcludedMark name={label} colors={colors} size={SELECTED_ICON_SIZE} />
      ) : null,
    [colors, label, mode],
  );

  return (
    <MenuItem
      selected={mode === "include"}
      closeOnSelect={false}
      leading={leading}
      trailing={trailing}
      onSelect={handleSelect}
      testID={`sidebar-label-filter-${label.toLowerCase()}`}
    >
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // The generated project icon carries an initial, and the leading slot here is 14pt rather than
  // the sidebar's 16pt — small enough that the smallest token still overflows the square.
  projectIconText: {
    fontSize: 9,
    fontWeight: "600",
  },
}));
