import { describe, expect, it } from "vitest";
import { planWorkspaceLabelCreate, planWorkspaceLabelEdit } from "./edit-plan";

describe("planWorkspaceLabelCreate", () => {
  it("colours a new label explicitly even when the picker was never touched", () => {
    const plan = planWorkspaceLabelCreate({
      draft: { name: "blocked", color: null },
      existing: [],
    });
    expect(plan).toEqual({ ok: true, name: "blocked", color: expect.any(String) });
  });

  it("keeps the colour that was picked", () => {
    expect(
      planWorkspaceLabelCreate({ draft: { name: "oss", color: "red" }, existing: [] }),
    ).toEqual({ ok: true, name: "oss", color: "red" });
  });

  it("normalizes the name before anything else looks at it", () => {
    const plan = planWorkspaceLabelCreate({
      draft: { name: "  needs   review ", color: "sky" },
      existing: [],
    });
    expect(plan).toMatchObject({ ok: true, name: "needs review" });
  });

  it("refuses a name already in use, in any spelling", () => {
    expect(
      planWorkspaceLabelCreate({ draft: { name: "Blocked", color: null }, existing: ["blocked"] }),
    ).toEqual({ ok: false, problem: "nameTaken" });
  });

  it("refuses a name that is only whitespace", () => {
    expect(planWorkspaceLabelCreate({ draft: { name: "   ", color: null }, existing: [] })).toEqual(
      {
        ok: false,
        problem: "emptyName",
      },
    );
  });
});

describe("planWorkspaceLabelEdit", () => {
  it("has nothing to send when neither the name nor the colour moved", () => {
    expect(
      planWorkspaceLabelEdit({
        original: "blocked",
        originalColor: "red",
        draft: { name: "blocked", color: "red" },
        existing: ["blocked"],
      }),
    ).toEqual({ ok: true, name: "blocked", steps: [] });
  });

  it("renames before it recolours, so the colour lands on the name that exists after", () => {
    expect(
      planWorkspaceLabelEdit({
        original: "blocked",
        originalColor: "red",
        draft: { name: "waiting", color: "sky" },
        existing: ["blocked"],
      }),
    ).toEqual({
      ok: true,
      name: "waiting",
      steps: [
        { kind: "rename", from: "blocked", to: "waiting" },
        { kind: "setColor", name: "waiting", color: "sky" },
      ],
    });
  });

  // The daemon's rename carries the catalog entry across with the assignments, so re-sending the
  // same colour under the new name would be a second write saying what the first already said.
  it("does not resend an unchanged colour after a rename", () => {
    expect(
      planWorkspaceLabelEdit({
        original: "blocked",
        originalColor: "red",
        draft: { name: "waiting", color: "red" },
        existing: ["blocked"],
      }),
    ).toEqual({
      ok: true,
      name: "waiting",
      steps: [{ kind: "rename", from: "blocked", to: "waiting" }],
    });
  });

  it("treats a change of spelling as a rename rather than a collision with itself", () => {
    expect(
      planWorkspaceLabelEdit({
        original: "blocked",
        originalColor: null,
        draft: { name: "Blocked", color: null },
        existing: ["blocked"],
      }),
    ).toEqual({
      ok: true,
      name: "Blocked",
      steps: [{ kind: "rename", from: "blocked", to: "Blocked" }],
    });
  });

  it("resets the colour when a chosen one is handed back to automatic", () => {
    expect(
      planWorkspaceLabelEdit({
        original: "blocked",
        originalColor: "red",
        draft: { name: "blocked", color: null },
        existing: ["blocked"],
      }),
    ).toEqual({
      ok: true,
      name: "blocked",
      steps: [{ kind: "resetColor", name: "blocked" }],
    });
  });

  // A label already wearing its derived colour has nothing to reset, and a reset would remove the
  // catalog entry that is the only thing holding a label no workspace carries.
  it("has nothing to reset when the colour was already automatic", () => {
    expect(
      planWorkspaceLabelEdit({
        original: "blocked",
        originalColor: null,
        draft: { name: "blocked", color: null },
        existing: ["blocked"],
      }),
    ).toEqual({ ok: true, name: "blocked", steps: [] });
  });

  it("refuses a rename onto a name another label already holds", () => {
    expect(
      planWorkspaceLabelEdit({
        original: "blocked",
        originalColor: null,
        draft: { name: "review", color: null },
        existing: ["blocked", "review"],
      }),
    ).toEqual({ ok: false, problem: "nameTaken" });
  });

  it("refuses an empty name", () => {
    expect(
      planWorkspaceLabelEdit({
        original: "blocked",
        originalColor: null,
        draft: { name: "  ", color: "red" },
        existing: ["blocked"],
      }),
    ).toEqual({ ok: false, problem: "emptyName" });
  });
});
