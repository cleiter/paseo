/**
 * What the rename dialog shows under its field, and whether its submit button is alive.
 *
 * One rule, not two. The button being dead and the reason it is dead are the same decision, and
 * splitting them is how a dialog ends up refusing a name without saying so.
 */
export interface RenameModalState {
  /** The message under the field, or null for none. */
  shownError: string | null;
  submitDisabled: boolean;
}

/**
 * The disabled button is what stops the submit handler running, so a message produced only on
 * submit could be read only by pressing Enter, which a touch user has no way to do. Validating as
 * you type is what makes the dead button explain itself.
 *
 * It stays quiet until the field has been typed in and changed, so opening the dialog does not
 * greet you with "name is required" about a name you have not touched. `submitError` outranks
 * everything derived from the field: it is what the daemon said, and the field cannot know it.
 */
export function resolveRenameModalState(input: {
  draft: string;
  initialValue: string;
  isPending: boolean;
  /** What the last submit came back with, from validation or from the host. */
  submitError: string | null;
  /** The composed validator: the empty-name rule plus whatever the caller added. */
  validate: (value: string) => string | null;
}): RenameModalState {
  const unchanged = input.draft === input.initialValue;
  const validationError = input.validate(input.draft);
  const readyToComplain = !input.isPending && !unchanged && input.draft.trim().length > 0;
  return {
    shownError: input.submitError ?? (readyToComplain ? validationError : null),
    submitDisabled: input.isPending || unchanged || validationError !== null,
  };
}
