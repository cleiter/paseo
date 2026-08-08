import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  openNewWorkspaceComposer,
  selectWorkspaceIsolation,
  submitNewWorkspaceEmpty,
} from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import {
  connectWorkspaceSetupClient,
  createWorkspaceThroughDaemon,
  expectNoSetupTab,
  expectSetupTab,
  getCurrentWorkspaceIdFromRoute,
  navigateToWorkspaceViaSidebar,
  observeWorkspaceSetupSnapshots,
  openHomeWithProject,
  seedProjectForWorkspaceSetup,
  waitForWorkspaceSetupProgress,
  type WorkspaceSetupDaemonClient,
} from "../support/helpers/workspace-setup";
import type { SetupTabAutoOpen } from "../../src/hooks/use-settings";

const FAILING_SETUP = "sh -c 'echo starting setup; exit 3'";
const PASSING_SETUP = "sh -c 'echo starting setup; echo setup complete'";

/**
 * Setup that blocks until the test creates a sentinel file, so "the tab is open while setup
 * runs" never races a fast machine. The loop is capped so a broken test cannot leave a setup
 * process spinning for the rest of the run.
 */
function gatedSetup(gatePath: string): string {
  return `sh -c 'echo starting setup; for i in $(seq 1 300); do [ -f ${gatePath} ] && break; sleep 0.2; done; echo setup complete'`;
}

async function seedSetupTabAutoOpen(page: Page, value: SetupTabAutoOpen): Promise<void> {
  await page.addInitScript((mode) => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ setupTabAutoOpen: mode }));
  }, value);
}

/**
 * Create a workspace whose setup has already reached a terminal state on the daemon before the
 * browser navigates, so the snapshot the app fetches is deterministic.
 */
async function createWorkspaceWithFinishedSetup(
  client: WorkspaceSetupDaemonClient,
  input: { cwd: string; slugPrefix: string; expectFailure: boolean },
): Promise<{ id: string; name: string }> {
  const finished = waitForWorkspaceSetupProgress(
    client,
    (payload) => payload.status === (input.expectFailure ? "failed" : "completed"),
  );
  const workspace = await createWorkspaceThroughDaemon(client, {
    cwd: input.cwd,
    worktreeSlug: `${input.slugPrefix}-${Date.now()}`,
  });
  await finished;
  return workspace;
}

test.describe("Workspace setup tab auto-open preference", () => {
  test("untilSuccess: the setup tab opens while setup runs and closes itself when it succeeds", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const gateDirectory = await mkdtemp(join(tmpdir(), "paseo-setup-gate-"));
    const gatePath = join(gateDirectory, "release");
    const workspace = await seedWorkspace({
      repoPrefix: "setup-until-success-",
      repo: { paseoConfig: { worktree: { setup: [gatedSetup(gatePath)] } } },
    });

    try {
      await seedSetupTabAutoOpen(page, "untilSuccess");
      const snapshots = observeWorkspaceSetupSnapshots(page);
      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      // Create the workspace through the UI: the setup run has to belong to the page's own
      // daemon session, because workspace_setup_progress is only emitted to the session that
      // started it. A workspace created by a side client would leave the page stuck on the
      // single snapshot it fetched.
      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      // Worktree isolation, and no prompt: a local workspace runs no setup at all, and a prompt
      // would create an agent, which routes setup output into that agent's timeline instead of a
      // setup snapshot.
      await selectWorkspaceIsolation(page, "worktree");
      await submitNewWorkspaceEmpty(page);

      const workspaceId = await getCurrentWorkspaceIdFromRoute(page);
      await expectSetupTab(page, workspaceId);

      await writeFile(gatePath, "");
      // Separates "setup never finished" from "the tab did not close": this waits on the app
      // being told the run completed, and only then requires the tab to be gone.
      await snapshots.waitForSnapshotStatus(workspaceId, "completed");
      await expectNoSetupTab(page, workspaceId, { timeout: 30_000 });
    } finally {
      await workspace.cleanup();
      await rm(gateDirectory, { force: true, recursive: true });
    }
  });

  test("untilSuccess: a failed setup keeps the setup tab", async ({ page }) => {
    const client = await connectWorkspaceSetupClient();
    const repo = await createTempGitRepo("setup-until-success-failed-", {
      paseoConfig: { worktree: { setup: [FAILING_SETUP] } },
    });

    try {
      await seedProjectForWorkspaceSetup(client, repo.path);
      const workspace = await createWorkspaceWithFinishedSetup(client, {
        cwd: repo.path,
        slugPrefix: "setup-until-success-failed",
        expectFailure: true,
      });

      await seedSetupTabAutoOpen(page, "untilSuccess");
      const snapshots = observeWorkspaceSetupSnapshots(page);

      await openHomeWithProject(page, repo.path);
      await navigateToWorkspaceViaSidebar(page, workspace.id);
      await waitForWorkspaceTabsVisible(page);

      await expectSetupTab(page, workspace.id);
      // The failed snapshot is the client's final word on this run, so nothing can close the
      // tab afterwards — assert it survives the delivery rather than a bare timeout.
      await snapshots.waitForSnapshotDelivered(workspace.id);
      await expectSetupTab(page, workspace.id);
    } finally {
      await client.close();
      await repo.cleanup();
    }
  });

  test("onFailure: a failed setup opens the setup tab", async ({ page }) => {
    const client = await connectWorkspaceSetupClient();
    const repo = await createTempGitRepo("setup-auto-open-failure-", {
      paseoConfig: { worktree: { setup: [FAILING_SETUP] } },
    });

    try {
      await seedProjectForWorkspaceSetup(client, repo.path);
      const workspace = await createWorkspaceWithFinishedSetup(client, {
        cwd: repo.path,
        slugPrefix: "setup-auto-open-failure",
        expectFailure: true,
      });

      await seedSetupTabAutoOpen(page, "onFailure");
      await openHomeWithProject(page, repo.path);
      await navigateToWorkspaceViaSidebar(page, workspace.id);
      await waitForWorkspaceTabsVisible(page);

      await expectSetupTab(page, workspace.id);
    } finally {
      await client.close();
      await repo.cleanup();
    }
  });

  test("onFailure: a clean setup does not open the setup tab", async ({ page }) => {
    const client = await connectWorkspaceSetupClient();
    const repo = await createTempGitRepo("setup-auto-open-clean-", {
      paseoConfig: { worktree: { setup: [PASSING_SETUP] } },
    });

    try {
      await seedProjectForWorkspaceSetup(client, repo.path);
      const workspace = await createWorkspaceWithFinishedSetup(client, {
        cwd: repo.path,
        slugPrefix: "setup-auto-open-clean",
        expectFailure: false,
      });

      // Seeded before the first navigation, so this is also the regression test for the
      // settings-hydration gate: a miss there reads the default (always) against a snapshot
      // that was just received, and opens the tab.
      await seedSetupTabAutoOpen(page, "onFailure");
      const snapshots = observeWorkspaceSetupSnapshots(page);

      await openHomeWithProject(page, repo.path);
      await navigateToWorkspaceViaSidebar(page, workspace.id);
      await waitForWorkspaceTabsVisible(page);
      await snapshots.waitForSnapshotDelivered(workspace.id);

      await expectNoSetupTab(page, workspace.id);
    } finally {
      await client.close();
      await repo.cleanup();
    }
  });
});
