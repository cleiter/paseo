import { describe, expect, it } from "vitest";
import type { SidebarLayout } from "@getpaseo/protocol/messages";
import { EMPTY_SIDEBAR_LAYOUT, pickWinningLayout, planLayoutRepairs } from "@/data/sidebar-layout";
import { resolvePendingLayout } from "@/data/sidebar-layout-pending";
import {
  adoptVisibleProjectKeys,
  adoptVisibleWorkspaceKeys,
  createProjectGroup,
  createWorkspaceGroup,
  deleteProjectGroup,
  deleteWorkspaceGroup,
  moveProjectToGroup,
  moveWorkspaceToGroup,
  renameProjectGroup,
  reorderProjectGroups,
  reorderProjectsInGroup,
  reorderWorkspacesInGroup,
  setPinnedWorkspaceOrder,
  setWorkspaceKeysInGroup,
} from "./sidebar-layout-edits";

function layout(overrides: Partial<SidebarLayout> = {}): SidebarLayout {
  return { ...EMPTY_SIDEBAR_LAYOUT, revision: 1, ...overrides };
}

describe("sidebar layout edits", () => {
  it("creates a group with nothing in it", () => {
    const next = createProjectGroup(layout(), { id: "g1", name: "Work" });

    expect(next.projectGroups).toEqual([{ id: "g1", name: "Work", projectKeys: [] }]);
  });

  it("renames a group without touching its members", () => {
    const before = layout({
      projectGroups: [{ id: "g1", name: "Work", projectKeys: ["a", "b"] }],
    });

    const next = renameProjectGroup(before, { id: "g1", name: "Client work" });

    expect(next.projectGroups[0]?.name).toBe("Client work");
    expect(next.projectGroups[0]?.projectKeys).toEqual(["a", "b"]);
  });

  it("returns a deleted group's members to ungrouped instead of dropping them", () => {
    const before = layout({
      projectGroups: [{ id: "g1", name: "Work", projectKeys: ["a", "b"] }],
      ungroupedProjectKeys: ["c"],
    });

    const next = deleteProjectGroup(before, "g1");

    expect(next.projectGroups).toEqual([]);
    // Deleting a GROUP must never delete the PROJECTS.
    expect(next.ungroupedProjectKeys).toEqual(["c", "a", "b"]);
  });

  it("reorders groups and keeps any it was not told about", () => {
    const before = layout({
      projectGroups: [
        { id: "g1", name: "Work", projectKeys: [] },
        { id: "g2", name: "Personal", projectKeys: [] },
        { id: "g3", name: "Archive", projectKeys: [] },
      ],
    });

    // A drag only knows about the groups it can see. The ones it does not mention must
    // survive rather than silently vanish.
    const next = reorderProjectGroups(before, ["g3", "g1"]);

    expect(next.projectGroups.map((group) => group.id)).toEqual(["g3", "g1", "g2"]);
  });

  it("keeps a project in exactly one place when it moves between groups", () => {
    const before = layout({
      projectGroups: [
        { id: "g1", name: "Work", projectKeys: ["a"] },
        { id: "g2", name: "Personal", projectKeys: [] },
      ],
    });

    const next = moveProjectToGroup(before, { projectKey: "a", groupId: "g2" });

    expect(next.projectGroups[0]?.projectKeys).toEqual([]);
    expect(next.projectGroups[1]?.projectKeys).toEqual(["a"]);
    expect(next.ungroupedProjectKeys).toEqual([]);
  });

  it("reorders a row DOWNWARD, not just upward", () => {
    // The bug this exists for: a drop names the row it landed on, and inserting "before"
    // that row makes a downward drag a no-op. Drag w1 onto w2, insert before w2, and you
    // get [w1, w2] straight back — the row visibly snaps home and nothing is saved.
    const before = layout({
      workspaceGroups: [
        { id: "wg1", name: "In review", projectKey: "p1", workspaceKeys: ["w1", "w2"] },
      ],
    });

    const down = moveWorkspaceToGroup(before, {
      projectKey: "p1",
      workspaceKey: "w1",
      groupId: "wg1",
      beforeKey: "w2",
    });
    expect(down.workspaceGroups[0]?.workspaceKeys).toEqual(["w2", "w1"]);

    // And upward still works.
    const up = moveWorkspaceToGroup(down, {
      projectKey: "p1",
      workspaceKey: "w1",
      groupId: "wg1",
      beforeKey: "w2",
    });
    expect(up.workspaceGroups[0]?.workspaceKeys).toEqual(["w1", "w2"]);
  });

  it("reorders downward in the ungrouped remainder too", () => {
    const before = layout({ ungroupedWorkspaceKeysByProject: { p1: ["w1", "w2", "w3"] } });

    const next = moveWorkspaceToGroup(before, {
      projectKey: "p1",
      workspaceKey: "w1",
      groupId: null,
      beforeKey: "w3",
    });

    expect(next.ungroupedWorkspaceKeysByProject.p1).toEqual(["w2", "w3", "w1"]);
  });

  it("drops a project into the slot it was dropped on", () => {
    const before = layout({
      projectGroups: [{ id: "g1", name: "Work", projectKeys: ["a", "b", "c"] }],
    });

    const next = moveProjectToGroup(before, { projectKey: "c", groupId: "g1", beforeKey: "b" });

    expect(next.projectGroups[0]?.projectKeys).toEqual(["a", "c", "b"]);
  });

  it("moves a project out of every group when it is ungrouped", () => {
    const before = layout({
      projectGroups: [{ id: "g1", name: "Work", projectKeys: ["a"] }],
    });

    const next = moveProjectToGroup(before, { projectKey: "a", groupId: null });

    expect(next.projectGroups[0]?.projectKeys).toEqual([]);
    expect(next.ungroupedProjectKeys).toEqual(["a"]);
  });

  it("scopes a workspace move to its own project", () => {
    const before = layout({
      workspaceGroups: [
        { id: "wg1", name: "In review", projectKey: "p1", workspaceKeys: ["w1"] },
        { id: "wg2", name: "In review", projectKey: "p2", workspaceKeys: ["w2"] },
      ],
    });

    const next = moveWorkspaceToGroup(before, {
      projectKey: "p1",
      workspaceKey: "w1",
      groupId: null,
    });

    expect(next.workspaceGroups[0]?.workspaceKeys).toEqual([]);
    // The identically-named group in the other project must be untouched.
    expect(next.workspaceGroups[1]?.workspaceKeys).toEqual(["w2"]);
    expect(next.ungroupedWorkspaceKeysByProject.p1).toEqual(["w1"]);
  });

  it("returns a deleted workspace group's members to its own project's ungrouped list", () => {
    const before = layout({
      workspaceGroups: [
        { id: "wg1", name: "In review", projectKey: "p1", workspaceKeys: ["w1", "w2"] },
      ],
    });

    const next = deleteWorkspaceGroup(before, "wg1");

    expect(next.workspaceGroups).toEqual([]);
    expect(next.ungroupedWorkspaceKeysByProject.p1).toEqual(["w1", "w2"]);
  });

  it("writes a reordered list straight back", () => {
    // What a drag actually produces. Every list the sidebar draws IS a document array,
    // so the drag can hand its list back whole — there is no merge step and no second
    // ordering to keep in step, which is what the old local order store required.
    const before = layout({
      workspaceGroups: [
        { id: "wg1", name: "In review", projectKey: "p1", workspaceKeys: ["w1", "w2", "w3"] },
      ],
    });

    const next = setWorkspaceKeysInGroup(before, {
      projectKey: "p1",
      groupId: "wg1",
      workspaceKeys: ["w3", "w1", "w2"],
    });

    expect(next.workspaceGroups[0]?.workspaceKeys).toEqual(["w3", "w1", "w2"]);
  });

  it("reorders the ungrouped remainder, which is just another list", () => {
    const before = layout({ ungroupedWorkspaceKeysByProject: { p1: ["w1", "w2"] } });

    const next = setWorkspaceKeysInGroup(before, {
      projectKey: "p1",
      groupId: null,
      workspaceKeys: ["w2", "w1"],
    });

    expect(next.ungroupedWorkspaceKeysByProject.p1).toEqual(["w2", "w1"]);
  });

  it("appends to the end when a row is dropped on a group header", () => {
    // Dropping on the header names a group but no position inside it. This is the only
    // way to fill a group that is still empty — it has no rows to drop between.
    const before = layout({
      workspaceGroups: [
        { id: "wg1", name: "Empty", projectKey: "p1", workspaceKeys: [] },
        { id: "wg2", name: "Full", projectKey: "p1", workspaceKeys: ["w1"] },
      ],
    });

    const next = moveWorkspaceToGroup(before, {
      projectKey: "p1",
      workspaceKey: "w1",
      groupId: "wg1",
      beforeKey: null,
    });

    expect(next.workspaceGroups[0]?.workspaceKeys).toEqual(["w1"]);
    expect(next.workspaceGroups[1]?.workspaceKeys).toEqual([]);
  });

  it("never creates the same group twice", () => {
    // It appeared twice in the sidebar. The commit path was applying the recipe to its own
    // result, which is invisible for a rename or a move — they are idempotent — and
    // duplicates a create. That path is fixed; this makes the shape impossible anyway.
    const once = createWorkspaceGroup(layout(), {
      id: "wg1",
      name: "Spikes",
      projectKey: "p1",
    });
    const twice = createWorkspaceGroup(once, { id: "wg1", name: "Spikes", projectKey: "p1" });

    expect(twice.workspaceGroups).toHaveLength(1);
    expect(twice).toBe(once);

    const project = createProjectGroup(layout(), { id: "g1", name: "Work" });
    expect(createProjectGroup(project, { id: "g1", name: "Work" }).projectGroups).toHaveLength(1);
  });

  it("creates an empty workspace group scoped to a project", () => {
    const next = createWorkspaceGroup(layout(), { id: "wg1", name: "Spikes", projectKey: "p1" });

    expect(next.workspaceGroups).toEqual([
      { id: "wg1", name: "Spikes", projectKey: "p1", workspaceKeys: [] },
    ]);
  });
});

