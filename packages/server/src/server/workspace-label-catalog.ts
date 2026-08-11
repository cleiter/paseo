import { promises as fs } from "node:fs";

import type { Logger } from "pino";
import { z } from "zod";

import {
  deriveWorkspaceLabelColor,
  isWorkspaceLabelColor,
  normalizeWorkspaceLabel,
  normalizeWorkspaceLabelCatalog,
  type WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";

import { writeJsonFileAtomic } from "./atomic-file.js";

/**
 * Which colour each label is drawn in, for this daemon.
 *
 * The catalog holds presentation only. Which workspace carries which label lives on the
 * workspace record, keyed by name, and this file never has to agree with it: a workspace may
 * carry a label the catalog has never heard of (labelled on another host, or the catalog write
 * lost a race) and it still renders, in its derived colour. That one-way relationship is what
 * lets two daemons merge their catalogs by name in the client without a reconciliation pass on
 * either side.
 *
 * Stored as an array rather than a name->colour object so the file stays diffable and the reader
 * keeps one code path with the wire shape.
 */

const StoredLabelSchema = z.object({
  name: z.string(),
  // Read as a plain string, not an enum: a colour written by a newer client must not make the
  // whole file fail to parse. `normalizeWorkspaceLabelCatalog` maps an unknown value back onto
  // the derived colour when the catalog is built.
  color: z.string(),
});

export interface WorkspaceLabelCatalogStore {
  initialize(): Promise<void>;
  list(): Promise<WorkspaceLabelDefinition[]>;
  /** Upsert by name. An existing entry is recoloured; the stored spelling is left alone. */
  set(input: { name: string; color: string }): Promise<WorkspaceLabelDefinition[]>;
  remove(name: string): Promise<WorkspaceLabelDefinition[]>;
  /**
   * Moves an entry's colour onto a new name. A no-op when the old name has no entry — the label
   * exists on the workspaces either way, and the assignments are what the caller renames next.
   */
  rename(input: { from: string; to: string }): Promise<WorkspaceLabelDefinition[]>;
  /**
   * Fires after every write, with the new catalog. The daemon broadcasts from here rather than
   * from the handler that did the write, so recolouring a label on your laptop repaints the
   * chips on your phone — every session hears about it, not just the one that asked.
   */
  subscribe(listener: (catalog: WorkspaceLabelDefinition[]) => void): () => void;
}

export class FileBackedWorkspaceLabelCatalog implements WorkspaceLabelCatalogStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private catalog: WorkspaceLabelDefinition[] = [];
  private loaded = false;
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(catalog: WorkspaceLabelDefinition[]) => void>();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "workspace-label-catalog" });
  }

  subscribe(listener: (catalog: WorkspaceLabelDefinition[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  async list(): Promise<WorkspaceLabelDefinition[]> {
    await this.load();
    return [...this.catalog];
  }

  async set(input: { name: string; color: string }): Promise<WorkspaceLabelDefinition[]> {
    await this.load();
    const name = normalizeWorkspaceLabel(input.name);
    if (name === null) {
      throw new Error("Label name is empty");
    }
    // An unrecognized colour is the caller's bug, not something to persist and paper over on
    // every later read — unlike the file loader, which has to stay tolerant of what is on disk.
    if (!isWorkspaceLabelColor(input.color)) {
      throw new Error(`Unknown label color: ${input.color}`);
    }
    const color = input.color;

    const key = name.toLowerCase();
    const index = this.catalog.findIndex((entry) => entry.name.toLowerCase() === key);
    if (index === -1) {
      this.catalog = [...this.catalog, { name, color }];
    } else {
      // Keep the stored spelling. Recolouring `Blocked` from a client that typed `blocked` is a
      // colour edit, and silently restyling the name is not what was asked for.
      const existing = this.catalog[index];
      this.catalog = this.catalog.map((entry, position) =>
        position === index ? { name: existing.name, color } : entry,
      );
    }

    await this.enqueuePersist();
    return [...this.catalog];
  }

  async remove(name: string): Promise<WorkspaceLabelDefinition[]> {
    await this.load();
    const key = name.trim().toLowerCase();
    const next = this.catalog.filter((entry) => entry.name.toLowerCase() !== key);
    if (next.length === this.catalog.length) {
      return [...this.catalog];
    }
    this.catalog = next;
    await this.enqueuePersist();
    return [...this.catalog];
  }

  async rename(input: { from: string; to: string }): Promise<WorkspaceLabelDefinition[]> {
    await this.load();
    const to = normalizeWorkspaceLabel(input.to);
    if (to === null) {
      throw new Error("Label name is empty");
    }
    const fromKey = input.from.trim().toLowerCase();
    const index = this.catalog.findIndex((entry) => entry.name.toLowerCase() === fromKey);
    if (index === -1) {
      return [...this.catalog];
    }
    const toKey = to.toLowerCase();
    this.catalog = this.catalog
      // A rename onto a name the catalog already holds would leave two entries for one label, and
      // the reader keys by name. Drop the one being renamed onto; the colour moving in replaces it.
      .filter((entry, position) => position === index || entry.name.toLowerCase() !== toKey)
      .map((entry) =>
        entry.name.toLowerCase() === fromKey ? { name: to, color: entry.color } : entry,
      );
    await this.enqueuePersist();
    return [...this.catalog];
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.catalog = [];
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = z.array(StoredLabelSchema).parse(JSON.parse(raw));
      this.catalog = normalizeWorkspaceLabelCatalog(parsed);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load workspace label catalog",
        );
      }
    }
    this.loaded = true;
  }

  private async enqueuePersist(): Promise<void> {
    const nextPersist = this.persistQueue.then(() =>
      writeJsonFileAtomic(this.filePath, this.catalog),
    );
    this.persistQueue = nextPersist.catch(() => {});
    await nextPersist;
    this.notify();
  }

  private notify(): void {
    const snapshot = [...this.catalog];
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn({ err: error }, "Workspace label catalog listener threw");
      }
    }
  }
}

