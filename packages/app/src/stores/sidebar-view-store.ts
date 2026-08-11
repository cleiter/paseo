import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

import type { LabelFilterMode, LabelMatchMode } from "@/components/sidebar/sidebar-filter";

export type SidebarGroupMode = "project" | "status" | "label";

/** Which way round the three label filter states are walked — see `cycleLabelFilter`. */
export type LabelFilterCycleDirection = "forward" | "backward";

const SIDEBAR_VIEW_STORAGE_KEY = "sidebar-view";
const LEGACY_SIDEBAR_GROUP_MODE_STORAGE_KEY = "sidebar-group-mode";
const SIDEBAR_VIEW_STORE_VERSION = 3;

interface SidebarViewStoreState {
  groupMode: SidebarGroupMode;
  // Empty means "all hosts". A non-empty list pins the sidebar to those hosts.
  hostFilters: string[];
  /**
   * Empty means "all projects". A non-empty list is an allowlist over
   * `SidebarProjectEntry.viewKey` — the same key the project sections are built from, so a project
   * that spans two hosts is one entry here rather than one per host.
   */
  projectFilters: string[];
  /**
   * Labels the sidebar is filtered by, keyed by lowercased name. Absent is neutral — a label with
   * no entry says nothing about a workspace either way, which is what makes include and exclude
   * two independent statements rather than one boolean.
   *
   * Per-device, like the host filter beside it and unlike the labels themselves: which labels a
   * workspace carries is the daemon's, what you are looking at right now is this screen's.
   */
  labelFilters: Record<string, LabelFilterMode>;
  /**
   * Whether two lit labels mean either or both — see `LabelMatchMode`. A preference about how the
   * facet reads rather than a filter of its own, which is why clearing the filters leaves it be.
   */
  labelMatch: LabelMatchMode;
  savedViews: SavedSidebarView[];
  /**
   * The view the current filters came from, or null. It survives a filter change: editing a view
   * is how you change one, so losing the view the moment you touch a chip would take the Update
   * that is the point of the edit away with it. Whether the sidebar still matches what the view
   * holds is derived — see `savedViewMatchesArrangement`, which is what the UI marks as edited.
   */
  activeSavedViewId: string | null;
  setGroupMode: (mode: SidebarGroupMode) => void;
  toggleHostFilter: (serverId: string) => void;
  clearHostFilters: () => void;
  reconcileHostFilters: (serverIds: readonly string[]) => void;
  toggleProjectFilter: (viewKey: string) => void;
  clearProjectFilters: () => void;
  reconcileProjectFilters: (viewKeys: readonly string[]) => void;
  cycleLabelFilter: (name: string, direction?: LabelFilterCycleDirection) => void;
  setLabelMatch: (mode: LabelMatchMode) => void;
  clearLabelFilters: () => void;
  forgetLabelFilter: (name: string) => void;
  renameLabelFilter: (from: string, to: string) => void;
  createSavedSidebarView: (view: SavedSidebarView) => void;
  applySavedSidebarView: (id: string) => void;
  clearActiveSidebarView: () => void;
  updateSavedSidebarView: (id: string) => void;
  editSavedSidebarView: (id: string, edit: Omit<SavedSidebarView, "id">) => void;
  deleteSavedSidebarView: (id: string) => void;
}

/**
 * A filter arrangement someone named and can come back to.
 *
 * Per device, like the filters it holds. Making these follow you needs a replicated document that
 * does not exist yet, and a saved view that syncs while the filter it captures does not would be
 * two answers to the same question.
 */
export interface SavedSidebarView {
  id: string;
  name: string;
  /**
   * Null means the view says nothing about grouping and applying it leaves whatever you are on.
   * A view is mostly a set of filters, and forcing a grouping with every one of them makes the two
   * dimensions one — you could not narrow to a label without also being told how to read the list.
   */
  groupMode: SidebarGroupMode | null;
  hostFilters: string[];
  projectFilters: string[];
  labelFilters: Record<string, LabelFilterMode>;
  labelMatch: LabelMatchMode;
}