describe("resolvePendingLayout", () => {
  it("shows the optimistic layout while it is ahead of the hosts", () => {
    // Why it exists: React Query notifies observers on a macrotask, so the confirmed
    // layout lands AFTER the browser paints. Without this the dropped row is painted once
    // in its old position — a visible flash.
    const confirmed = layout({ revision: 4 });
    const optimistic = layout({ revision: 5 });

    expect(resolvePendingLayout(confirmed, optimistic).revision).toBe(5);
  });

  it("drops the optimistic layout the moment the hosts catch up", () => {
    const confirmed = layout({ revision: 5 });
    const optimistic = layout({ revision: 5 });

    expect(resolvePendingLayout(confirmed, optimistic).revision).toBe(5);
    expect(resolvePendingLayout(confirmed, optimistic)).toBe(confirmed);
  });

  it("lets a newer document from another device beat an in-flight edit", () => {
    // A failed write must not leave the sidebar showing an order nobody stored, and a
    // remote edit must not be masked by a local one that lost.
    const confirmed = layout({ revision: 9 });
    const optimistic = layout({ revision: 6 });

    expect(resolvePendingLayout(confirmed, optimistic)).toBe(confirmed);
  });

  it("falls back to confirmed when nothing is in flight", () => {
    const confirmed = layout({ revision: 2 });

    expect(resolvePendingLayout(confirmed, null)).toBe(confirmed);
  });
});

