import { describe, expect, it } from "vitest";
import { resolveRenameModalState } from "./rename-modal-state";

function resolve(overrides: Partial<Parameters<typeof resolveRenameModalState>[0]> = {}) {
  return resolveRenameModalState({
    draft: "ok",
    initialValue: "ok",
    isPending: false,
    submitError: null,
    validate: (value) => (value === "bad" ? "Invalid name" : null),
    ...overrides,
  });
}

describe("resolveRenameModalState", () => {
  // The whole point of the live message: the button is dead and nothing said why.
  it("says why the submit button is dead without waiting for a submit", () => {
    expect(resolve({ draft: "bad" })).toEqual({
      shownError: "Invalid name",
      submitDisabled: true,
    });
  });

  it("stays quiet about a name that has not been touched", () => {
    expect(resolve({ draft: "ok", validate: () => "Invalid name" }).shownError).toBeNull();
  });

  // Emptying the field is on the way to typing something else, not a mistake worth shouting about.
  it("stays quiet about a field emptied down to whitespace", () => {
    expect(resolve({ draft: "   ", validate: () => "Invalid name" }).shownError).toBeNull();
  });

  it("still refuses to submit the names it keeps quiet about", () => {
    expect(resolve({ draft: "   ", validate: () => "Invalid name" }).submitDisabled).toBe(true);
  });

  it("clears the live message as soon as the name becomes valid again", () => {
    expect(resolve({ draft: "good" })).toEqual({ shownError: null, submitDisabled: false });
  });

  it("refuses a name that has not changed, and says nothing about it", () => {
    expect(resolve({ draft: "ok", initialValue: "ok" })).toEqual({
      shownError: null,
      submitDisabled: true,
    });
  });

  // What the daemon said outranks the field, which cannot know it.
  it("keeps showing what the last submit came back with", () => {
    expect(resolve({ draft: "good", submitError: "Already taken" }).shownError).toBe(
      "Already taken",
    );
  });

  it("goes quiet and stays disabled while a submit is in flight", () => {
    expect(resolve({ draft: "bad", isPending: true })).toEqual({
      shownError: null,
      submitDisabled: true,
    });
  });
});
