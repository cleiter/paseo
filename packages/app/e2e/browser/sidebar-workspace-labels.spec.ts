import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openWorkspaceContextMenu, selectSidebarLabelGrouping } from "../support/helpers/sidebar";

const LABEL = "blocked";

let labelled: SeededWorkspace;
let unlabelled: SeededWorkspace;

test.beforeAll(async () => {
  labelled = await seedWorkspace({ repoPrefix: "workspace-labels-a-" });
  unlabelled = await seedWorkspace({ repoPrefix: "workspace-labels-b-" });
});

test.afterAll(async () => {
  await labelled?.cleanup();
  await unlabelled?.cleanup();
});

test.describe("Sidebar workspace labels", () => {
  test.describe.configure({ timeout: 120_000 });

  test("labelling a workspace filters the sidebar to it and says what it hid", async ({ page }) => {
    const serverId = getServerId();
    const labelledRow = page.getByTestId(
      `sidebar-workspace-row-${serverId}:${labelled.workspaceId}`,
    );
    const unlabelledRow = page.getByTestId(
      `sidebar-workspace-row-${serverId}:${unlabelled.workspaceId}`,
    );
    const hiddenRail = page.getByTestId("sidebar-hidden-rail");

    // No workspace open, so neither row is the active one — the filter applies to both and the
    // active-workspace exemption cannot mask a bug in it.
    await gotoAppShell(page);
    await expect(labelledRow).toBeVisible({ timeout: 30_000 });
    await expect(unlabelledRow).toBeVisible();
    await expect(page.getByTestId("sidebar-label-track")).toHaveCount(0);
    // No labels, nothing to filter by: the header's switch must not outlive the chips it shows.
    await expect(page.getByTestId("sidebar-label-filter-toggle")).toHaveCount(0);

    await openWorkspaceContextMenu(page, labelled.workspaceId);
    await page
      .getByTestId(`sidebar-workspace-menu-labels-${serverId}:${labelled.workspaceId}`)
      .click();
    await page.getByTestId("workspace-label-new").click();
    await page.getByTestId("workspace-label-name-input").fill(LABEL);
    await page.getByTestId("workspace-label-save-button").click();

    // The chip on the row is the label arriving back from the daemon, not local optimism.
    await expect(labelledRow.getByTestId("sidebar-workspace-labels")).toContainText(LABEL, {
      timeout: 15_000,
    });

    // The track appears with the first label, so there is no setting to find first.
    const trackChip = page.getByTestId(`sidebar-label-track-${LABEL}`);
    await expect(trackChip).toBeVisible({ timeout: 10_000 });

    // The track goes away entirely from the header's switch — no heading left behind paying for
    // itself — and comes back from the same press.
    const labelFilterToggle = page.getByTestId("sidebar-label-filter-toggle");
    await labelFilterToggle.click();
    await expect(page.getByTestId("sidebar-label-track")).toHaveCount(0);
    await expect(labelFilterToggle).toBeVisible();
    await labelFilterToggle.click();
    await expect(trackChip).toBeVisible();

    // One tap includes: only workspaces carrying the label survive.
    await trackChip.click();
    await expect(unlabelledRow).toHaveCount(0, { timeout: 10_000 });
    await expect(labelledRow).toBeVisible();

    // Hidden over an active filter, the switch carries the dot — putting the chips away cannot put
    // away the fact that the list is being narrowed.
    const labelFilterIndicator = page.getByTestId("sidebar-label-filter-toggle-indicator");
    await labelFilterToggle.click();
    await expect(labelFilterIndicator).toBeVisible();
    await expect(unlabelledRow).toHaveCount(0);
    await labelFilterToggle.click();
    await expect(labelFilterIndicator).toHaveCount(0);

    // Unlabelling from the row's own menu, while that same label is the filter. The workspace
    // stops matching on the press, and without the open-menu exemption the row goes and takes the
    // menu with it — so the label you meant to add second costs another right-click.
    await openWorkspaceContextMenu(page, labelled.workspaceId);
    await page
      .getByTestId(`sidebar-workspace-menu-labels-${serverId}:${labelled.workspaceId}`)
      .click();
    const labelOption = page.getByTestId(`workspace-label-${LABEL}`);
    await expect(labelOption).toBeVisible({ timeout: 10_000 });
    await labelOption.click();
    await expect(labelledRow).toBeVisible();
    await expect(labelOption).toBeVisible();
    // Put it back from the same open menu, which is the whole point of the row still being there.
    await labelOption.click();
    await expect(labelledRow.getByTestId("sidebar-workspace-labels")).toContainText(LABEL, {
      timeout: 10_000,
    });
    await page.keyboard.press("Escape");
    await expect(labelOption).toHaveCount(0, { timeout: 10_000 });

    // Nothing disappears silently — the rail is the count, and pressing it is the way back.
    await expect(hiddenRail).toBeVisible();
    await hiddenRail.click();
    await expect(unlabelledRow).toBeVisible({ timeout: 10_000 });
    await expect(hiddenRail).toHaveCount(0);

    // The chip on the row says which labels the workspace carries and nothing else. Pressing it is
    // pressing the row, because the row is what a press there was aimed at.
    const rowChip = labelledRow.getByTestId("sidebar-workspace-labels").getByText(LABEL);
    await rowChip.click();
    await expect(unlabelledRow).toBeVisible();
    await expect(hiddenRail).toHaveCount(0);

    // Grouping by the same label is the other half: a label heads a section instead of narrowing
    // the list, and the workspaces carrying none keep a section of their own rather than
    // disappearing from the sidebar that is supposed to notify you about them.
    await selectSidebarLabelGrouping(page);
    await expect(
      page
        .getByTestId(`sidebar-label-group-rows-${LABEL}`)
        .getByTestId(`sidebar-workspace-row-${serverId}:${labelled.workspaceId}`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page
        .getByTestId("sidebar-label-group-rows-unlabelled")
        .getByTestId(`sidebar-workspace-row-${serverId}:${unlabelled.workspaceId}`),
    ).toBeVisible();
  });
});