describe("pickWinningLayout", () => {
  it("takes the highest revision", () => {
    const winner = pickWinningLayout([
      { serverId: "a", layout: layout({ revision: 3 }) },
      { serverId: "b", layout: layout({ revision: 7 }) },
    ]);

    expect(winner.revision).toBe(7);
  });

  it("ignores hosts that have not answered yet", () => {
    const winner = pickWinningLayout([
      { serverId: "a", layout: null },
      { serverId: "b", layout: layout({ revision: 2 }) },
    ]);

    expect(winner.revision).toBe(2);
  });

  it("is empty when no host has a layout", () => {
    expect(pickWinningLayout([{ serverId: "a", layout: null }])).toEqual(EMPTY_SIDEBAR_LAYOUT);
  });

  it("breaks a tie the same way on every device", () => {
    // Two hosts edited concurrently while they could not see each other. Which one wins
    // matters less than that EVERY device picks the same one — otherwise two clients
    // would heal each other in opposite directions, forever.
    const entries = [
      { serverId: "b", layout: layout({ revision: 4, updatedAt: "2026-07-14T10:00:00.000Z" }) },
      { serverId: "a", layout: layout({ revision: 4, updatedAt: "2026-07-14T12:00:00.000Z" }) },
    ];

    expect(pickWinningLayout(entries).updatedAt).toBe("2026-07-14T12:00:00.000Z");
    expect(pickWinningLayout(entries.toReversed()).updatedAt).toBe("2026-07-14T12:00:00.000Z");
  });
});

