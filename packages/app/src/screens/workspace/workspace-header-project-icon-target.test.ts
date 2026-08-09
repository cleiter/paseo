import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-project-model";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceHeaderProjectIcon } from "./workspace-header-project-icon-target";

const SERVER_ID = "srv";

function hostProject(overrides: Partial<HostProjectListItem> = {}): HostProjectListItem {
  return {
    viewKey: "github.com/acme/app",
    projectKey: "github.com/acme/app",
    projectName: "acme/app",
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [
      {
        serverId: SERVER_ID,
        projectId: "prj_1",
        iconWorkingDir: "/repo",
        worktreeSupport: "supported",
      },
    ],
    workspaceKeys: [],
    ...overrides,
  };
}

function workspace(overrides: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor {
  return {
    id: "ws_1",
    projectId: "prj_1",
    projectDisplayName: "acme/app",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "app",
    status: "ready",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...overrides,
  } as WorkspaceDescriptor;
}

describe("resolveWorkspaceHeaderProjectIcon", () => {
  it("draws nothing without a workspace", () => {
    expect(
      resolveWorkspaceHeaderProjectIcon({
        workspace: null,
        serverId: SERVER_ID,
        projects: [hostProject()],
      }),
    ).toBeNull();
  });

  it("draws nothing until the project is in the workspace structure", () => {
    // A guessed view key would colour the icon differently from the sidebar and then flip.
    expect(
      resolveWorkspaceHeaderProjectIcon({
        workspace: workspace(),
        serverId: SERVER_ID,
        projects: [],
      }),
    ).toBeNull();
  });

  it("draws nothing when the project has no usable placement", () => {
    expect(
      resolveWorkspaceHeaderProjectIcon({
        workspace: workspace(),
        serverId: SERVER_ID,
        projects: [
          hostProject({
            hosts: [
              {
                serverId: SERVER_ID,
                projectId: "prj_1",
                iconWorkingDir: "   ",
                worktreeSupport: "supported",
              },
            ],
          }),
        ],
      }),
    ).toBeNull();
  });

  it("carries the structure's view key, so the icon matches the sidebar's colour", () => {
    const icon = resolveWorkspaceHeaderProjectIcon({
      workspace: workspace(),
      serverId: SERVER_ID,
      projects: [hostProject()],
    });

    expect(icon).toEqual({
      target: {
        projectViewKey: "github.com/acme/app",
        serverId: SERVER_ID,
        projectId: "prj_1",
        iconWorkingDir: "/repo",
        customIconRevision: undefined,
      },
      initial: "A",
    });
  });

  it("reads the icon from this workspace's host, not the first placement", () => {
    const icon = resolveWorkspaceHeaderProjectIcon({
      workspace: workspace(),
      serverId: SERVER_ID,
      projects: [
        hostProject({
          hosts: [
            {
              serverId: "other",
              projectId: "prj_other",
              iconWorkingDir: "/other/repo",
              worktreeSupport: "supported",
            },
            {
              serverId: SERVER_ID,
              projectId: "prj_1",
              iconWorkingDir: "/repo",
              worktreeSupport: "supported",
            },
          ],
        }),
      ],
    });

    expect(icon?.target).toMatchObject({ serverId: SERVER_ID, iconWorkingDir: "/repo" });
  });

  it("takes the initial from the last segment of the display name", () => {
    const icon = resolveWorkspaceHeaderProjectIcon({
      workspace: workspace({ projectDisplayName: "acme/direnv-test" }),
      serverId: SERVER_ID,
      projects: [hostProject()],
    });

    expect(icon?.initial).toBe("D");
  });
});