interface SidebarViewPersistedState {
  groupMode: SidebarGroupMode;
  hostFilters: string[];
  projectFilters: string[];
  labelFilters: Record<string, LabelFilterMode>;
  labelMatch: LabelMatchMode;
  savedViews: SavedSidebarView[];
  activeSavedViewId: string | null;
}

const SidebarGroupModeSchema = z.enum(["project", "status", "label"]);
const LabelFilterModeSchema = z.enum(["include", "exclude"]);
const LabelMatchModeSchema = z.enum(["any", "all"]);
const SavedSidebarViewStorageSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  groupMode: SidebarGroupModeSchema.nullable().optional(),
  hostFilters: z.array(z.string()).optional(),
  projectFilters: z.array(z.string()).optional(),
  labelFilters: z.record(z.string(), LabelFilterModeSchema).optional(),
  labelMatch: LabelMatchModeSchema.optional(),
});
const SidebarViewPersistedStateSchema = z.strictObject({
  groupMode: SidebarGroupModeSchema.optional(),
  hostFilters: z.array(z.string()).optional(),
  projectFilters: z.array(z.string()).optional(),
  labelFilters: z.record(z.string(), LabelFilterModeSchema).optional(),
  labelMatch: LabelMatchModeSchema.optional(),
  savedViews: z.array(SavedSidebarViewStorageSchema).optional(),
  activeSavedViewId: z.string().nullable().optional(),
  hostFilter: z.string().nullable().optional(),
  groupModeByServerId: z.record(z.string(), SidebarGroupModeSchema).optional(),
});

type SidebarViewStorageState = z.infer<typeof SidebarViewPersistedStateSchema>;

function readLegacyGroupMode(persistedState: SidebarViewStorageState): SidebarGroupMode | null {
  const groupModeByServerId = persistedState.groupModeByServerId;
  if (!groupModeByServerId) {
    return null;
  }

  const modes = Object.values(groupModeByServerId);
  if (modes.length === 0) return null;
  return modes.includes("status") ? "status" : "project";
}

// Reads the host filter from any persisted shape: the current `hostFilters` array, or the
// pre-v2 single `hostFilter` string (null/absent meant "all hosts").
function readHostFilters(persistedState: SidebarViewStorageState): string[] {
  const hostFilters = persistedState.hostFilters;
  if (hostFilters) {
    return hostFilters;
  }
  // COMPAT(sidebarHostFilters): added in v0.1.102, remove after 2026-12-30 once pre-v2 persisted
  // sidebar state (a single `hostFilter` string) has aged out.
  const legacyHostFilter = persistedState.hostFilter;
  return legacyHostFilter ? [legacyHostFilter] : [];
}

function readSavedViews(persistedState: SidebarViewStorageState): SavedSidebarView[] {
  const stored = persistedState.savedViews;
  if (!Array.isArray(stored)) return [];
  const views: SavedSidebarView[] = [];
  for (const entry of stored) {
    const id = entry.id;
    const name = entry.name.trim();
    if (id.length === 0 || name.length === 0) continue;
    views.push({
      id,
      name,
      groupMode: entry.groupMode ?? null,
      hostFilters: entry.hostFilters ?? [],
      projectFilters: entry.projectFilters ?? [],
      labelFilters: readLabelFilters(entry),
      labelMatch: readLabelMatch(entry),
    });
  }
  return views;
}

function readLabelFilters(persistedState: {
  labelFilters?: Record<string, LabelFilterMode>;
}): Record<string, LabelFilterMode> {
  const stored = persistedState.labelFilters;
  if (!stored) return {};
  const filters: Record<string, LabelFilterMode> = {};
  for (const [name, mode] of Object.entries(stored)) {
    const key = name.trim().toLowerCase();
    if (key.length === 0) continue;
    filters[key] = mode;
  }
  return filters;
}

/**
 * Absent is `any`, which is what every view saved before the mode existed meant and what a view
 * with fewer than two included labels means whatever it says. No store version bump: there is
 * nothing to rewrite, only a default to read.
 */
