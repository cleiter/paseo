import { useCallback } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { EyeOff } from "lucide-react-native";
import type { WorkspaceLabelColor } from "@getpaseo/protocol/workspace-labels";
import { identityColor, identityForeground, identityTint } from "@/styles/identity-colors";
import type { Theme } from "@/styles/theme";
import type { WorkspaceLabelColors } from "./catalog";
import { workspaceLabelColor } from "./catalog";

/**
 * A label as it appears on a workspace row: its name on a tint of its own colour.
 *
 * Not `<StatusBadge>`, though the geometry is close. That primitive is the status family —
 * success, danger, warning, merged — and a chip built from it would say a workspace is failing
 * because someone called a label `blocked`. Labels are identity, so they draw from the identity
 * table like the host badge and the project icon do (docs/design.md §13), and they skip the
 * border a status pill carries so the two never read as the same object.
 */
export function WorkspaceLabelChip({
  name,
  colors,
  onPress,
  accessibilityLabel,
}: {
  name: string;
  colors: WorkspaceLabelColors;
  /**
   * Makes the chip a control. Omitted, it is a mark — which is what it is in the hover card and in
   * the settings list, where there is nothing for a press to mean.
   */
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const color = workspaceLabelColor(colors, name);
  const pressableStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.chip,
      chipColorStyle(color),
      hovered && !pressed && styles.chipHovered,
      pressed && styles.chipPressed,
    ],
    [color],
  );
  const label = (
    <Text style={[styles.text, chipTextStyle(color)]} numberOfLines={1}>
      {name}
    </Text>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        // The row underneath opens the workspace. Without this, filtering by a label also
        // navigates, and the list you just narrowed scrolls away from you.
        onPressIn={stopPropagation}
        onPress={onPress}
        style={pressableStyle}
      >
        {label}
      </Pressable>
    );
  }

  return <View style={[styles.chip, chipColorStyle(color)]}>{label}</View>;
}

function stopPropagation(event: GestureResponderEvent) {
  event.stopPropagation();
}

/**
 * The same colour as a mark rather than as a chip, for lists that already print the name — the
 * label-filter page, where the name is the row and the colour is what ties it to the sidebar.
 */
export function WorkspaceLabelSwatch({
  name,
  colors,
}: {
  name: string;
  colors: WorkspaceLabelColors;
}) {
  return <WorkspaceLabelColorSwatch color={workspaceLabelColor(colors, name)} />;
}

function WorkspaceLabelColorSwatch({ color }: { color: WorkspaceLabelColor }) {
  return <View style={[styles.swatch, swatchColorStyle(color)]} />;
}

const ThemedEyeOff = withUnistyles(EyeOff);

/** The swatch's box, exported so a surface can size a stand-in mark to it and not reflow. */
export const WORKSPACE_LABEL_SWATCH_SIZE = 10;

/**
 * The swatch's replacement on a label being filtered out, everywhere one can be: the chip track,
 * the label-filter page, and the saved-view editor.
 *
 * The three surfaces used to say it three ways — a dimmed swatch here, a grey eye there, a grey eye
 * with the word "Excluded" under it in the menu — which made the same state look like three
 * different ones depending on where you were standing. The glyph is what says "hidden"; the colour
 * is what says which label, and it is the label's own, because a mark that drops the colour drops
 * the one thing tying it to the row, the chip, and the hover card.
 */
export function WorkspaceLabelExcludedMark({
  name,
  colors,
  size = 12,
}: {
  name: string;
  colors: WorkspaceLabelColors;
  size?: number;
}) {
  const color = workspaceLabelColor(colors, name);
  // Built in render, never hoisted: the mapping reads the theme, and a module-scope one would read
  // the style proxies before the persisted theme lands — see docs/unistyles.md.
  const mapping = useCallback(
    (theme: Theme) => ({ color: identityForeground(color, theme.colorScheme) }),
    [color],
  );
  return <ThemedEyeOff size={size} uniProps={mapping} />;
}

