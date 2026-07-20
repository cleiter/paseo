import type { Logger } from "pino";
import type { SidebarLayout } from "@getpaseo/protocol/messages";

// The sidebar layout document: the user's groups and their drag order, for both projects
// and workspaces. The daemon stores and serves it without interpreting it — every key in
// here is opaque to the server. See SidebarLayoutSchema for the model and why groups have
// to be entities rather than attributes on the records they contain.
//
// Persistence sits behind SidebarLayoutBackend so the storage engine can change without
// this file moving. The store owns the RULES (revision, conflict, publication); a backend
// owns only bytes in and bytes out. Swapping JSON-on-disk for SQLite is a new backend, not
// a rewrite of the document semantics.

export interface SidebarLayoutBackend {
  // Null means "nothing stored yet", which is the same thing as the empty document. A
  // backend that finds unreadable data is responsible for preserving it and reporting
  // null rather than throwing — the user should not lose the whole sidebar to one bad
  // byte, and should not be stuck unable to write either.
  load(): Promise<SidebarLayout | null>;
  save(layout: SidebarLayout): Promise<void>;
}

export type SidebarLayoutSetResult =
  | { status: "accepted"; layout: SidebarLayout }
  // The document moved on under the writer. The caller gets the authoritative layout
  // back so it can re-apply its edit rather than clobber a newer one.
  | { status: "stale"; layout: SidebarLayout };

export function createEmptySidebarLayout(): SidebarLayout {
  return {
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    projectGroups: [],
    workspaceGroups: [],
    ungroupedProjectKeys: [],
    ungroupedWorkspaceKeysByProject: {},
  };
}

// Holds a layout in memory and never persists it. Used where a server is constructed
// without real storage (tests, partial harnesses). It is deliberately a REAL backend
// rather than a null filePath: a store pointed at the real file that nobody remembered to
// initialize would report revision 0, accept a write against it, and overwrite the user's
// actual layout.
export function createInMemorySidebarLayoutBackend(): SidebarLayoutBackend {
  let stored: SidebarLayout | null = null;
  return {
    load: () => Promise.resolve(stored),
    save: (layout) => {
      stored = layout;
      return Promise.resolve();
    },
  };
}

export class SidebarLayoutStore {
  private layout: SidebarLayout = createEmptySidebarLayout();
  private loaded = false;
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly changeListeners = new Set<(layout: SidebarLayout) => void>();

  constructor(
    private readonly backend: SidebarLayoutBackend,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const stored = await this.backend.load();
    if (stored) {
      this.layout = stored;
    }
    this.loaded = true;
  }

  get(): SidebarLayout {
    return this.layout;
  }

  onChange(listener: (layout: SidebarLayout) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  async set(input: {
    layout: SidebarLayout;
    expectedRevision: number;
  }): Promise<SidebarLayoutSetResult> {
    if (input.expectedRevision !== this.layout.revision) {
      return { status: "stale", layout: this.layout };
    }
    // The revision belongs to the DOCUMENT, not to this daemon, and the client assigns
    // it. That is not an oversight — it is what makes N replicas converge.
    //
    // If each daemon incremented a counter of its own, two hosts that had been offline
    // for different lengths of time would end up on different revisions for identical
    // content (say 6 and 4). The client would read the higher one as the winner, push it
    // to the lower one, which would land at 5 — still behind. It would never converge.
    // A revision that travels with the content has no such gap.
    //
    // The server's job is only to refuse a write that was based on a stale read, and to
    // refuse one that would move the document backwards.
    if (input.layout.revision <= this.layout.revision) {
      return { status: "stale", layout: this.layout };
    }

    // Persist before publishing, so a failed write can never leave listeners (and
    // therefore other devices) believing in a layout that was never stored.
    await this.enqueuePersist(input.layout);
    this.layout = input.layout;

    for (const listener of this.changeListeners) {
      listener(input.layout);
    }
    return { status: "accepted", layout: input.layout };
  }

  // Serialized: two writes racing on the same document would otherwise interleave inside
  // the backend, and the loser could land last.
  private async enqueuePersist(layout: SidebarLayout): Promise<void> {
    const nextPersist = this.persistQueue.then(() => this.backend.save(layout));
    this.persistQueue = nextPersist.catch((error: unknown) => {
      this.logger.error({ err: error }, "Failed to persist the sidebar layout");
    });
    await nextPersist;
  }
}