function readLabelMatch(persistedState: { labelMatch?: LabelMatchMode }): LabelMatchMode {
  return persistedState.labelMatch === "all" ? "all" : "any";
}

const EMPTY_SIDEBAR_VIEW: SidebarViewPersistedState = {
  groupMode: "project",
  hostFilters: [],
  projectFilters: [],
  labelFilters: {},
  labelMatch: "any",
  savedViews: [],
  activeSavedViewId: null,
};

export function migrateSidebarViewState(persistedState: unknown): SidebarViewPersistedState {
  const result = SidebarViewPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return EMPTY_SIDEBAR_VIEW;
  }
  const state = result.data;

  const legacyGroupMode = readLegacyGroupMode(state);
  if (legacyGroupMode) {
    return { ...EMPTY_SIDEBAR_VIEW, groupMode: legacyGroupMode };
  }

  const savedViews = readSavedViews(state);
  const activeSavedViewId =
    typeof state.activeSavedViewId === "string" ? state.activeSavedViewId : null;
  return {
    groupMode: state.groupMode ?? "project",
    hostFilters: readHostFilters(state),
    projectFilters: state.projectFilters ?? [],
    labelFilters: readLabelFilters(state),
    labelMatch: readLabelMatch(state),
    savedViews,
    // A view that is no longer there cannot be the one you are in.
    activeSavedViewId: savedViews.some((view) => view.id === activeSavedViewId)
      ? activeSavedViewId
      : null,
  };
}

function toggleFilterEntry(entries: readonly string[], entry: string): string[] {
  return entries.includes(entry) ? entries.filter((value) => value !== entry) : [...entries, entry];
}

/**
 * Drops entries that no longer exist, or returns null when nothing changed so the caller can keep
 * the current state object and skip a re-render.
 *
 * An allowlist that has lost every entry it named would hide everything, which reads as a broken
 * sidebar rather than as a filter — so an emptied list means "all" again, same as never having
 * picked anything.
 */
function reconcileFilterEntries(
  entries: readonly string[],
  available: readonly string[],
): string[] | null {
  if (entries.length === 0) return null;
  const allowed = new Set(available);
  const next = entries.filter((entry) => allowed.has(entry));
  return next.length === entries.length ? null : next;
}

/**
 * Moves one entry to a new key, keeping its mode. The old key's position in the object is not
 * preserved — nothing reads these in order, they are looked up by name.
 */
function remapLabelFilterKey(
  filters: Readonly<Record<string, LabelFilterMode>>,
  fromKey: string,
  toKey: string,
): Record<string, LabelFilterMode> {
  const { [fromKey]: mode, ...rest } = filters;
  if (mode === undefined) return filters;
  return { ...rest, [toKey]: mode };
}

function nextLabelFilters(
  rest: Record<string, LabelFilterMode>,
  key: string,
  current: LabelFilterMode | undefined,
  direction: LabelFilterCycleDirection,
): Record<string, LabelFilterMode> {
  if (direction === "backward") {
    if (current === undefined) return { ...rest, [key]: "exclude" };
    if (current === "exclude") return { ...rest, [key]: "include" };
    return rest;
  }
  if (current === undefined) return { ...rest, [key]: "include" };
  if (current === "include") return { ...rest, [key]: "exclude" };
  return rest;
}

export function createSidebarViewStorage(
  backingStorage: StateStorage = AsyncStorage,
): StateStorage {
  return {
    getItem: async (name) => {
      const value = await backingStorage.getItem(name);
      if (value !== null || name !== SIDEBAR_VIEW_STORAGE_KEY) {
        return value;
      }
      return backingStorage.getItem(LEGACY_SIDEBAR_GROUP_MODE_STORAGE_KEY);
    },
    setItem: (name, value) => backingStorage.setItem(name, value),
    removeItem: (name) => backingStorage.removeItem(name),
  };
}