/**
 * The solid fill on its own, for surfaces that size their own swatch — the colour picker, whose
 * swatches are targets you have to be able to hit rather than marks in a leading rail.
 */
export function workspaceLabelSwatchFill(color: WorkspaceLabelColor) {
  return swatchColorStyle(color);
}

/**
 * A label's fill and its text colour, for surfaces that build their own chip — the filter track,
 * whose chips have three states and so cannot be `<WorkspaceLabelChip>`. Call these inside render;
 * they read registered styles. The palette lookup lives in this one file so a label wears the same
 * colour everywhere it appears.
 */
export function workspaceLabelFill(colors: WorkspaceLabelColors, name: string) {
  return chipColorStyle(workspaceLabelColor(colors, name));
}

export function workspaceLabelText(colors: WorkspaceLabelColors, name: string) {
  return chipTextStyle(workspaceLabelColor(colors, name));
}

/**
 * The label's colour as an outline, for the track's included state.
 *
 * The fill alone could not carry that state: at 10% alpha its contrast against the sidebar depends
 * on the hue, so amber and sky read as switched on while violet and indigo are a shade of the
 * chip that is switched off. A full-strength edge is the same strength whatever the hue. It takes
 * the text's colour rather than the fill's so the two agree, and the chip reserves the width for
 * it in every state so pressing one cannot reflow the line.
 */
export function workspaceLabelBorder(colors: WorkspaceLabelColors, name: string) {
  return chipBorderStyle(workspaceLabelColor(colors, name));
}

// One registered style per palette colour, picked at render time. A module-level lookup table
// would read the style proxies before the persisted theme lands — see docs/unistyles.md.
function chipColorStyle(color: WorkspaceLabelColor) {
  switch (color) {
    case "violet":
      return styles.chipViolet;
    case "sky":
      return styles.chipSky;
    case "emerald":
      return styles.chipEmerald;
    case "orange":
      return styles.chipOrange;
    case "pink":
      return styles.chipPink;
    case "indigo":
      return styles.chipIndigo;
    case "teal":
      return styles.chipTeal;
    case "red":
      return styles.chipRed;
    case "amber":
      return styles.chipAmber;
    case "blue":
      return styles.chipBlue;
  }
}

// Solid rather than the chip's tint: at 10pt square a 10%-alpha fill is not a colour, it is a
// smudge. This is the same table the project icons fill from.
function swatchColorStyle(color: WorkspaceLabelColor) {
  switch (color) {
    case "violet":
      return styles.swatchViolet;
    case "sky":
      return styles.swatchSky;
    case "emerald":
      return styles.swatchEmerald;
    case "orange":
      return styles.swatchOrange;
    case "pink":
      return styles.swatchPink;
    case "indigo":
      return styles.swatchIndigo;
    case "teal":
      return styles.swatchTeal;
    case "red":
      return styles.swatchRed;
    case "amber":
      return styles.swatchAmber;
    case "blue":
      return styles.swatchBlue;
  }
}

function chipBorderStyle(color: WorkspaceLabelColor) {
  switch (color) {
    case "violet":
      return styles.borderViolet;
    case "sky":
      return styles.borderSky;
    case "emerald":
      return styles.borderEmerald;
    case "orange":
      return styles.borderOrange;
    case "pink":
      return styles.borderPink;
    case "indigo":
      return styles.borderIndigo;
    case "teal":
      return styles.borderTeal;
    case "red":
      return styles.borderRed;
    case "amber":
      return styles.borderAmber;
    case "blue":
      return styles.borderBlue;
  }
}