describe("planLayoutRepairs", () => {
  it("catches a host up at the winner's own revision", () => {
    const winner = layout({ revision: 5 });
    const repairs = planLayoutRepairs(
      [
        { serverId: "a", layout: winner },
        { serverId: "b", layout: layout({ revision: 2 }) },
      ],
      winner,
    );

    expect(repairs).toEqual([{ serverId: "b", layout: winner, expectedRevision: 2 }]);
  });

  it("leaves hosts alone when every one of them already holds the winner", () => {
    const winner = layout({ revision: 5 });

    expect(
      planLayoutRepairs(
        [
          { serverId: "a", layout: winner },
          { serverId: "b", layout: { ...winner } },
        ],
        winner,
      ),
    ).toEqual([]);
  });

  it("republishes one revision ahead when two hosts diverged at the SAME revision", () => {
    // The failure this exists for: the client assigns the revision, so two daemons edited
    // while they could not see each other both land on 4 holding different documents.
    // pickWinningLayout chooses between them, but choosing is not healing — the loser is
    // not BEHIND, so a revision comparison alone never repairs it, and the daemon refuses
    // a write that does not move the document forward, so pushing the winner at 4 would be
    // rejected as stale. They would sit diverged until the user happened to edit again.
    const winner = layout({
      revision: 4,
      updatedAt: "2026-07-14T12:00:00.000Z",
      ungroupedProjectKeys: ["paseo", "other"],
    });
    const loser = layout({
      revision: 4,
      updatedAt: "2026-07-14T10:00:00.000Z",
      ungroupedProjectKeys: ["other", "paseo"],
    });

    const repairs = planLayoutRepairs(
      [
        { serverId: "a", layout: winner },
        { serverId: "b", layout: loser },
      ],
      winner,
    );

    // Every host, the winner's own included, is now strictly behind ONE new target, so a
    // single pass converges them.
    expect(repairs.map((repair) => [repair.serverId, repair.expectedRevision])).toEqual([
      ["a", 4],
      ["b", 4],
    ]);
    expect(repairs.every((repair) => repair.layout.revision === 5)).toBe(true);
    expect(
      repairs.every((repair) => repair.layout.ungroupedProjectKeys === winner.ungroupedProjectKeys),
    ).toBe(true);
  });

  it("carries the winner's updatedAt into the republish rather than restamping it", () => {
    // Two devices can be repairing the same divergence at the same moment. If each
    // stamped its own time, they would produce two DIFFERENT documents at revision 5 —
    // the repair would be a fresh divergence, and it would never settle.
    const winner = layout({
      revision: 4,
      updatedAt: "2026-07-14T12:00:00.000Z",
      ungroupedProjectKeys: ["paseo"],
    });
    const loser = layout({ revision: 4, updatedAt: "2026-07-14T10:00:00.000Z" });

    const repairs = planLayoutRepairs(
      [
        { serverId: "a", layout: winner },
        { serverId: "b", layout: loser },
      ],
      winner,
    );

    expect(repairs[0]?.layout.updatedAt).toBe("2026-07-14T12:00:00.000Z");
  });

  it("does not mistake key order in the by-project record for a divergence", () => {
    // Array order IS the sidebar's order, so a reordered array is a real difference. The
    // by-project RECORD has no order — two hosts can serialize the same map either way,
    // and treating that as divergence would republish forever.
    const winner = layout({
      revision: 3,
      ungroupedWorkspaceKeysByProject: { paseo: ["a"], other: ["b"] },
    });
    const sameContent = layout({
      revision: 3,
      ungroupedWorkspaceKeysByProject: { other: ["b"], paseo: ["a"] },
    });

    expect(
      planLayoutRepairs(
        [
          { serverId: "a", layout: winner },
          { serverId: "b", layout: sameContent },
        ],
        winner,
      ),
    ).toEqual([]);
  });

  it("plans nothing when no device has ever written a layout", () => {
    expect(
      planLayoutRepairs(
        [
          { serverId: "a", layout: null },
          { serverId: "b", layout: null },
        ],
        EMPTY_SIDEBAR_LAYOUT,
      ),
    ).toEqual([]);
  });
});

