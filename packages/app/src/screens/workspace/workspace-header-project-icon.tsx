import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import { useHostProjects } from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { ICON_SIZE } from "@/styles/theme";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import {
  resolveSidebarProjectIconTarget,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";

const EMPTY_ICON_TARGETS: SidebarProjectIconTarget[] = [];

// The title's line box, matching LEADING_SLOT_HEIGHT in the sidebar's project-leading-visual.
const TITLE_LINE_BOX_HEIGHT = 20;

/**
 * The project's mark, leading the workspace title — the same icon the sidebar row carries, in
 * the same position, so the two surfaces read as one identity.
 *
 * The color of a generated icon comes from the project's `viewKey`, and that key is NOT
 * derivable from the workspace descriptor: the structure builder uses the shared `projectKey`
 * whenever it is unique on the host, and only otherwise a per-placement key. So the key has to
 * come from `useHostProjects`, and until it does this renders nothing. A guessed key produces a
 * square in a different color from the sidebar's, which then flips once the real key arrives —
 * two colors for one project is worse than a beat with no icon at all.
 */
export function WorkspaceHeaderProjectIcon({
  workspace,
  serverId,
}: {
  workspace: WorkspaceDescriptor | null;
  serverId: string;
}) {
  const projects = useHostProjects(useMemo(() => [serverId], [serverId]));
  const projectId = workspace?.projectId ?? null;

  const iconTargets = useMemo(() => {
    if (!projectId) return EMPTY_ICON_TARGETS;
    const project = projects.find((candidate) =>
      candidate.hosts.some((host) => host.serverId === serverId && host.projectId === projectId),
    );
    if (!project) return EMPTY_ICON_TARGETS;
    // Bound to one host, so the icon is read from the daemon this workspace lives on rather
    // than whichever placement happens to come first in a cross-host group.
    const target = resolveSidebarProjectIconTarget(project, serverId);
    return target ? [{ projectViewKey: project.viewKey, ...target }] : EMPTY_ICON_TARGETS;
  }, [projectId, projects, serverId]);

  const iconByProjectViewKey = useProjectIcons({ projects: iconTargets });

  const target = iconTargets[0];
  if (!target || !workspace) {
    return null;
  }

  return (
    <View style={styles.slot} testID="workspace-header-project-icon">
      <ProjectIconView
        iconDataUri={iconByProjectViewKey.get(target.projectViewKey) ?? null}
        initial={projectIconPlaceholderLabelFromDisplayName(workspace.projectDisplayName)
          .charAt(0)
          .toUpperCase()}
        projectViewKey={target.projectViewKey}
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
