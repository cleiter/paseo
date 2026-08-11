import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type TextInput,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  deriveWorkspaceLabelColor,
  MAX_WORKSPACE_LABEL_LENGTH,
  MAX_WORKSPACE_LABELS,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
} from "@getpaseo/protocol/workspace-labels";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import {
  useChosenWorkspaceLabelColors,
  useWorkspaceLabelColors,
} from "@/stores/workspace-label-catalog-store";
import { workspaceLabelColor } from "./catalog";
import {
  canRenameWorkspaceLabelEverywhere,
  renameWorkspaceLabelEverywhere,
  resetWorkspaceLabelColorEverywhere,
  setWorkspaceLabelColorEverywhere,
  type WorkspaceLabelCatalogWriteDeps,
  type WorkspaceLabelCatalogWriteVerdict,
} from "./catalog-writes";
import { useWorkspaceLabelDialogStore, type WorkspaceLabelDialogRequest } from "./dialog-store";
import {
  planWorkspaceLabelCreate,
  planWorkspaceLabelEdit,
  type WorkspaceLabelEditStep,
} from "./edit-plan";
import { workspaceLabelSwatchFill } from "./label-chip";
import {
  readWorkspaceLabelCatalogHosts,
  readWorkspaceLabels,
  useKnownWorkspaceLabels,
  useWorkspaceLabelCatalogWriteDeps,
  writeWorkspaceLabels,
} from "./model";

/**
 * The colour names are the ten the host appearance picker already ships, translated in every
 * locale. A second set of names for the same ten colours would be two places to get "Emerald"
 * wrong in Japanese.
 */
function colorLabelKey(color: WorkspaceLabelColor): string {
  return `settings.host.appearance.color.options.${color}`;
}

/**
 * A refused write in words. A rename gets its own two messages because a partial one is a worse
 * outcome than a partial colour — two labels where there was one — and saying "the change" there
 * would undersell it.
 */
function describeVerdict(
  t: TFunction,
  verdict: WorkspaceLabelCatalogWriteVerdict,
  step: WorkspaceLabelEditStep["kind"],
): string {
  const isRename = step === "rename";
  if (verdict.status === "noHost") return t("workspace.terminal.hostDisconnected");
  if (verdict.status === "partial") {
    return t(isRename ? "settings.labels.renamePartial" : "settings.labels.partial", {
      failed: verdict.failed,
      total: verdict.total,
    });
  }
  const fallback = t(isRename ? "settings.labels.renameFailed" : "settings.labels.failed");
  return verdict.status === "failed" ? verdict.error || fallback : fallback;
}

function runStep(
  deps: WorkspaceLabelCatalogWriteDeps,
  step: WorkspaceLabelEditStep,
): Promise<WorkspaceLabelCatalogWriteVerdict> {
  switch (step.kind) {
    case "rename":
      return renameWorkspaceLabelEverywhere(deps, { from: step.from, to: step.to });
    case "setColor":
      return setWorkspaceLabelColorEverywhere(deps, { name: step.name, color: step.color });
    case "resetColor":
      return resetWorkspaceLabelColorEverywhere(deps, { name: step.name });
  }
}

/**
 * Naming and colouring a label, mounted once at the app root.
 *
 * One dialog for both jobs. Creating a label and editing one differ by which writes they send, not
 * by what you decide, and a create flow that only took a name left every new label wearing the
 * colour its name happened to hash to until you went looking for a picker.
 *
 * See `dialog-store.ts` for why it is opened through a store rather than owned by its callers.
 */
export function WorkspaceLabelDialogHost(): ReactElement {
  const request = useWorkspaceLabelDialogStore((state) => state.request);
  const close = useWorkspaceLabelDialogStore((state) => state.close);
  return <WorkspaceLabelDialog request={request} onClose={close} />;
}

