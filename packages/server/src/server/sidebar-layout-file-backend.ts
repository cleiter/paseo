import { promises as fs } from "node:fs";

import type { Logger } from "pino";
import { SidebarLayoutSchema, type SidebarLayout } from "@getpaseo/protocol/messages";

import { writeJsonFileAtomic } from "./atomic-file.js";
import type { SidebarLayoutBackend } from "./sidebar-layout-store.js";

// The JSON-on-disk backend for the sidebar layout ($PASEO_HOME/projects/sidebar-layout.json).
// Everything storage-specific lives here; SidebarLayoutStore owns the document rules and
// knows nothing about files.
//
// This is deliberately NOT a FileBackedRegistry. That class swallows a JSON parse error on
// load, leaves the cache empty, and lets the next write serialize the empty cache straight
// over the file. For agent-derived records that is merely rude; for a document the user
// authored by hand-arranging their sidebar it is silent data loss.
export class FileSidebarLayoutBackend implements SidebarLayoutBackend {
  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<SidebarLayout | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      // First run. An absent document is the empty document.
      return null;
    }

    const parsed = SidebarLayoutSchema.safeParse(safeParseJson(raw));
    if (parsed.success) {
      return parsed.data;
    }

    // Unreadable. Move it aside rather than let the next write overwrite it: the user
    // arranged this by hand and we are not going to be the reason it is gone. They boot
    // into an empty layout, and the file they had is still on disk next to it.
    const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`;
    await fs.rename(this.filePath, quarantinePath);
    this.logger.error(
      { filePath: this.filePath, quarantinePath, issues: parsed.error.issues },
      "Sidebar layout file was unreadable; quarantined it and started from an empty layout",
    );
    return null;
  }

  async save(layout: SidebarLayout): Promise<void> {
    await writeJsonFileAtomic(this.filePath, layout);
  }
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