describe("pinned workspace order", () => {
  it("is a SEPARATE order that leaves the workspace in its group", () => {
    // The whole reason pinned order is its own list: a pinned workspace has a place at the
    // top AND a place in its group, and unpinning has to put it back in the latter. If
    // arranging the pins moved anything in the group, unpinning would drop the row
    // somewhere the user never put it.
    const before = layout({
      workspaceGroups: [
        { id: "g1", name: "In review", projectKey: "p1", workspaceKeys: ["w1", "w2"] },
      ],
      pinnedWorkspaceKeys: ["w1", "w2"],
    });

    const next = setPinnedWorkspaceOrder(before, { orderedVisibleKeys: ["w2", "w1"] });

    expect(next.pinnedWorkspaceKeys).toEqual(["w2", "w1"]);
    expect(next.workspaceGroups[0]?.workspaceKeys).toEqual(["w1", "w2"]);
  });

  it("keeps a pin whose host is offline, rather than dropping it", () => {
    // An offline host's pins are not on screen, so the drag hands back a list without them.
    // Writing that verbatim would quietly delete their order.
    const before = layout({ pinnedWorkspaceKeys: ["visible1", "offline", "visible2"] });

    const next = setPinnedWorkspaceOrder(before, {
      orderedVisibleKeys: ["visible2", "visible1"],
    });

    expect(next.pinnedWorkspaceKeys).toContain("offline");
    // The visible rows permute among the slots they already held; the offline pin keeps its.
    expect(next.pinnedWorkspaceKeys).toEqual(["visible2", "offline", "visible1"]);
  });

  it("adopts the whole order on the first arrangement, when nothing is stored yet", () => {
    const next = setPinnedWorkspaceOrder(layout(), { orderedVisibleKeys: ["b", "a", "c"] });

    expect(next.pinnedWorkspaceKeys).toEqual(["b", "a", "c"]);
  });

  it("anchors a freshly pinned row once the user arranges around it", () => {
    // The fresh pin floats at the top until someone drags; that drag is what commits it to
    // the stored order.
    const before = layout({ pinnedWorkspaceKeys: ["a", "b"] });

    const next = setPinnedWorkspaceOrder(before, { orderedVisibleKeys: ["a", "fresh", "b"] });

    expect(next.pinnedWorkspaceKeys).toEqual(["a", "fresh", "b"]);
  });

  it("reorders a workspace group from its full visible list, unchanged from a wholesale write", () => {
    const before = layout({
      workspaceGroups: [
        { id: "g1", name: "In review", projectKey: "p", workspaceKeys: ["a", "b", "c"] },
      ],
    });

    const next = reorderWorkspacesInGroup(before, {
      projectKey: "p",
      groupId: "g1",
      orderedVisibleKeys: ["c", "a", "b"],
    });

    expect(next.workspaceGroups[0]?.workspaceKeys).toEqual(["c", "a", "b"]);
  });

  it("keeps the rows past a capped group's window when only the visible ones are dragged", () => {
    // A long group renders its first window and hides the tail behind "show more". The drag
    // hands back only the visible rows; writing that verbatim would eject the tail into
    // Ungrouped. The reorder must fold the visible permutation into the stored order.
    const before = layout({
      workspaceGroups: [
        { id: "g1", name: "In review", projectKey: "p", workspaceKeys: ["a", "b", "c", "d", "e"] },
      ],
    });

    // Only a, b, c are on screen; the user swaps a and c.
    const next = reorderWorkspacesInGroup(before, {
      projectKey: "p",
      groupId: "g1",
      orderedVisibleKeys: ["c", "b", "a"],
    });

    // Visible rows permute inside the slots they held; d and e stay in the group, in place.
    expect(next.workspaceGroups[0]?.workspaceKeys).toEqual(["c", "b", "a", "d", "e"]);
  });

  it("reorders the ungrouped workspace remainder without touching any group", () => {
    const before = layout({
      workspaceGroups: [{ id: "g1", name: "In review", projectKey: "p", workspaceKeys: ["x"] }],
      ungroupedWorkspaceKeysByProject: { p: ["a", "b", "c", "d"] },
    });

    // a, b visible (capped), swapped; c, d hidden.
    const next = reorderWorkspacesInGroup(before, {
      projectKey: "p",
      groupId: null,
      orderedVisibleKeys: ["b", "a"],
    });

    expect(next.ungroupedWorkspaceKeysByProject.p).toEqual(["b", "a", "c", "d"]);
    expect(next.workspaceGroups[0]?.workspaceKeys).toEqual(["x"]);
  });

  it("keeps the projects past a capped project group's window when the visible ones are dragged", () => {
    const before = layout({
      projectGroups: [{ id: "g1", name: "Work", projectKeys: ["a", "b", "c", "d"] }],
    });

    const next = reorderProjectsInGroup(before, {
      groupId: "g1",
      orderedVisibleKeys: ["b", "a"],
    });

    expect(next.projectGroups[0]?.projectKeys).toEqual(["b", "a", "c", "d"]);
  });

  it("reorders the ungrouped project remainder and keeps its hidden tail", () => {
    const before = layout({ ungroupedProjectKeys: ["a", "b", "c", "d"] });

    const next = reorderProjectsInGroup(before, {
      groupId: null,
      orderedVisibleKeys: ["c", "a", "b"],
    });

    expect(next.ungroupedProjectKeys).toEqual(["c", "a", "b", "d"]);
  });
});

