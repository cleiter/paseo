/**
 * Writing a label's colour, and removing a label, across every host at once.
 *
 * A single-host write is the obvious implementation and it is wrong. Catalogs merge by name and
 * the merge is first-host-wins in sorted `serverId` order (`useWorkspaceLabelColors`), so
 * recolouring `blocked` on the host whose menu you happened to open changes nothing you can see
 * whenever another host sorts ahead of it and still holds the old colour. The picker would look
 * broken at random depending on which machines you have connected. Writing everywhere is what
 * makes it do what it says.
 *
 * The same argument settles delete: a label removed from one catalog and left in another comes
 * straight back the next time the other host broadcasts.
 *
 * Target selection and the outcome verdict are pure and live here; the fan-out is the thin part.
 */

import type { WorkspaceLabelColor } from "@getpaseo/protocol/workspace-labels";

export interface WorkspaceLabelCatalogHost {
  serverId: string;
  /** Whether a client exists for this host — i.e. it is connected. */
  connected: boolean;
  /** `server_info.features.workspaceLabels`. */
  supported: boolean;
  /** `server_info.features.workspaceLabelRename`, which shipped after the rest of labels. */
  supportsRename: boolean;
}

/**
 * A host that cannot take the write is not a failure, it is not a target. An old daemon rejects
 * the request by design, and an offline one was never going to answer; counting either as an
 * error would report a failed write every time you have a stale host in the list.
 */
export function selectWorkspaceLabelCatalogTargets(
  hosts: readonly WorkspaceLabelCatalogHost[],
): string[] {
  return hosts.filter((host) => host.connected && host.supported).map((host) => host.serverId);
}

/**
 * Rename is all-or-nothing across hosts, unlike the other writes.
 *
 * A colour that lands on some hosts leaves one label wearing whichever colour wins the merge. A
 * *name* that lands on some hosts leaves two labels — the old name and the new one, side by side
 * in the sidebar, because the name is the identity. So a host that cannot take the rename disables
 * it rather than being skipped: a partial rename is worse than no rename.
 */
export function canRenameWorkspaceLabelEverywhere(
  hosts: readonly WorkspaceLabelCatalogHost[],
): boolean {
  const reachable = hosts.filter((host) => host.connected && host.supported);
  return reachable.length > 0 && reachable.every((host) => host.supportsRename);
}

export type WorkspaceLabelCatalogWriteVerdict =
  | { status: "ok" }
  | { status: "noHost" }
  | { status: "partial"; failed: number; total: number; error: string }
  | { status: "failed"; error: string };

/**
 * `partial` is its own verdict rather than a rounded-up success or failure, because it is the one
 * outcome the user cannot see. A colour that landed on two hosts out of three is a colour that
 * may or may not be the one on screen, depending on which host wins the merge, and silence there
 * would be the picker lying about what it did.
 */
export function summarizeWorkspaceLabelCatalogWrites(
  results: readonly PromiseSettledResult<unknown>[],
): WorkspaceLabelCatalogWriteVerdict {
  if (results.length === 0) return { status: "noHost" };
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected.length === 0) return { status: "ok" };
  const error = errorMessage(rejected[0]?.reason);
  if (rejected.length === results.length) return { status: "failed", error };
  return { status: "partial", failed: rejected.length, total: results.length, error };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export interface WorkspaceLabelCatalogClient {
  setWorkspaceLabelColor: (name: string, color: string) => Promise<unknown>;
  removeWorkspaceLabel: (name: string, options?: { detach?: boolean }) => Promise<unknown>;
  renameWorkspaceLabel: (from: string, to: string) => Promise<unknown>;
}

export interface WorkspaceLabelCatalogWriteDeps {
  /**
   * Read when the write fires, not when the surface rendered. A dialog mounted at the app root
   * outlives the connection it writes through, so a host list captured at render says `connecting`
   * about a daemon that has been online for minutes.
   */
  getHosts: () => readonly WorkspaceLabelCatalogHost[];
  getClient: (serverId: string) => WorkspaceLabelCatalogClient | null;
}

/** Whether any connected host can take a catalog write at all — what gates the Edit labels row. */
export function canWriteWorkspaceLabelCatalog(
  hosts: readonly WorkspaceLabelCatalogHost[],
): boolean {
  return selectWorkspaceLabelCatalogTargets(hosts).length > 0;
}

async function fanOut(
  deps: WorkspaceLabelCatalogWriteDeps,
  write: (client: WorkspaceLabelCatalogClient) => Promise<unknown>,
): Promise<WorkspaceLabelCatalogWriteVerdict> {
  const clients = selectWorkspaceLabelCatalogTargets(deps.getHosts())
    .map((serverId) => deps.getClient(serverId))
    .filter((client): client is WorkspaceLabelCatalogClient => client !== null);
  const results = await Promise.allSettled(clients.map((client) => write(client)));
  return summarizeWorkspaceLabelCatalogWrites(results);
}

export function setWorkspaceLabelColorEverywhere(
  deps: WorkspaceLabelCatalogWriteDeps,
  input: { name: string; color: WorkspaceLabelColor },
): Promise<WorkspaceLabelCatalogWriteVerdict> {
  return fanOut(deps, (client) => client.setWorkspaceLabelColor(input.name, input.color));
}

/** Drops the pinned colour and leaves the label on the workspaces carrying it. */
export function resetWorkspaceLabelColorEverywhere(
  deps: WorkspaceLabelCatalogWriteDeps,
  input: { name: string },
): Promise<WorkspaceLabelCatalogWriteVerdict> {
  return fanOut(deps, (client) => client.removeWorkspaceLabel(input.name, { detach: false }));
}

/**
 * Renames a label on every host. Each daemon does its own sweep over the workspaces it holds —
 * the name is the identity, so there is no id to repoint, and the daemon is the one holding them.
 *
 * Gate this on `canRenameWorkspaceLabelEverywhere` rather than letting the fan-out skip hosts.
 */
export function renameWorkspaceLabelEverywhere(
  deps: WorkspaceLabelCatalogWriteDeps,
  input: { from: string; to: string },
): Promise<WorkspaceLabelCatalogWriteVerdict> {
  return fanOut(deps, (client) => client.renameWorkspaceLabel(input.from, input.to));
}

/** Drops the colour *and* strips the label off every workspace that carries it, on every host. */
export function deleteWorkspaceLabelEverywhere(
  deps: WorkspaceLabelCatalogWriteDeps,
  input: { name: string },
): Promise<WorkspaceLabelCatalogWriteVerdict> {
  return fanOut(deps, (client) => client.removeWorkspaceLabel(input.name, { detach: true }));
}
