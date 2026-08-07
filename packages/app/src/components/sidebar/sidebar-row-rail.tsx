import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";

// The rail a nested section draws down its left edge, per ROW instead of per section.
//
// One list has no section views to hang a border on, so each row draws its own segment
// and consecutive rows stack them into the same continuous line. The step is
// TREE_INDENT_PER_LEVEL, shared with the Files and Changes trees so the sidebar's nesting
// cannot drift away from theirs.

export function SidebarRowRail({
  levels,
  trailingGap,
  children,
}: {
  levels: number;
  // Space a block used to keep below its last row, now carried by that row. Inside the
  // rail, where the block's own padding was.
  trailingGap?: "pinned" | "project";
  children: ReactNode;
}): ReactNode {
  let content: ReactNode = children;
  if (trailingGap) {
    content = (
      <View style={trailingGap === "project" ? styles.projectGap : styles.pinnedGap}>
        {content}
      </View>
    );
  }
  for (let level = 0; level < levels; level += 1) {
    content = <View style={styles.railed}>{content}</View>;
  }
  // Returned unwrapped: a row with no rail and no gap must add nothing at all to the tree,
  // and a fragment around one child is a node the list would measure for nothing.
  return content;
}

const styles = StyleSheet.create((theme) => ({
  railed: {
    marginLeft: TREE_INDENT_PER_LEVEL,
    paddingLeft: theme.spacing[1],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.surface2,
  },
  // Three times the gap a row keeps from its neighbour, so the break between two projects
  // reads as a break rather than as one more row of pitch. Kept equal to
  // `statusGroupBlockExpanded` — the two groupings are the same list under a different
  // heading and must not breathe differently.
  projectGap: {
    paddingBottom: theme.spacing[3],
  },
  pinnedGap: {
    paddingBottom: theme.spacing[1],
  },
}));