function WorkspaceLabelDialog({
  request,
  onClose,
}: {
  request: WorkspaceLabelDialogRequest | null;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const known = useKnownWorkspaceLabels();
  const colors = useWorkspaceLabelColors();
  const chosen = useChosenWorkspaceLabelColors();
  const deps = useWorkspaceLabelCatalogWriteDeps();
  const renameLabelFilter = useSidebarViewStore((state) => state.renameLabelFilter);
  const nameInputRef = useRef<TextInput>(null);

  const original = request?.mode === "edit" ? request.label : null;
  const originalColor =
    original !== null && chosen.has(original.trim().toLowerCase())
      ? workspaceLabelColor(colors, original)
      : null;

  const [name, setName] = useState("");
  const [color, setColor] = useState<WorkspaceLabelColor | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  // Whether every reachable host is new enough for the rename RPC, read from the stores at the
  // moment the dialog opens rather than through the shared connection-status hook: this component
  // mounts at the app root before any daemon has connected, and that hook never revises the
  // `connecting` it handed the first render. See `model.ts`.
  const [canRename, setCanRename] = useState(true);
  const [openedFor, setOpenedFor] = useState<WorkspaceLabelDialogRequest | null>(null);

  // Reset during render rather than in an effect, so the draft is seeded from the catalog as it
  // stands when the dialog opens. An effect keyed on the catalog would throw away a colour you had
  // already picked the next time a host broadcast arrived.
  if (request !== openedFor) {
    setOpenedFor(request);
    setName(original ?? "");
    // A new label starts on the first swatch rather than on the colour its name hashes to. The
    // derived colour changes with every keystroke, so the selection ring walked the palette while
    // you typed — a control moving on its own while you are busy with another one.
    setColor(request?.mode === "create" ? WORKSPACE_LABEL_COLORS[0] : originalColor);
    setNameError(null);
    setSubmitError(null);
    setIsPending(false);
    if (request) {
      setCanRename(canRenameWorkspaceLabelEverywhere(readWorkspaceLabelCatalogHosts()));
    }
  }

  useEffect(() => {
    if (!request) return;
    const timeout = setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => clearTimeout(timeout);
  }, [request]);

  const isCreate = request?.mode === "create";
  const target = request?.mode === "create" ? request.target : null;

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setNameError(null);
    setSubmitError(null);
  }, []);

  // What the picker highlights: your choice, or — for a label wearing its automatic colour, which
  // only an edit can be — the one its name hashes to.
  const shownColor = color ?? deriveWorkspaceLabelColor(name.trim());

  const handlePickColor = useCallback((picked: WorkspaceLabelColor) => {
    setColor(picked);
    setSubmitError(null);
  }, []);

  const handleAutomatic = useCallback(() => {
    setColor(null);
    setSubmitError(null);
  }, []);

  const handleCreate = useCallback(async (): Promise<boolean> => {
    const plan = planWorkspaceLabelCreate({ draft: { name, color }, existing: known });
    if (!plan.ok) {
      setNameError(
        t(plan.problem === "nameTaken" ? "settings.labels.nameTaken" : "settings.labels.nameEmpty"),
      );
      return false;
    }
    const labels = readWorkspaceLabels(target);
    if (target && labels.length >= MAX_WORKSPACE_LABELS) {
      setNameError(t("sidebar.workspace.labels.errors.tooMany", { count: MAX_WORKSPACE_LABELS }));
      return false;
    }

    // The catalog entry first, then the assignment. A label made from Settings has no workspace
    // holding it, so the entry is the whole label; doing it first also means retrying after a
    // failed assignment re-sends a colour that is already there rather than making a second label.
    const verdict = await setWorkspaceLabelColorEverywhere(deps, {
      name: plan.name,
      color: plan.color,
    });
    if (verdict.status !== "ok") {
      setSubmitError(describeVerdict(t, verdict, "setColor"));
      return false;
    }
    if (target) {
      await writeWorkspaceLabels({
        target,
        labels: [...labels, plan.name],
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
      });
    }
    return true;
  }, [color, deps, known, name, t, target]);

  const handleEdit = useCallback(async (): Promise<boolean> => {
    if (original === null) return false;
    const plan = planWorkspaceLabelEdit({
      original,
      originalColor,
      draft: { name, color },
      existing: known,
    });
    if (!plan.ok) {
      setNameError(
        t(plan.problem === "nameTaken" ? "settings.labels.nameTaken" : "settings.labels.nameEmpty"),
      );
      return false;
    }
    // A rename that lands on some hosts and not others leaves two labels rather than one, because
    // the name is the identity — so a host too old for the RPC blocks the rename instead of being
    // skipped the way a colour write skips it.
    if (!canRename && plan.steps.some((step) => step.kind === "rename")) {
      setNameError(t("settings.labels.renameUnsupported"));
      return false;
    }
    for (const step of plan.steps) {
      const verdict = await runStep(deps, step);
      if (verdict.status !== "ok") {
        setSubmitError(describeVerdict(t, verdict, step.kind));
        return false;
      }
      // The filter names labels by name too, so a rename has to carry it across or the chip that
      // would cycle the filter back off is gone with the old name.
      if (step.kind === "rename") renameLabelFilter(step.from, step.to);
    }
    return true;
  }, [canRename, color, deps, known, name, original, originalColor, renameLabelFilter, t]);

  const handleSave = useCallback(() => {
    if (isPending || !request) return;
    setSubmitError(null);
    setIsPending(true);
    void (async () => {
      try {
        const done = request.mode === "create" ? await handleCreate() : await handleEdit();
        if (done) onClose();
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : t("settings.labels.failed"));
      } finally {
        setIsPending(false);
      }
    })();
  }, [handleCreate, handleEdit, isPending, onClose, request, t]);

  const handleCancel = useCallback(() => {
    if (isPending) return;
    onClose();
  }, [isPending, onClose]);

  const sheetHeader = useMemo<SheetHeader>(
    () => ({ title: t(isCreate ? "settings.labels.createTitle" : "settings.labels.editTitle") }),
    [isCreate, t],
  );

  return (
    <AdaptiveModalSheet
      visible={request !== null}
      header={sheetHeader}
      onClose={handleCancel}
      desktopMaxWidth={420}
      testID="workspace-label-dialog"
    >
      <View style={styles.body}>
        <Field
          label={t("settings.labels.nameLabel")}
          error={nameError}
          testID="workspace-label-name-field"
        >
          <FormTextInput
            ref={nameInputRef}
            initialValue={original ?? ""}
            resetKey={request === null ? "closed" : (original ?? "new")}
            onChangeText={handleNameChange}
            placeholder={t("settings.labels.namePlaceholder")}
            maxLength={MAX_WORKSPACE_LABEL_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
            returnKeyType="done"
            onSubmitEditing={handleSave}
            accessibilityLabel={t("settings.labels.nameLabel")}
            testID="workspace-label-name-input"
          />
        </Field>

        <ColorField
          isCreate={isCreate}
          color={color}
          shownColor={shownColor}
          isPending={isPending}
          onPick={handlePickColor}
          onAutomatic={handleAutomatic}
        />

        {submitError ? (
          <Text style={styles.submitError} testID="workspace-label-submit-error">
            {submitError}
          </Text>
        ) : null}

        <DialogActions
          isCreate={isCreate}
          isPending={isPending}
          onCancel={handleCancel}
          onSave={handleSave}
        />
      </View>
    </AdaptiveModalSheet>
  );
}

