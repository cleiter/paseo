import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { createTempGitRepo } from "../support/helpers/workspace";

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
// `landing` picks which HALF of the target row to finish on. Which side the row lands on is
// read from the two rectangles, so aiming at the centre is aiming at the boundary.
async function dragRowOnto(
  page: Page,
  sourceTestId: string,
  targetTestId: string,
  landing: "centre" | "below" = "centre",
): Promise<void> {
  const source = await page.getByTestId(sourceTestId).boundingBox();
  const target = await page.getByTestId(targetTestId).boundingBox();
  if (!source || !target) {
    throw new Error("Cannot drag: a row is not on screen");
  }

  const x = source.x + source.width / 2;
  const from = source.y + source.height / 2;
  const to = target.y + target.height * (landing === "below" ? 0.9 : 0.5);

  await page.mouse.move(x, from);
  await page.mouse.down();
  await page.waitForTimeout(400);
  // Several small steps: dnd-kit decides the drop target from where the pointer IS, and a
  // single jump can skip clean over the row we mean to land on.
  await page.mouse.move(x, to, { steps: 12 });
  await page.mouse.move(x, to, { steps: 2 });
  await page.mouse.up();
}

function dragWorkspaceOnto(
  page: Page,
  sourceId: string,
  targetId: string,
  landing: "centre" | "below" = "centre",
): Promise<void> {
  return dragRowOnto(
    page,
    `sidebar-workspace-row-${workspaceKey(sourceId)}`,
    `sidebar-workspace-row-${workspaceKey(targetId)}`,
    landing,
  );
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

// Group headers, top to bottom. A group's rows are NOT nested inside its header in the DOM
// — the sidebar draws headers and rows as one flat list — so which group a row is in can
// only be read from where it sits between them.
async function groupHeaderTestIds(page: Page): Promise<string[]> {
  const headers = page.locator('[data-testid^="sidebar-workspace-group-"]');
  const placed = await Promise.all(
    (await headers.all()).map(async (header) => ({
      testId: await header.getAttribute("data-testid"),
      box: await header.boundingBox(),
    })),
  );
  return placed
    .filter((entry) => entry.testId !== null && entry.box !== null)
    .sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0))
    .map((entry) => entry.testId as string);
}

// Everything named, top to bottom, headers and rows in one sequence.
async function renderedSequence(page: Page, testIds: string[]): Promise<string[]> {
  const placed = await Promise.all(
    testIds.map(async (testId) => ({
      testId,
      box: await page.getByTestId(testId).boundingBox(),
    })),
  );
  return placed
    .filter((entry) => entry.box !== null)
    .sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0))
    .map((entry) => entry.testId);
}

// Project rows, top to bottom. A project's view key is a host-qualified path, so rows are
// found by prefix and named by the testid they turn out to have.
async function projectRowTestIds(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid^="sidebar-project-row-"]');
  const placed = await Promise.all(
    (await rows.all()).map(async (row) => ({
      testId: await row.getAttribute("data-testid"),
      box: await row.boundingBox(),
    })),
  );
  return placed
    .filter((entry) => entry.testId !== null && entry.box !== null)
    .sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0))
    .map((entry) => entry.testId as string);
}

function projectViewKey(projectRowTestId: string): string {
  return projectRowTestId.replace("sidebar-project-row-", "");
}

