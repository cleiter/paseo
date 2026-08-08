import { realpathSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { DaemonClient as InternalDaemonClient } from "@getpaseo/client/internal/daemon-client";
import { parseHostWorkspaceRouteFromPathname } from "../../../src/utils/host-routes";
import { gotoAppShell } from "./app";
import { connectDaemonClient } from "./daemon-client-loader";
import { getServerId } from "./server-id";
import { withProjectOwnership } from "./project-ownership";
import { switchWorkspaceViaSidebar } from "./workspace-ui";
import { readSessionMessage } from "./session-frames";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

type WorkspaceSetupDaemonClient = Pick<
  InternalDaemonClient,
  | "close"
  | "addProject"
  | "connect"
  | "createPaseoWorktree"
  | "createWorkspace"
  | "fetchAgent"
  | "fetchAgents"
  | "fetchWorkspaces"
  | "listTerminals"
  | "removeProject"
  | "subscribeRawMessages"
>;

export type WorkspaceSetupProgressPayload = Extract<
  SessionOutboundMessage,
  { type: "workspace_setup_progress" }
>["payload"];

export type { WorkspaceSetupDaemonClient };

export async function connectWorkspaceSetupClient(): Promise<WorkspaceSetupDaemonClient> {
  const client = await connectDaemonClient<WorkspaceSetupDaemonClient>({
    clientIdPrefix: "workspace-setup",
  });
  return withProjectOwnership(client);
}

export async function openProjectViaDaemon(
  client: WorkspaceSetupDaemonClient,
  repoPath: string,
): Promise<{ id: string; name: string; workspaceDirectory: string }> {
  const result = await client.createWorkspace({
    source: { kind: "directory", path: repoPath },
  });
  if (!result.workspace || result.error) {
    throw new Error(result.error ?? `Failed to create workspace ${repoPath}`);
  }
  return {
    id: result.workspace.id,
    name: result.workspace.name,
    workspaceDirectory: result.workspace.workspaceDirectory,
  };
}

export async function seedProjectForWorkspaceSetup(
  client: WorkspaceSetupDaemonClient,
  repoPath: string,
): Promise<void> {
  const result = await client.addProject(repoPath);
  if (!result.project || result.error) {
    throw new Error(result.error ?? `Failed to add project ${repoPath}`);
  }
}

export function projectNameFromPath(repoPath: string): string {
  return repoPath.replace(/\/+$/, "").split("/").findLast(Boolean) ?? repoPath;
}

export async function openHomeWithProject(page: Page, repoPath: string): Promise<void> {
  await gotoAppShell(page);
  await expect(
    page
      .locator('[data-testid^="sidebar-project-row-"]')
      .filter({ hasText: projectNameFromPath(repoPath) })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
}

function createWorkspaceButton(page: Page, repoPath: string) {
  return page.getByRole("button", {
    name: `Create a new workspace for ${projectNameFromPath(repoPath)}`,
  });
}

async function revealWorkspaceButton(page: Page, repoPath: string): Promise<void> {
  await page
    .locator('[data-testid^="sidebar-project-row-"]')
    .filter({ hasText: projectNameFromPath(repoPath) })
    .first()
    .hover();
}

export async function createWorkspaceFromSidebar(page: Page, repoPath: string): Promise<void> {
  const button = createWorkspaceButton(page, repoPath);
  await revealWorkspaceButton(page, repoPath);
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  await expect(page).toHaveURL(/\/new\?/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function getCurrentWorkspaceIdFromRoute(page: Page): Promise<string> {
  await expect
    .poll(
      () => parseHostWorkspaceRouteFromPathname(new URL(page.url()).pathname)?.workspaceId ?? null,
      { timeout: 30_000 },
    )
    .not.toBeNull();

  const workspaceId =
    parseHostWorkspaceRouteFromPathname(new URL(page.url()).pathname)?.workspaceId ?? null;
  if (!workspaceId) {
    throw new Error(`Expected a workspace route but found ${page.url()}`);
  }

  return workspaceId;
}

function workspaceSetupDialog(page: Page) {
  return page.getByTestId("workspace-setup-dialog");
}

export async function createChatAgentFromWorkspaceSetup(
  page: Page,
  input: { message: string },
): Promise<void> {
  const messageInput = page.getByRole("textbox", { name: "Message agent..." }).first();
  await expect(messageInput).toBeVisible({ timeout: 15_000 });
  await messageInput.fill(input.message);
  await messageInput.press("Enter");
}

/**
 * @deprecated The new workspace screen no longer has a standalone terminal button.
 * Use the daemon API to create a workspace, then open a terminal from the launcher.
 */
export async function createStandaloneTerminalFromWorkspaceSetup(page: Page): Promise<void> {
  await workspaceSetupDialog(page)
    .getByRole("button", { name: /^Terminal Create the workspace/i })
    .click();
}

export async function waitForWorkspaceSetupDialogToClose(
  page: Page,
  timeoutMs = 45_000,
): Promise<void> {
  const dialog = workspaceSetupDialog(page);

  try {
    await expect(dialog).toHaveCount(0, { timeout: timeoutMs });
  } catch (error) {
    const dialogText = (await dialog.textContent().catch(() => null))?.replace(/\s+/g, " ").trim();
    throw new Error(
      dialogText
        ? `Workspace setup dialog stayed open. Visible text: ${dialogText}`
        : `Workspace setup dialog did not close within ${timeoutMs}ms`,
      { cause: error },
    );
  }
}

export async function expectSetupPanel(page: Page): Promise<void> {
  // If the setup panel is already visible (auto-opened), we're done.
  const panel = page.getByTestId("workspace-setup-panel");
  if (await panel.isVisible().catch(() => false)) {
    return;
  }
  // Otherwise open it manually via workspace header actions menu.
  // Use the specific testID to avoid matching the sidebar kebab which shares
  // the same "Workspace actions" accessibility label.
  const actionsButton = page.getByTestId("workspace-header-menu-trigger");
  await expect(actionsButton).toBeVisible({ timeout: 10_000 });
  await actionsButton.click();
  const showSetup = page.getByTestId("workspace-header-show-setup");
  await expect(showSetup).toBeVisible({ timeout: 5_000 });
  await showSetup.click();
  await expect(panel).toBeVisible({ timeout: 30_000 });
}

/**
 * The Setup entry in the workspace tab strip. Unlike {@link expectSetupPanel},
 * asserting on this tab can tell auto-open apart from a manual open: auto-open
 * opens the tab in the background, so the panel is never visible.
 */
export function setupTabTestId(workspaceId: string): string {
  return `workspace-tab-setup_${workspaceId}`;
}

export async function expectSetupTab(page: Page, workspaceId: string): Promise<void> {
  await expect(page.getByTestId(setupTabTestId(workspaceId)).first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function expectNoSetupTab(
  page: Page,
  workspaceId: string,
  options: { timeout?: number } = {},
): Promise<void> {
  await expect(page.getByTestId(setupTabTestId(workspaceId))).toHaveCount(0, {
    timeout: options.timeout,
  });
}

/**
 * Synchronization point for "the Setup tab never opened" assertions: watches the
 * app's own daemon socket and resolves once a setup snapshot for the workspace
 * has demonstrably reached the client. Without it, an absent tab can just mean
 * the app had not got there yet.
 *
 * Call this before the page navigates — the listener has to be attached first.
 */
export function observeWorkspaceSetupSnapshots(page: Page) {
  const workspacesWithSnapshot = new Set<string>();
  const statusByWorkspaceId = new Map<string, string>();

  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const message = readSessionMessage(payload);
      if (
        message?.type !== "workspace_setup_status_response" &&
        message?.type !== "workspace_setup_progress"
      ) {
        return;
      }
      const body = message.payload as
        | { workspaceId?: unknown; snapshot?: unknown; status?: unknown }
        | null
        | undefined;
      if (typeof body?.workspaceId !== "string") return;
      // A progress frame is itself the snapshot; a status response carries
      // snapshot: null when the daemon has nothing for that workspace.
      if (message.type === "workspace_setup_status_response" && !body.snapshot) return;
      workspacesWithSnapshot.add(body.workspaceId);
      const snapshot =
        message.type === "workspace_setup_progress"
          ? body
          : (body.snapshot as { status?: unknown } | null);
      if (typeof snapshot?.status === "string") {
        statusByWorkspaceId.set(body.workspaceId, snapshot.status);
      }
    });
  });

  return {
    async waitForSnapshotDelivered(
      workspaceId: string,
      options: { timeout?: number } = {},
    ): Promise<void> {
      await expect
        .poll(() => workspacesWithSnapshot.has(workspaceId), {
          timeout: options.timeout ?? 30_000,
        })
        .toBe(true);
    },

    /** Wait until the app has been told the run reached `status` (`running` | `completed` | `failed`). */
    async waitForSnapshotStatus(
      workspaceId: string,
      status: "running" | "completed" | "failed",
      options: { timeout?: number } = {},
    ): Promise<void> {
      await expect
        .poll(() => statusByWorkspaceId.get(workspaceId) ?? null, {
          timeout: options.timeout ?? 30_000,
        })
        .toBe(status);
    },
  };
}

export async function expectSetupStatus(
  page: Page,
  status: "Running" | "Completed" | "Failed",
): Promise<void> {
  await expect(page.getByTestId("workspace-setup-status")).toContainText(status, {
    timeout: 30_000,
  });
}

export async function expectSetupLogContains(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId("workspace-setup-log")).toContainText(text, {
    timeout: 30_000,
  });
}

export async function expectNoSetupMessage(page: Page): Promise<void> {
  await expect(
    page.getByText("No setup commands ran for this workspace.", { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
}

export async function createWorkspaceThroughDaemon(
  client: WorkspaceSetupDaemonClient,
  input: { cwd: string; worktreeSlug: string },
): Promise<{ id: string; name: string }> {
  const result = await client.createPaseoWorktree(input);
  if (!result.workspace || result.error) {
    throw new Error(result.error ?? `Failed to create workspace for ${input.cwd}`);
  }
  return {
    id: result.workspace.id,
    name: result.workspace.name,
  };
}

export async function findWorktreeWorkspaceForProject(
  client: WorkspaceSetupDaemonClient,
  repoPath: string,
): Promise<{
  id: string;
  name: string;
  projectRootPath: string;
  workspaceDirectory: string;
}> {
  const payload = await client.fetchWorkspaces();
  const normalizedRepoPath = realpathSync(repoPath);
  const workspace =
    payload.entries.find(
      (entry) =>
        entry.projectRootPath === normalizedRepoPath &&
        entry.workspaceDirectory !== normalizedRepoPath,
    ) ?? null;
  if (!workspace) {
    throw new Error(`Failed to find created worktree workspace for ${repoPath}`);
  }
  return {
    id: workspace.id,
    name: workspace.name,
    projectRootPath: workspace.projectRootPath,
    workspaceDirectory: workspace.workspaceDirectory,
  };
}

export async function fetchWorkspaceById(
  client: WorkspaceSetupDaemonClient,
  workspaceId: string,
): Promise<{
  id: string;
  name: string;
  workspaceDirectory: string;
  projectRootPath: string;
}> {
  const payload = await client.fetchWorkspaces();
  const workspace = payload.entries.find((entry) => entry.id === workspaceId) ?? null;
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  return workspace;
}

export async function navigateToWorkspaceViaSidebar(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await switchWorkspaceViaSidebar({
    page,
    serverId: getServerId(),
    workspaceId,
  });
}

export async function openWorkspaceScriptsMenu(page: Page): Promise<void> {
  await page.getByTestId("workspace-scripts-button").click();
  await expect(page.getByTestId("workspace-scripts-menu")).toBeVisible({ timeout: 10_000 });
}

export async function startWorkspaceScriptFromMenu(page: Page, scriptName: string): Promise<void> {
  await page.getByTestId(`workspace-scripts-start-${scriptName}`).click();
}

export async function closeWorkspaceScriptsMenu(page: Page): Promise<void> {
  await page.getByTestId("workspace-scripts-menu-backdrop").click();
}

export async function waitForWorkspaceSetupProgress(
  client: WorkspaceSetupDaemonClient,
  predicate: (payload: WorkspaceSetupProgressPayload) => boolean,
  timeoutMs = 30_000,
): Promise<WorkspaceSetupProgressPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for workspace_setup_progress after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = client.subscribeRawMessages((message) => {
      if (message.type !== "workspace_setup_progress") {
        return;
      }
      if (!predicate(message.payload)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(message.payload);
    });
  });
}
