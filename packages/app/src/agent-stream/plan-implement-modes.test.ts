import { describe, expect, it } from "vitest";
import {
  getPlanImplementModes,
  getPlanImplementModeScope,
  resolvePlanImplementMode,
} from "./plan-implement-modes";

// Deliberately not any real provider's mode ids: the app treats what a request
// advertises as opaque, so the tests must pass without knowing what an id means.
const OFFERED = [
  { id: "first-offered", label: "First Offered" },
  { id: "provider-default", label: "Provider Default", isDefault: true },
  { id: "extra", label: "Extra" },
];

describe("getPlanImplementModes", () => {
  it("returns the modes a plan request offers", () => {
    expect(getPlanImplementModes({ metadata: { implementModes: OFFERED } })).toEqual(OFFERED);
  });

  it("drops entries that are not a well-formed mode", () => {
    expect(
      getPlanImplementModes({
        metadata: {
          implementModes: [
            { id: "kept", label: "Kept" },
            { id: "", label: "Blank" },
            { id: "no-label" },
            "not-an-object",
            null,
            { id: "also-kept", label: "Also Kept" },
          ],
        },
      }),
    ).toEqual([
      { id: "kept", label: "Kept" },
      { id: "also-kept", label: "Also Kept" },
    ]);
  });

  it("keeps the default flag only when the daemon sent it as true", () => {
    expect(
      getPlanImplementModes({
        metadata: {
          implementModes: [
            { id: "a", label: "A", isDefault: "yes" },
            { id: "b", label: "B", isDefault: true },
          ],
        },
      }),
    ).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "B", isDefault: true },
    ]);
  });

  it("returns nothing when the daemon sends no modes", () => {
    // An older daemon, or a provider that does not change mode on plan approval.
    expect(getPlanImplementModes({ metadata: undefined })).toEqual([]);
    expect(getPlanImplementModes({ metadata: { planText: "- do the thing" } })).toEqual([]);
    expect(getPlanImplementModes({ metadata: { implementModes: "one-mode" } })).toEqual([]);
  });

  it("returns nothing when a single mode is offered, so no picker appears", () => {
    expect(
      getPlanImplementModes({ metadata: { implementModes: [{ id: "only", label: "Only" }] } }),
    ).toEqual([]);
  });
});

describe("resolvePlanImplementMode", () => {
  it("keeps the remembered mode when it is still offered", () => {
    expect(resolvePlanImplementMode(OFFERED, "extra")).toEqual({ id: "extra", label: "Extra" });
  });

  it("falls back to the mode the request marked default when the remembered one is gone", () => {
    const withoutExtra = OFFERED.filter((mode) => mode.id !== "extra");
    expect(resolvePlanImplementMode(withoutExtra, "extra")).toEqual({
      id: "provider-default",
      label: "Provider Default",
      isDefault: true,
    });
  });

  it("falls back to the mode the request marked default when nothing was ever chosen", () => {
    expect(resolvePlanImplementMode(OFFERED, null)).toEqual({
      id: "provider-default",
      label: "Provider Default",
      isDefault: true,
    });
  });

  it("falls back to the first offered mode when the request marks no default", () => {
    // An older daemon advertises modes without the flag; the picker still opens.
    const unmarked = OFFERED.map(({ id, label }) => ({ id, label }));
    expect(resolvePlanImplementMode(unmarked, "gone")).toEqual({
      id: "first-offered",
      label: "First Offered",
    });
  });

  it("resolves nothing while the remembered mode is still loading", () => {
    expect(resolvePlanImplementMode(OFFERED, undefined)).toBeNull();
  });

  it("resolves nothing when no modes are offered", () => {
    expect(resolvePlanImplementMode([], "extra")).toBeNull();
  });
});

describe("getPlanImplementModeScope", () => {
  it("scopes to the project so every worktree of a repo shares one answer", () => {
    expect(
      getPlanImplementModeScope({
        projectKey: "remote:github.com/getpaseo/paseo",
        cwd: "/Users/me/worktrees/feature-a",
      }),
    ).toBe("remote:github.com/getpaseo/paseo");
    expect(
      getPlanImplementModeScope({
        projectKey: "remote:github.com/getpaseo/paseo",
        cwd: "/Users/me/worktrees/feature-b",
      }),
    ).toBe("remote:github.com/getpaseo/paseo");
  });

  it("keeps separate projects apart", () => {
    expect(getPlanImplementModeScope({ projectKey: "/Users/me/scratch" })).not.toBe(
      getPlanImplementModeScope({ projectKey: "/Users/me/work" }),
    );
  });

  it("falls back to the checkout path when the agent has no project placement", () => {
    expect(getPlanImplementModeScope({ projectKey: null, cwd: "/Users/me/loose-dir" })).toBe(
      "/Users/me/loose-dir",
    );
    expect(getPlanImplementModeScope({ projectKey: "   ", cwd: "/Users/me/loose-dir" })).toBe(
      "/Users/me/loose-dir",
    );
  });

  it("falls back to one shared bucket when nothing identifies the agent", () => {
    expect(getPlanImplementModeScope({})).toBe("");
    expect(getPlanImplementModeScope({ projectKey: null, cwd: null })).toBe("");
  });
});
