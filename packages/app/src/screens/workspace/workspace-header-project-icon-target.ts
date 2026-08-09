import type { HostProjectListItem } from "@/projects/host-project-model";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import {
  resolveSidebarProjectIconTarget,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";

export interface WorkspaceHeaderProjectIcon {
  target: SidebarProjectIconTarget;
  initial: string;
}

/**
 * What the workspace header should draw for a project, or `null` for "draw nothing yet".
 *
 * The colour of a generated icon comes from the project's `viewKey`, and that key is NOT
 * derivable from the workspace descriptor: the structure builder uses the shared `projectKey`
 * whenever it is unique on the host, and only otherwise a per-placement key. So the key has to
 * come from the built structure, and until the project appears there this returns `null`. A
 * guessed key produces a square in a different colour from the sidebar's, which then flips once
 * the real key arrives, and two colours for one project is worse than a beat with no icon.
 *
 * `serverId` is passed through as the preferred placement because the header is bound to one
 * host: the icon has to come from the daemon this workspace lives on, not from whichever
 * placement happens to come first in a cross-host group.
 */
export function resolveWorkspaceHeaderProjectIcon(input: {
  workspace: WorkspaceDescriptor | null;
  serverId: string;
  projects: readonly HostProjectListItem[];
}): WorkspaceHeaderProjectIcon | null {
  const { workspace, serverId } = input;
  if (!workspace) {
    return null;
  }
  const projectId = workspace.projectId;
  if (!projectId) {
    return null;
  }
  const project = input.projects.find((candidate) =>
    candidate.hosts.some((host) => host.serverId === serverId && host.projectId === projectId),
  );
  if (!project) {
    return null;
  }
  const target = resolveSidebarProjectIconTarget(project, serverId);
  if (!target) {
    return null;
  }
  return {
    target: { projectViewKey: project.viewKey, ...target },
    initial: projectIconPlaceholderLabelFromDisplayName(workspace.projectDisplayName)
      .charAt(0)
      .toUpperCase(),
  };
}