async function openProjectMenu(page: Page, projectRowTestId: string): Promise<void> {
  // Hover first: the menu is hover-to-show on web, exactly like a workspace row's.
  const row = page.getByTestId(projectRowTestId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();
  const menu = page.getByTestId(`sidebar-project-kebab-${projectViewKey(projectRowTestId)}`);
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await menu.click();
}

async function openProjectGroupSubmenu(page: Page, projectRowTestId: string): Promise<void> {
  await openProjectMenu(page, projectRowTestId);
  const viewKey = projectViewKey(projectRowTestId);
  const moveToGroup = page.getByTestId(`sidebar-project-menu-move-to-group-${viewKey}`);
  await expect(moveToGroup).toBeVisible({ timeout: 10_000 });
  await moveToGroup.click();
}

// Project groups are GLOBAL and live in the layout document, which one daemon serves to
// every test in a worker — so by the time a spec runs there may be groups left by earlier
// ones. Everything here therefore names the group it made by id, and never says "the
// first group".
async function projectGroupIds(page: Page): Promise<string[]> {
  const ids = await page
    .locator('[data-testid^="sidebar-project-group-"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid") ?? "").filter(Boolean),
    );
  return ids
    .filter((testId) => !testId.startsWith("sidebar-project-group-list-"))
    .filter((testId) => testId !== "sidebar-project-group-rename-modal")
    .map((testId) => testId.replace("sidebar-project-group-", ""));
}

// A project group, which nests the project one level deeper and gives the row drag a
// second, outer drag context to live inside. Returns the id of the group it created.
async function createProjectGroup(
  page: Page,
  projectRowTestId: string,
  name: string,
): Promise<string> {
  const before = new Set(await projectGroupIds(page));

  await openProjectGroupSubmenu(page, projectRowTestId);
  const viewKey = projectViewKey(projectRowTestId);
  await page.getByTestId(`sidebar-project-menu-new-group-${viewKey}`).click();

  const modal = `sidebar-project-new-group-modal-${viewKey}`;
  const input = page.getByTestId(`${modal}-input`);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(name);
  await page.getByTestId(`${modal}-submit`).click();
  await expect(input).toHaveCount(0, { timeout: 15_000 });

  let created: string | undefined;
  await expect
    .poll(
      async () => {
        created = (await projectGroupIds(page)).find((id) => !before.has(id));
        return created ?? null;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();
  return created as string;
}

async function moveProjectIntoExistingGroup(
  page: Page,
  projectRowTestId: string,
  groupId: string,
): Promise<void> {
  await openProjectGroupSubmenu(page, projectRowTestId);
  const groupItem = page.getByTestId(
    `sidebar-project-menu-move-to-group-${projectViewKey(projectRowTestId)}-${groupId}`,
  );
  await expect(groupItem).toBeVisible({ timeout: 10_000 });
  await groupItem.click();
}

// An EMPTY workspace group. Only the project menu can make one — every other route names a
// workspace, which would put something in it.
async function createEmptyWorkspaceGroup(
  page: Page,
  projectRowTestId: string,
  name: string,
): Promise<void> {
  await openProjectMenu(page, projectRowTestId);
  const viewKey = projectViewKey(projectRowTestId);
  await page.getByTestId(`sidebar-project-menu-new-workspace-group-${viewKey}`).click();

  const modal = `sidebar-project-new-workspace-group-modal-${viewKey}`;
  const input = page.getByTestId(`${modal}-input`);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(name);
  await page.getByTestId(`${modal}-submit`).click();
  await expect(input).toHaveCount(0, { timeout: 15_000 });
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

  // Reported from dogfooding: a row dragged into ANOTHER group could only ever land above
  // the row it arrived at. Getting it below meant dropping it there and dragging a second
  // time. Two separate causes, both invisible from a unit test: the first crossing always
  // inserted "before", and after that crossing the row's own data said it lived in the
  // target group, so every later hover read as an ordinary same-group drag and was ignored.
  test("drags a workspace UP into another group and drops it BELOW the row it aimed at", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "cross-group-drag-" });

    try {
      const first = seeded.workspaceId;
      const second = await seedSecondWorkspace(seeded, "Second");
      const third = await seedSecondWorkspace(seeded, "Third");

      await gotoAppShell(page);
      for (const id of [first, second, third]) {
        await expect(workspaceRow(page, id)).toBeVisible({ timeout: 30_000 });
      }

      // Active holds two rows, so there is a slot BETWEEN them to aim at; Review holds the
      // row that has to travel upward into it.
      await createWorkspaceGroup(page, first, "Active");
      await moveIntoExistingGroup(page, second);
      await createWorkspaceGroup(page, third, "Review");
      await expect
        .poll(() => renderedOrder(page, [first, second, third]), { timeout: 15_000 })
        .toEqual([first, second, third]);

      // Up into Active, aiming at the lower half of its first row.
      await dragWorkspaceOnto(page, third, first, "below");
      await expect
        .poll(() => renderedOrder(page, [first, second, third]), { timeout: 15_000 })
        .toEqual([first, third, second]);

      // And it is in the document, not only on the screen.
      await page.reload();
      await expect(workspaceRow(page, first)).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => renderedOrder(page, [first, second, third]), { timeout: 15_000 })
        .toEqual([first, third, second]);
    } finally {
      await seeded?.cleanup();
    }
  });

  // The same gesture aimed at a group holding ONE row. The slot below a lone row is not the
  // slot between two: there is no row beneath it to displace, so nothing on screen moves
  // even when the position is right, and the group's own header is the next thing under the
  // pointer.
  test("drags a workspace UP into a group holding a single row and lands below it", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "lone-row-drag-" });

    try {
      const first = seeded.workspaceId;
      const second = await seedSecondWorkspace(seeded, "Second");

      await gotoAppShell(page);
      await expect(workspaceRow(page, first)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, second)).toBeVisible({ timeout: 30_000 });

      await createWorkspaceGroup(page, first, "Active");
      await createWorkspaceGroup(page, second, "Review");

      const [activeHeader, reviewHeader] = await groupHeaderTestIds(page);
      const rowA = `sidebar-workspace-row-${workspaceKey(first)}`;
      const rowB = `sidebar-workspace-row-${workspaceKey(second)}`;
      const everything = [activeHeader, reviewHeader, rowA, rowB].filter(
        (id): id is string => id !== undefined,
      );
      expect(everything).toHaveLength(4);

      // One row under each header.
      await expect
        .poll(() => renderedSequence(page, everything), { timeout: 15_000 })
        .toEqual([activeHeader, rowA, reviewHeader, rowB]);

      // Both rows under Active, in that order — and Review left empty behind them. Order
      // alone cannot tell this apart from the starting state, which is why the headers are
      // in the sequence.
      await dragWorkspaceOnto(page, second, first, "below");
      await expect
        .poll(() => renderedSequence(page, everything), { timeout: 15_000 })
        .toEqual([activeHeader, rowA, rowB, reviewHeader]);
    } finally {
      await seeded?.cleanup();
    }
  });

  // Reported from dogfooding, and the earlier two-row test did NOT catch it: the sidebar it
  // was reported against nests the project inside a PROJECT group and carries an empty
  // workspace group as well. Both change what the drag is happening inside, so the fixture
  // rebuilds that shape rather than the minimum one.
  test("moves the top row of a group down past the row below it, in that shape", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "nested-reorder-" });

    try {
      const a = seeded.workspaceId;
      const b = await seedSecondWorkspace(seeded, "B");
      const c = await seedSecondWorkspace(seeded, "C");

      await gotoAppShell(page);
      for (const id of [a, b, c]) {
        await expect(workspaceRow(page, id)).toBeVisible({ timeout: 30_000 });
      }

      const [projectRow] = await projectRowTestIds(page);
      if (!projectRow) {
        throw new Error("Expected a project row");
      }
      await createProjectGroup(page, projectRow, "Open Source");
      await createWorkspaceGroup(page, a, "Active Development");
      await moveIntoExistingGroup(page, b);
      await createEmptyWorkspaceGroup(page, projectRow, "In Review");
      await createWorkspaceGroup(page, c, "Experiments");

      // The fixture is elaborate enough to fail silently, so it says what it built: the
      // project sits in a project group, and it has three workspace groups, one empty.
      await expect(page.locator('[data-testid^="sidebar-project-group-"]').first()).toBeVisible({
        timeout: 15_000,
      });
      await expect.poll(() => groupHeaderTestIds(page), { timeout: 15_000 }).toHaveLength(3);
      await expect
        .poll(() => renderedOrder(page, [a, b, c]), { timeout: 15_000 })
        .toEqual([a, b, c]);

      // DOWNWARD, within one group: A onto B. The direction that was reported dead.
      await dragWorkspaceOnto(page, a, b, "below");
      await expect
        .poll(() => renderedOrder(page, [a, b, c]), { timeout: 15_000 })
        .toEqual([b, a, c]);
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

// PROJECT rows inside a project group, which is a different drag from every test above:
// those all move workspace rows within a project. Reported from dogfooding — the top
// project would not move down past the one below it, while the reverse worked.
test.describe("Sidebar project group drag", () => {
  test.describe.configure({ timeout: 180_000 });

  test("moves the top project of a group down past the project below it", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "proj-order-a-" });
    const secondRepo = await createTempGitRepo("proj-order-b-");

    try {
      const added = await seeded.client.addProject(secondRepo.path);
      if (!added.project) {
        throw new Error(added.error ?? "Failed to add the second project");
      }

      await gotoAppShell(page);
      await expect(page.locator('[data-testid^="sidebar-project-row-"]')).toHaveCount(2, {
        timeout: 30_000,
      });
      const [firstRow, secondRow] = await projectRowTestIds(page);
      if (!firstRow || !secondRow) {
        throw new Error("Expected two project rows");
      }

      // Both projects in one group, so the drag is a reorder inside it rather than a move
      // between groups.
      const groupId = await createProjectGroup(page, firstRow, "Open Source");
      await moveProjectIntoExistingGroup(page, secondRow, groupId);

      // Which one ended up on top is the layout document's business, not this test's — it
      // only claims that whichever IS on top can be dragged below the other.
      await expect
        .poll(() => renderedSequence(page, [firstRow, secondRow]), { timeout: 15_000 })
        .toHaveLength(2);
      const [top, bottom] = await renderedSequence(page, [firstRow, secondRow]);
      if (!top || !bottom) {
        throw new Error("Expected both projects on screen");
      }

      await dragRowOnto(page, top, bottom, "below");
      await expect
        .poll(() => renderedSequence(page, [top, bottom]), { timeout: 15_000 })
        .toEqual([bottom, top]);

      // And it survives, so this is the document and not a transform left on screen.
      await page.reload();
      await expect(page.getByTestId(bottom)).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => renderedSequence(page, [top, bottom]), { timeout: 15_000 })
        .toEqual([bottom, top]);
    } finally {
      await seeded?.cleanup();
      await secondRepo.cleanup();
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