// The document only holds rows some device has written into it. Everything created since —
// a new project, a workspace made an hour ago — renders anyway, because the projection
// leaves keys it does not recognise where it found them. That gap is invisible until a
// drag: positioning is index arithmetic over the STORED list, so two rows the document has
// never seen cannot be ordered against each other, and the drop appears to do nothing.
describe("adopting rows the document has never seen", () => {
  it("splices a missing row in next to the row it is drawn beside", () => {
    const before = layout({ ungroupedProjectKeys: ["a", "c"] });

    const next = adoptVisibleProjectKeys(before, {
      groupId: null,
      visibleKeys: ["a", "b", "c"],
    });

    expect(next.ungroupedProjectKeys).toEqual(["a", "b", "c"]);
  });

  it("keeps stored rows that are NOT on screen in their slots", () => {
    // `offline` belongs to a host that is not connected right now, so it does not render.
    // Overwriting the list with what is visible would silently drop it.
    const before = layout({ ungroupedProjectKeys: ["a", "offline", "c"] });

    const next = adoptVisibleProjectKeys(before, {
      groupId: null,
      visibleKeys: ["a", "c", "d"],
    });

    expect(next.ungroupedProjectKeys).toEqual(["a", "offline", "c", "d"]);
  });

  it("puts a row with nothing above it ahead of the row below it", () => {
    const before = layout({ ungroupedProjectKeys: ["b"] });

    const next = adoptVisibleProjectKeys(before, { groupId: null, visibleKeys: ["a", "b"] });

    expect(next.ungroupedProjectKeys).toEqual(["a", "b"]);
  });

  it("leaves a row the document files under another group alone", () => {
    const before = layout({
      projectGroups: [{ id: "g1", name: "Work", projectKeys: ["a"] }],
      ungroupedProjectKeys: ["b"],
    });

    const next = adoptVisibleProjectKeys(before, { groupId: null, visibleKeys: ["a", "b"] });

    expect(next.ungroupedProjectKeys).toEqual(["b"]);
    expect(next.projectGroups[0]?.projectKeys).toEqual(["a"]);
  });

  it("returns the same document when there is nothing to adopt", () => {
    const before = layout({ ungroupedProjectKeys: ["a", "b"] });

    expect(adoptVisibleProjectKeys(before, { groupId: null, visibleKeys: ["a", "b"] })).toBe(
      before,
    );
  });

  it("adopts into one group without disturbing another", () => {
    const before = layout({
      workspaceGroups: [
        { id: "g1", name: "Review", projectKey: "p", workspaceKeys: ["w1"] },
        { id: "g2", name: "Done", projectKey: "p", workspaceKeys: ["w9"] },
      ],
    });

    const next = adoptVisibleWorkspaceKeys(before, {
      projectKey: "p",
      groupId: "g1",
      visibleKeys: ["w1", "w2"],
    });

    expect(next.workspaceGroups[0]?.workspaceKeys).toEqual(["w1", "w2"]);
    expect(next.workspaceGroups[1]?.workspaceKeys).toEqual(["w9"]);
  });

  // The regression the e2e caught: two projects added after the last layout write, dragged
  // one past the other. Without adoption the drop resolves to "append", the projection
  // prunes the key it cannot place, and the sidebar snaps back to the order it started in.
  it("lets a drop reorder two rows the document has never seen", () => {
    const before = layout({ revision: 7, ungroupedProjectKeys: ["written-long-ago"] });

    const adopted = adoptVisibleProjectKeys(before, {
      groupId: null,
      visibleKeys: ["first", "second"],
    });
    const next = moveProjectToGroup(adopted, {
      projectKey: "first",
      groupId: null,
      beforeKey: "second",
    });

    expect(next.ungroupedProjectKeys).toEqual(["written-long-ago", "second", "first"]);
  });
});
