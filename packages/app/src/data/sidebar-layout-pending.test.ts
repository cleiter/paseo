import { afterEach, describe, expect, it } from "vitest";
import type { SidebarLayout } from "@getpaseo/protocol/messages";
import { EMPTY_SIDEBAR_LAYOUT } from "@/data/sidebar-layout";
import {
  clearPendingSidebarLayout,
  getPendingSidebarLayout,
  setPendingSidebarLayout,
} from "@/data/sidebar-layout-pending";

function layout(revision: number): SidebarLayout {
  return { ...EMPTY_SIDEBAR_LAYOUT, revision };
}

afterEach(() => {
  setPendingSidebarLayout(null);
});

describe("pending sidebar layout ownership", () => {
  it("lets an edit clear the layout it published", () => {
    const token = setPendingSidebarLayout(layout(4));

    clearPendingSidebarLayout(token);

    expect(getPendingSidebarLayout()).toBeNull();
  });

  it("does not let a settled edit clear a NEWER edit's layout", () => {
    // The snapback: two edits overlap, and writes settle in whatever order the network
    // returns them. The first edit finishing used to wipe the second one's optimistic
    // state while its write was still on the wire, so the sidebar dropped back to the
    // confirmed document and showed the newer change undone until it landed.
    const first = setPendingSidebarLayout(layout(4));
    const second = setPendingSidebarLayout(layout(5));

    clearPendingSidebarLayout(first);

    expect(getPendingSidebarLayout()?.revision).toBe(5);

    clearPendingSidebarLayout(second);

    expect(getPendingSidebarLayout()).toBeNull();
  });

  it("does not let a settled edit clear a drag preview that started after it", () => {
    // Same hazard, different pairing: a preview is published the same way, and an edit
    // settling mid-drag would take the gap out from under the cursor.
    const edit = setPendingSidebarLayout(layout(4));
    setPendingSidebarLayout(layout(5));

    clearPendingSidebarLayout(edit);

    expect(getPendingSidebarLayout()?.revision).toBe(5);
  });

  it("is a no-op once something else has already cleared it", () => {
    const token = setPendingSidebarLayout(layout(4));
    setPendingSidebarLayout(null);

    clearPendingSidebarLayout(token);

    expect(getPendingSidebarLayout()).toBeNull();
  });
});