/**
 * The ten colours, and the way back to the automatic one.
 *
 * "Use automatic color" appears only once a colour has been chosen, and never while creating. A
 * new label has to write a colour to exist at all when no workspace carries it yet, so creating
 * has no automatic colour to go back to — the picker there is ten choices and nothing else.
 */
function ColorField({
  isCreate,
  color,
  shownColor,
  isPending,
  onPick,
  onAutomatic,
}: {
  isCreate: boolean;
  color: WorkspaceLabelColor | null;
  shownColor: WorkspaceLabelColor;
  isPending: boolean;
  onPick: (color: WorkspaceLabelColor) => void;
  onAutomatic: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("settings.labels.colorLabel")} testID="workspace-label-color-field">
        <View style={styles.swatches}>
          {WORKSPACE_LABEL_COLORS.map((option) => (
            <ColorSwatchButton
              key={option}
              color={option}
              selected={option === shownColor}
              disabled={isPending}
              label={t(colorLabelKey(option))}
              onSelect={onPick}
            />
          ))}
        </View>
      </Field>
      {!isCreate && color !== null ? (
        <Button
          variant="ghost"
          size="sm"
          style={styles.automaticButton}
          onPress={onAutomatic}
          disabled={isPending}
          testID="workspace-label-automatic-color"
        >
          {t("settings.labels.colorAutomatic")}
        </Button>
      ) : null}
    </>
  );
}

function DialogActions({
  isCreate,
  isPending,
  onCancel,
  onSave,
}: {
  isCreate: boolean;
  isPending: boolean;
  onCancel: () => void;
  onSave: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.actions}>
      <Button
        variant="secondary"
        style={styles.actionButton}
        onPress={onCancel}
        disabled={isPending}
        testID="workspace-label-cancel-button"
      >
        {t("common.actions.cancel")}
      </Button>
      <Button
        variant="default"
        style={styles.actionButton}
        onPress={onSave}
        disabled={isPending}
        testID="workspace-label-save-button"
      >
        {isPending
          ? t("settings.labels.saving")
          : t(isCreate ? "settings.labels.create" : "settings.labels.save")}
      </Button>
    </View>
  );
}

/**
 * One palette colour as a target.
 *
 * A ring around the swatch rather than a mark on it: the ten fills span the whole hue circle, and
 * no single glyph colour clears the contrast band on all of them, in both schemes.
 */
function ColorSwatchButton({
  color,
  selected,
  disabled,
  label,
  onSelect,
}: {
  color: WorkspaceLabelColor;
  selected: boolean;
  disabled: boolean;
  label: string;
  onSelect: (color: WorkspaceLabelColor) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(color), [color, onSelect]);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.swatchRing,
      selected && styles.swatchRingSelected,
      pressed && styles.swatchPressed,
    ],
    [selected],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const fill = useMemo(() => [styles.swatchFill, workspaceLabelSwatchFill(color)], [color]);
  return (
    <Pressable
      style={style}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={label}
      testID={`workspace-label-color-${color}`}
    >
      <View style={fill} />
    </Pressable>
  );
}

const SWATCH_RING_SIZE = 34;
const SWATCH_COLUMNS = 5;

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  // Wide enough for five and no wider, so ten colours are two rows of five on every width. Left to
  // wrap on its own the row fits nine on a desktop dialog and eight in a phone sheet, and the
  // orphans read as a layout that ran out of room.
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    maxWidth: SWATCH_COLUMNS * SWATCH_RING_SIZE + (SWATCH_COLUMNS - 1) * theme.spacing[2],
  },
  swatchRing: {
    width: SWATCH_RING_SIZE,
    height: SWATCH_RING_SIZE,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchRingSelected: {
    borderColor: theme.colors.foreground,
  },
  swatchPressed: {
    opacity: 0.75,
  },
  swatchFill: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.sm,
  },
  automaticButton: {
    alignSelf: "flex-start",
  },
  submitError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
