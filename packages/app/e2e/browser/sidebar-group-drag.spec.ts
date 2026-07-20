import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

// Dragging is the one part of the sidebar that unit tests cannot reach: the policy is pure
// and covered, but every bug that actually shipped in this feature was a RENDERING bug —
// a row that snapped home, an overlay 100px below the cursor, a drop that quietly did
// nothing. Those only exist in a browser, so this spec drives a real one and asserts on the
// resulting ORDER rather than on pixels.

function workspaceKey(workspaceId: string): string {
  return `${getServerId()}:${workspaceId}`;
}

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${workspaceKey(workspaceId)}`);
}

async function seedSecondWorkspace(seeded: SeededWorkspace, title: string): Promise<string> {
  const created = await seeded.client.createWorkspace({
    source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
    title,
  });
  if (!created.workspace) {
    throw new Error(created.error ?? "Failed to seed the second workspace");
  }
  return created.workspace.id;
}

// The rendered order, read off the screen rather than out of the store: what the user sees
// is the whole claim being made here.
async function renderedOrder(page: Page, workspaceIds: string[]): Promise<string[]> {
  const placed = await Promise.all(
    workspaceIds.map(async (id) => ({ id, box: await workspaceRow(page, id).boundingBox() })),
  );
  return placed
    .filter((entry) => entry.box !== null)
    .sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0))
    .map((entry) => entry.id);
}

// dnd-kit's PointerSensor activates on a 250ms hold with an 8px tolerance, so the press has
// to sit still before it moves — a straight mouse.down/move/up never starts a drag at all.
async function dragWorkspaceOnto(page: Page, sourceId: string, targetId: string): Promise<void> {
  const source = await workspaceRow(page, sourceId).boundingBox();
  const target = await workspaceRow(page, targetId).boundingBox();
  if (!source || !target) {
    throw new Error("Cannot drag: a row is not on screen");
  }

  const x = source.x + source.width / 2;
  const from = source.y + source.height / 2;
  const to = target.y + target.height / 2;

  await page.mouse.move(x, from);
  await page.mouse.down();
  await page.waitForTimeout(400);
  // Several small steps: dnd-kit decides the drop target from where the pointer IS, and a
  // single jump can skip clean over the row we mean to land on.
  await page.mouse.move(x, to, { steps: 12 });
  await page.mouse.move(x, to, { steps: 2 });
  await page.mouse.up();
}

async function openWorkspaceMenu(page: Page, workspaceId: string): Promise<void> {
  const row = workspaceRow(page, workspaceId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();
  const menu = page.getByTestId(`sidebar-workspace-kebab-${workspaceKey(workspaceId)}`);
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await menu.click();
  const moveToGroup = page.getByTestId(
    `sidebar-workspace-menu-move-to-group-${workspaceKey(workspaceId)}`,
  );
  await expect(moveToGroup).toBeVisible({ timeout: 10_000 });
  await moveToGroup.click();
}

async function createWorkspaceGroup(page: Page, workspaceId: string, name: string): Promise<void> {
  await openWorkspaceMenu(page, workspaceId);
  await page.getByTestId(`sidebar-workspace-menu-new-group-${workspaceKey(workspaceId)}`).click();

  const modal = `sidebar-workspace-new-group-modal-${workspaceKey(workspaceId)}`;
  const input = page.getByTestId(`${modal}-input`);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(name);
  await page.getByTestId(`${modal}-submit`).click();
  await expect(input).toHaveCount(0, { timeout: 15_000 });
}

async function pinWorkspace(page: Page, workspaceId: string): Promise<void> {
  const row = workspaceRow(page, workspaceId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();
  const menu = page.getByTestId(`sidebar-workspace-kebab-${workspaceKey(workspaceId)}`);
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await menu.click();
  const pin = page.getByTestId(`sidebar-workspace-menu-pin-${workspaceKey(workspaceId)}`);
  await expect(pin).toBeVisible({ timeout: 10_000 });
  await pin.click();
}

// The remainder's header, distinct from its list (`…-list`) which shares the prefix.
function ungroupedWorkspaceHeader(page: Page) {
  return page.locator('[data-testid^="sidebar-workspace-no-group-"]:not([data-testid$="-list"])');
}

async function moveIntoExistingGroup(page: Page, workspaceId: string): Promise<void> {
  await openWorkspaceMenu(page, workspaceId);
  // The group's id is a uuid, so the row is addressed by prefix. There is exactly one group.
  const groupItem = page
    .locator(`[data-testid^="sidebar-workspace-menu-move-to-group-${workspaceKey(workspaceId)}-"]`)
    .first();
  await expect(groupItem).toBeVisible({ timeout: 10_000 });
  await groupItem.click();
}

test.describe("Sidebar workspace group drag", () => {
  test.describe.configure({ timeout: 180_000 });

  test("reorders two workspaces inside a group, in both directions, and the order survives a reload", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "group-drag-" });

    try {
      const first = seeded.workspaceId;
      const second = await seedSecondWorkspace(seeded, "Second");

      await gotoAppShell(page);
      await expect(workspaceRow(page, first)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, second)).toBeVisible({ timeout: 30_000 });

      await createWorkspaceGroup(page, first, "Review");
      await moveIntoExistingGroup(page, second);

      // Both are in the group now, in the order they were put there.
      await expect
        .poll(() => renderedOrder(page, [first, second]), { timeout: 15_000 })
        .toEqual([first, second]);

      // UPWARD: drag the second row onto the first.
      await dragWorkspaceOnto(page, second, first);
      await expect
        .poll(() => renderedOrder(page, [first, second]), { timeout: 15_000 })
        .toEqual([second, first]);

      // DOWNWARD: and back. A drop that only ever inserts BEFORE its target makes this a
      // silent no-op, which is exactly how it shipped the first time.
      await dragWorkspaceOnto(page, second, first);
      await expect
        .poll(() => renderedOrder(page, [first, second]), { timeout: 15_000 })
        .toEqual([first, second]);

      // The order is in the document, not just on the screen.
      await dragWorkspaceOnto(page, second, first);
      await expect
        .poll(() => renderedOrder(page, [first, second]), { timeout: 15_000 })
        .toEqual([second, first]);

      await page.reload();
      await expect(workspaceRow(page, first)).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => renderedOrder(page, [first, second]), { timeout: 15_000 })
        .toEqual([second, first]);
    } finally {
      await seeded?.cleanup();
    }
  });

  test("the ungrouped remainder is a collapsible section that remembers its state across a reload", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "ungrouped-collapse-" });

    try {
      const first = seeded.workspaceId;
      const second = await seedSecondWorkspace(seeded, "Second");

      await gotoAppShell(page);
      await expect(workspaceRow(page, first)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, second)).toBeVisible({ timeout: 30_000 });

      // Group only the first. The second stays in the remainder, which is what gives the
      // "Ungrouped" header something to sit over.
      await createWorkspaceGroup(page, first, "Review");

      const header = ungroupedWorkspaceHeader(page);
      await expect(header).toBeVisible({ timeout: 15_000 });
      // The ungrouped workspace renders like any other — it is a real row, not a footnote.
      await expect(workspaceRow(page, second)).toBeVisible();

      // Collapsing the header hides its rows, exactly like a group.
      await header.click();
      await expect(workspaceRow(page, second)).toHaveCount(0, { timeout: 10_000 });

      // Expanding brings them back.
      await header.click();
      await expect(workspaceRow(page, second)).toBeVisible({ timeout: 10_000 });

      // Collapsed, the state survives a reload — the same persistence a group's header has.
      await header.click();
      await expect(workspaceRow(page, second)).toHaveCount(0, { timeout: 10_000 });
      await page.reload();
      await expect(header).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, second)).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await seeded?.cleanup();
    }
  });
});

// The Pinned section carries its own order, separate from the order those same workspaces
// have inside their groups. It is the one drag that also works on native, because the
// section is a single flat list and owns its drag outright.
test.describe("Sidebar pinned order", () => {
  test.describe.configure({ timeout: 180_000 });

  test("pinned workspaces keep an arranged order that outlives a reload", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "pinned-order-" });

    try {
      const first = seeded.workspaceId;
      const second = await seedSecondWorkspace(seeded, "Second");

      await gotoAppShell(page);
      await expect(workspaceRow(page, first)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, second)).toBeVisible({ timeout: 30_000 });

      await pinWorkspace(page, first);
      await pinWorkspace(page, second);
      await expect(page.getByTestId("sidebar-pinned-section")).toBeVisible({ timeout: 15_000 });

      // Nobody has arranged them, so the newest pin leads — the behaviour the section had
      // before it carried an order at all.
      await expect
        .poll(() => renderedOrder(page, [first, second]), { timeout: 15_000 })
        .toEqual([second, first]);

      // Drag the older pin back to the top.
      await dragWorkspaceOnto(page, first, second);
      await expect
        .poll(() => renderedOrder(page, [first, second]), { timeout: 15_000 })
        .toEqual([first, second]);

      // The arrangement now beats pinned-at recency, and it came back from the daemon
      // rather than from this tab's memory.
      await page.reload();
      await expect(workspaceRow(page, first)).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => renderedOrder(page, [first, second]), { timeout: 15_000 })
        .toEqual([first, second]);
    } finally {
      await seeded?.cleanup();
    }
  });
});