export const useSidebarViewStore = create<SidebarViewStoreState>()(
  persist(
    (set) => ({
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
      savedViews: [],
      activeSavedViewId: null,
      setGroupMode: (mode) => set({ groupMode: mode }),
      toggleHostFilter: (serverId) =>
        set((state) => ({
          hostFilters: toggleFilterEntry(state.hostFilters, serverId),
        })),
      clearHostFilters: () => set({ hostFilters: [] }),
      reconcileHostFilters: (serverIds) =>
        set((state) => {
          const next = reconcileFilterEntries(state.hostFilters, serverIds);
          return next ? { hostFilters: next } : state;
        }),
      toggleProjectFilter: (viewKey) =>
        set((state) => ({
          projectFilters: toggleFilterEntry(state.projectFilters, viewKey),
        })),
      clearProjectFilters: () => set({ projectFilters: [] }),
      reconcileProjectFilters: (viewKeys) =>
        set((state) => {
          const next = reconcileFilterEntries(state.projectFilters, viewKeys);
          return next ? { projectFilters: next } : state;
        }),
      // Neutral, then "only these", then "never these", then back. One control per label rather
      // than two, because a label is one thing you have an opinion about and the three states are
      // the whole opinion.
      //
      // Backward is the same ring walked the other way, so "never these" is one press from neutral
      // instead of two. Three states make a short ring and a wrong guess cheap, which is why the
      // reverse is a modifier on the same control rather than a second one.
      cycleLabelFilter: (name, direction = "forward") =>
        set((state) => {
          const key = name.trim().toLowerCase();
          if (key.length === 0) return state;
          const { [key]: current, ...rest } = state.labelFilters;
          const next = nextLabelFilters(rest, key, current, direction);
          return { labelFilters: next };
        }),
      clearLabelFilters: () => set({ labelFilters: {} }),
      setLabelMatch: (mode) => set({ labelMatch: mode }),
      // Deleting a label takes it off every workspace, so an include filter naming it can only
      // ever hide everything and a saved view holding it is a view of nothing. Neither is
      // recoverable by cycling the chip, because the chip is gone with the label.
      forgetLabelFilter: (name) =>
        set((state) => {
          const key = name.trim().toLowerCase();
          if (key.length === 0) return state;
          const inFilters = key in state.labelFilters;
          const inViews = state.savedViews.some((view) => key in view.labelFilters);
          if (!inFilters && !inViews) return state;
          const { [key]: _removed, ...labelFilters } = state.labelFilters;
          return {
            labelFilters,
            savedViews: state.savedViews.map((view) => {
              if (!(key in view.labelFilters)) return view;
              const { [key]: _dropped, ...rest } = view.labelFilters;
              return { ...view, labelFilters: rest };
            }),
          };
        }),
      // A rename keeps the label, so unlike a delete the filter still means something — it just
      // means it under a new key. Dropping it instead would silently widen what you are looking at.
      renameLabelFilter: (from, to) =>
        set((state) => {
          const fromKey = from.trim().toLowerCase();
          const toKey = to.trim().toLowerCase();
          if (fromKey.length === 0 || toKey.length === 0 || fromKey === toKey) return state;
          const inFilters = fromKey in state.labelFilters;
          const inViews = state.savedViews.some((view) => fromKey in view.labelFilters);
          if (!inFilters && !inViews) return state;
          return {
            labelFilters: remapLabelFilterKey(state.labelFilters, fromKey, toKey),
            savedViews: state.savedViews.map((view) =>
              fromKey in view.labelFilters
                ? { ...view, labelFilters: remapLabelFilterKey(view.labelFilters, fromKey, toKey) }
                : view,
            ),
          };
        }),
      createSavedSidebarView: (view) =>
        set((state) => {
          const name = view.name.trim();
          if (name.length === 0) return state;
          // The sidebar moves to the view it just saved. The dialog opens on the arrangement you
          // are in but lets you change it before saving, so leaving the sidebar behind would mark
          // a brand new view active while showing something else.
          return {
            savedViews: [...state.savedViews, { ...view, name }],
            activeSavedViewId: view.id,
            groupMode: view.groupMode ?? state.groupMode,
            hostFilters: [...view.hostFilters],
            projectFilters: [...view.projectFilters],
            labelFilters: { ...view.labelFilters },
            labelMatch: view.labelMatch,
          };
        }),
      applySavedSidebarView: (id) =>
        set((state) => {
          const view = state.savedViews.find((entry) => entry.id === id);
          if (!view) return state;
          return {
            groupMode: view.groupMode ?? state.groupMode,
            hostFilters: [...view.hostFilters],
            projectFilters: [...view.projectFilters],
            labelFilters: { ...view.labelFilters },
            labelMatch: view.labelMatch,
            activeSavedViewId: id,
          };
        }),
      /**
       * Leave the view you are in and show everything again.
       *
       * The same two facets the hidden rail's Clear drops, plus the view id — one meaning of
       * "clear" in the app rather than two. The host filter survives on purpose: it says which
       * machines you are looking at, not which work, and a view that set one leaves you scoped
       * to those hosts the way choosing them by hand would.
       *
       * The label match mode survives for its own reason: it says how you read a set of labels,
       * and with no labels left it says nothing at all.
       */
      clearActiveSidebarView: () =>
        set({ activeSavedViewId: null, projectFilters: [], labelFilters: {} }),
      // Editing a view is applying it, moving the filters, and saving that. There is no separate
      // editor: the sidebar is the editor, and it shows the result while you work rather than
      // asking you to picture it from a list of rules.
      updateSavedSidebarView: (id) =>
        set((state) => ({
          savedViews: state.savedViews.map((view) =>
            view.id === id
              ? {
                  ...view,
                  // A view that leaves the grouping alone keeps leaving it alone. Update captures
                  // the filters you moved, not a rule the view was written without.
                  groupMode: view.groupMode === null ? null : state.groupMode,
                  hostFilters: [...state.hostFilters],
                  projectFilters: [...state.projectFilters],
                  labelFilters: { ...state.labelFilters },
                  labelMatch: state.labelMatch,
                }
              : view,
          ),
          activeSavedViewId: id,
        })),
      // Editing a view in the dialog rather than by moving the sidebar. The two ways to change a
      // view answer different questions — "capture what I am looking at" versus "change what this
      // one means" — so both exist, and this one is the only way to reach a view you are not in.
      editSavedSidebarView: (id, edit) =>
        set((state) => {
          if (!state.savedViews.some((view) => view.id === id)) return state;
          const savedViews = state.savedViews.map((view) =>
            view.id === id ? { ...edit, id } : view,
          );
          // Editing the view you are in moves the sidebar with it. Leaving it behind would mark the
          // view edited the moment you saved it, against an arrangement you just described.
          if (state.activeSavedViewId !== id) return { savedViews };
          return {
            savedViews,
            groupMode: edit.groupMode ?? state.groupMode,
            hostFilters: [...edit.hostFilters],
            projectFilters: [...edit.projectFilters],
            labelFilters: { ...edit.labelFilters },
            labelMatch: edit.labelMatch,
          };
        }),
      deleteSavedSidebarView: (id) =>
        set((state) => ({
          savedViews: state.savedViews.filter((view) => view.id !== id),
          // Deleting the view you are in leaves the filters alone. They are still what you are
          // looking at; all that is gone is the name for them.
          activeSavedViewId: state.activeSavedViewId === id ? null : state.activeSavedViewId,
        })),
    }),
    {
      name: SIDEBAR_VIEW_STORAGE_KEY,
      version: SIDEBAR_VIEW_STORE_VERSION,
      storage: createValidatedPersistStorage(
        createSidebarViewStorage(),
        SidebarViewPersistedStateSchema,
      ),
      partialize: (state) => ({
        groupMode: state.groupMode,
        hostFilters: state.hostFilters,
        projectFilters: state.projectFilters,
        labelFilters: state.labelFilters,
        labelMatch: state.labelMatch,
        savedViews: state.savedViews,
        activeSavedViewId: state.activeSavedViewId,
      }),
      migrate: migrateSidebarViewState,
    },
  ),
);
