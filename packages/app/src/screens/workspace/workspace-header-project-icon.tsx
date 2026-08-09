import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import { useHostProjects } from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { resolveWorkspaceHeaderProjectIcon } from "@/screens/workspace/workspace-header-project-icon-target";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { ICON_SIZE } from "@/styles/theme";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";

const EMPTY_ICON_TARGETS: SidebarProjectIconTarget[] = [];

// The title's line box, matching LEADING_SLOT_HEIGHT in the sidebar's project-leading-visual.
const TITLE_LINE_BOX_HEIGHT = 20;

/**
 * The project's mark, leading the workspace title — the same icon the sidebar row carries, in
 * the same position, so the two surfaces read as one identity.
 *
 * Which icon to draw, and whether to draw one at all, lives in
 * `resolveWorkspaceHeaderProjectIcon`. This subscribes and renders.
 */
export function WorkspaceHeaderProjectIcon({
  workspace,
  serverId,
}: {
  workspace: WorkspaceDescriptor | null;
  serverId: string;
}) {
  const projects = useHostProjects(useMemo(() => [serverId], [serverId]));
  const icon = useMemo(
    () => resolveWorkspaceHeaderProjectIcon({ workspace, serverId, projects }),
    [projects, serverId, workspace],
  );
  const iconTargets = useMemo(() => (icon ? [icon.target] : EMPTY_ICON_TARGETS), [icon]);
  const iconByProjectViewKey = useProjectIcons({ projects: iconTargets });

  if (!icon) {
    return null;
  }

  return (
    <View style={styles.slot} testID="workspace-header-project-icon">
      <ProjectIconView
        iconDataUri={iconByProjectViewKey.get(icon.target.projectViewKey) ?? null}
        initial={icon.initial}
        projectViewKey={icon.target.projectViewKey}
        size={ICON_SIZE.md}
        textStyle={styles.fallbackText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The header title row shrinks its text to fit; the icon never gives up its 16pt.
  //
  // The slot is as tall as the title's line box, not as tall as the icon, and centers the icon
  // inside it — same geometry as the sidebar's projectLeadingVisualSlot, keep the two in step.
  // Compact stacks the title over the project name, and a centered icon there floats between the
  // two lines instead of marking the title; flex-start plus the line-box height pins it to the
  // title's row. Wide is a single row, so centering is already right.
  slot: {
    flexShrink: 0,
    height: TITLE_LINE_BOX_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: {
      xs: "flex-start",
      md: "center",
    },
  },
  // Matches the sidebar's generated icon, so the same initial is set at the same size on both
  // surfaces.
  fallbackText: {
    fontSize: 9,
  },
});