function chipTextStyle(color: WorkspaceLabelColor) {
  switch (color) {
    case "violet":
      return styles.textViolet;
    case "sky":
      return styles.textSky;
    case "emerald":
      return styles.textEmerald;
    case "orange":
      return styles.textOrange;
    case "pink":
      return styles.textPink;
    case "indigo":
      return styles.textIndigo;
    case "teal":
      return styles.textTeal;
    case "red":
      return styles.textRed;
    case "amber":
      return styles.textAmber;
    case "blue":
      return styles.textBlue;
  }
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    // The same corner as the track's chips. A label is one object wherever it appears, and the
    // track is where you see several of them at once, so it is what the others match.
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: 4,
    minWidth: 0,
    // Draws at its own width and gives ground only when the line runs out, longest first. An
    // earlier version measured each chip and used that as a ceiling so several chips would take
    // equal shares — but the measurement was taken once and kept, so a chip first laid out while
    // the sidebar was still settling kept a ceiling of a few pixels for the rest of the session
    // and truncated with the row half empty. Equal shares needs a max-content width, which Yoga
    // does not have; proportional shrink is what it does have, and it cannot get stuck.
    flexShrink: 1,
  },
  // The chip wears its label's colour, so hover and press cannot repaint it the way the rest of
  // the sidebar does — they lift and dim it instead.
  chipHovered: {
    opacity: 0.82,
  },
  chipPressed: {
    opacity: 0.65,
  },
  text: {
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  // Sized to the menu's leading rail, which holds 14pt glyphs.
  swatch: {
    width: WORKSPACE_LABEL_SWATCH_SIZE,
    height: WORKSPACE_LABEL_SWATCH_SIZE,
    borderRadius: theme.borderRadius.sm,
  },
  swatchViolet: { backgroundColor: identityColor("violet") },
  swatchSky: { backgroundColor: identityColor("sky") },
  swatchEmerald: { backgroundColor: identityColor("emerald") },
  swatchOrange: { backgroundColor: identityColor("orange") },
  swatchPink: { backgroundColor: identityColor("pink") },
  swatchIndigo: { backgroundColor: identityColor("indigo") },
  swatchTeal: { backgroundColor: identityColor("teal") },
  swatchRed: { backgroundColor: identityColor("red") },
  swatchAmber: { backgroundColor: identityColor("amber") },
  swatchBlue: { backgroundColor: identityColor("blue") },
  chipViolet: { backgroundColor: identityTint("violet") },
  chipSky: { backgroundColor: identityTint("sky") },
  chipEmerald: { backgroundColor: identityTint("emerald") },
  chipOrange: { backgroundColor: identityTint("orange") },
  chipPink: { backgroundColor: identityTint("pink") },
  chipIndigo: { backgroundColor: identityTint("indigo") },
  chipTeal: { backgroundColor: identityTint("teal") },
  chipRed: { backgroundColor: identityTint("red") },
  chipAmber: { backgroundColor: identityTint("amber") },
  chipBlue: { backgroundColor: identityTint("blue") },
  borderViolet: { borderColor: identityForeground("violet", theme.colorScheme) },
  borderSky: { borderColor: identityForeground("sky", theme.colorScheme) },
  borderEmerald: { borderColor: identityForeground("emerald", theme.colorScheme) },
  borderOrange: { borderColor: identityForeground("orange", theme.colorScheme) },
  borderPink: { borderColor: identityForeground("pink", theme.colorScheme) },
  borderIndigo: { borderColor: identityForeground("indigo", theme.colorScheme) },
  borderTeal: { borderColor: identityForeground("teal", theme.colorScheme) },
  borderRed: { borderColor: identityForeground("red", theme.colorScheme) },
  borderAmber: { borderColor: identityForeground("amber", theme.colorScheme) },
  borderBlue: { borderColor: identityForeground("blue", theme.colorScheme) },
  textViolet: { color: identityForeground("violet", theme.colorScheme) },
  textSky: { color: identityForeground("sky", theme.colorScheme) },
  textEmerald: { color: identityForeground("emerald", theme.colorScheme) },
  textOrange: { color: identityForeground("orange", theme.colorScheme) },
  textPink: { color: identityForeground("pink", theme.colorScheme) },
  textIndigo: { color: identityForeground("indigo", theme.colorScheme) },
  textTeal: { color: identityForeground("teal", theme.colorScheme) },
  textRed: { color: identityForeground("red", theme.colorScheme) },
  textAmber: { color: identityForeground("amber", theme.colorScheme) },
  textBlue: { color: identityForeground("blue", theme.colorScheme) },
}));
