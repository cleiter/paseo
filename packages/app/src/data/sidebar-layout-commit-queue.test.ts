import { describe, expect, it } from "vitest";
import { enqueueSidebarLayoutCommit } from "@/data/sidebar-layout-commit-queue";

// A commit that finishes when the test says so, so overlap is deterministic rather than
// a matter of which timer fires first.
function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve = (): void => {};
  let reject = (): void => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = () => {
      res();
    };
    reject = () => {
      rej(new Error("commit failed"));
    };
  });
  return { promise, resolve, reject };
}

describe("sidebar layout commit queue", () => {
  it("does not start a commit while one is still in flight", async () => {
    // The false conflict: the daemon assigns the new revision only after its persist
    // resolves, so a second write sent before the first returns reads the pre-first
    // revision and is refused as stale — with a correct expectedRevision.
    const first = deferred();
    const started: string[] = [];

    const firstDone = enqueueSidebarLayoutCommit(() => {
      started.push("first");
      return first.promise;
    });
    const secondDone = enqueueSidebarLayoutCommit(() => {
      started.push("second");
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(started).toEqual(["first"]);

    first.resolve();
    await Promise.all([firstDone, secondDone]);

    expect(started).toEqual(["first", "second"]);
  });

  it("runs commits in the order they were made", async () => {
    const order: number[] = [];
    const record = async (index: number): Promise<void> => {
      // Yields first, so a queue that fanned out instead of chaining would interleave.
      await Promise.resolve();
      order.push(index);
    };

    const commits: Promise<void>[] = [];
    for (const index of [0, 1, 2]) {
      commits.push(enqueueSidebarLayoutCommit(() => record(index)));
    }
    await Promise.all(commits);

    expect(order).toEqual([0, 1, 2]);
  });

  it("lets the next commit through when one fails", async () => {
    // A host that dropped mid-write must not wedge every edit the user makes afterwards.
    const failing = deferred();
    let ranAfter = false;

    const failed = enqueueSidebarLayoutCommit(() => failing.promise);
    const after = enqueueSidebarLayoutCommit(() => {
      ranAfter = true;
      return Promise.resolve();
    });

    failing.reject();
    await expect(failed).resolves.toBeUndefined();
    await after;

    expect(ranAfter).toBe(true);
  });

  it("resolves the caller's promise even when its own commit rejects", async () => {
    // The caller releases its claim on the pending layout in a .finally on this promise.
    // A rejection there would be unhandled, and the optimistic layout would never clear.
    await expect(
      enqueueSidebarLayoutCommit(() => Promise.reject(new Error("commit failed"))),
    ).resolves.toBeUndefined();
  });
});
