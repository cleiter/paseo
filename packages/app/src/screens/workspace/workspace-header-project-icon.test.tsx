/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostProjectListItem } from "@/projects/host-project-model";
import type { WorkspaceDescriptor } from "@/stores/session-store";

const hooks = vi.hoisted(() => ({
  projects: [] as HostProjectListItem[],
  icons: new Map<string, string | null>(),
  lastIconRequest: null as unknown,
}));

vi.mock("@/projects/host-projects", () => ({
  useHostProjects: () => hooks.projects,
}));

vi.mock("@/projects/icons", () => ({
  useProjectIcons: (input: unknown) => {
    hooks.lastIconRequest = input;
    return hooks.icons;
  },
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { WorkspaceHeaderProjectIcon } from "./workspace-header-project-icon";

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

describe("WorkspaceHeaderProjectIcon", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    hooks.projects = [hostProject()];
    hooks.icons = new Map();
    hooks.lastIconRequest = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  function render(workspaceDescriptor: WorkspaceDescriptor | null) {
    act(() => {
      root?.render(
        <WorkspaceHeaderProjectIcon workspace={workspaceDescriptor} serverId={SERVER_ID} />,
      );
    });
    return container?.querySelector('[data-testid="workspace-header-project-icon"]') ?? null;
  }

  it("renders nothing without a workspace", () => {
    expect(render(null)).toBeNull();
  });

  it("renders nothing until the project is in the workspace structure", () => {
    hooks.projects = [];

    expect(render(workspace())).toBeNull();
    // No guessed target means no icon request, so no guessed identity color either.
    expect(hooks.lastIconRequest).toEqual({ projects: [] });
  });

  it("renders the daemon-provided icon image when there is one", () => {
    hooks.icons = new Map([["github.com/acme/app", "data:image/png;base64,AAAA"]]);

    const icon = render(workspace());

    expect(icon).not.toBeNull();
    expect(icon?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("falls back to the project initial when the daemon has no icon", () => {
    const icon = render(workspace());

    expect(icon).not.toBeNull();
    expect(icon?.querySelector("img")).toBeNull();
    expect(icon?.textContent).toBe("A");
  });

  it("shows the icon even when the project name repeats the workspace name", () => {
    // The header drops the redundant text project name on wide layouts; the mark stays.
    const icon = render(workspace({ name: "acme/app" }));

    expect(icon).not.toBeNull();
  });

  it("reads the icon from this workspace's host, not the first placement", () => {
    hooks.projects = [
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
    ];

    render(workspace());

    expect(hooks.lastIconRequest).toEqual({
      projects: [
        {
          projectViewKey: "github.com/acme/app",
          serverId: SERVER_ID,
          projectId: "prj_1",
          iconWorkingDir: "/repo",
          customIconRevision: undefined,
        },
      ],
    });
  });
});