/**
 * Resolves an optional catalog store to a real one. Callers that predate labels pass nothing and
 * get a private in-memory catalog; keeping the fallback here rather than inline keeps it out of
 * constructors that are already at the complexity cap.
 */
export function resolveWorkspaceLabelCatalog(
  store: WorkspaceLabelCatalogStore | undefined,
): WorkspaceLabelCatalogStore {
  return store ?? createInMemoryWorkspaceLabelCatalog();
}

/**
 * A catalog with no file behind it. The daemon always builds the file-backed one; this is what a
 * Session falls back to when it is constructed without a catalog, which keeps every test harness
 * that predates labels working without also making label writes silently succeed into nothing.
 */
export function createInMemoryWorkspaceLabelCatalog(): WorkspaceLabelCatalogStore {
  let catalog: WorkspaceLabelDefinition[] = [];
  const listeners = new Set<(next: WorkspaceLabelDefinition[]) => void>();

  const notify = () => {
    const snapshot = [...catalog];
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  return {
    initialize: async () => {},
    list: async () => [...catalog],
    set: async ({ name, color }) => {
      const normalized = normalizeWorkspaceLabel(name);
      if (normalized === null) {
        throw new Error("Label name is empty");
      }
      if (!isWorkspaceLabelColor(color)) {
        throw new Error(`Unknown label color: ${color}`);
      }
      const key = normalized.toLowerCase();
      const existing = catalog.find((entry) => entry.name.toLowerCase() === key);
      catalog = existing
        ? catalog.map((entry) =>
            entry.name.toLowerCase() === key ? { name: entry.name, color } : entry,
          )
        : [...catalog, { name: normalized, color }];
      notify();
      return [...catalog];
    },
    remove: async (name) => {
      const key = name.trim().toLowerCase();
      catalog = catalog.filter((entry) => entry.name.toLowerCase() !== key);
      notify();
      return [...catalog];
    },
    rename: async ({ from, to }) => {
      const normalized = normalizeWorkspaceLabel(to);
      if (normalized === null) {
        throw new Error("Label name is empty");
      }
      const fromKey = from.trim().toLowerCase();
      const toKey = normalized.toLowerCase();
      if (!catalog.some((entry) => entry.name.toLowerCase() === fromKey)) {
        return [...catalog];
      }
      catalog = catalog
        .filter(
          (entry) => entry.name.toLowerCase() === fromKey || entry.name.toLowerCase() !== toKey,
        )
        .map((entry) =>
          entry.name.toLowerCase() === fromKey ? { name: normalized, color: entry.color } : entry,
        );
      notify();
      return [...catalog];
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The catalog a client should see for labels that are in use, whether or not anyone has picked a
 * colour for them. Assignments are the source of truth for which labels exist; the catalog only
 * answers what colour they are, so a label nobody has coloured still comes back with one.
 *
 * The fill-ins are flagged `derived`. Without it the response says the same thing about a colour
 * someone chose and a colour this function invented a line ago, and the client's only way to
 * offer "put this label back to its automatic colour" would be to guess.
 */
export function withDerivedLabelColors(
  catalog: readonly WorkspaceLabelDefinition[],
  usedLabels: readonly string[],
): WorkspaceLabelCatalogEntry[] {
  const merged: WorkspaceLabelCatalogEntry[] = [...catalog];
  for (const label of usedLabels) {
    const key = label.toLowerCase();
    if (merged.some((entry) => entry.name.toLowerCase() === key)) {
      continue;
    }
    merged.push({ name: label, color: deriveWorkspaceLabelColor(label), derived: true });
  }
  return merged;
}

/** A catalog entry on its way to a client, which also says whether the colour was chosen. */
export interface WorkspaceLabelCatalogEntry extends WorkspaceLabelDefinition {
  derived?: boolean;
}
