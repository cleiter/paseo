import { z } from "zod";

import type { AgentTimelineItem } from "../../../agent-sdk-types.js";
import { normalizeProviderReplayTimestamp } from "../../../provider-history-timestamps.js";
import type { ProviderSubagentStatus } from "../../../provider-subagents/store.js";
import { resolveObservedClaudeModelId } from "../models.js";
import type { SubagentObservation } from "./observation.js";
import { buildClaudeSubagentSubtitle, type ClaudeSubagentUsage } from "./presentation.js";

/**
 * Rebuilds subagent observations from a persisted session, producing the same vocabulary the
 * live task-protocol source produces. Identical observations in means identical descriptor
 * state out, so a fact is derived once for both paths rather than once per path.
 *
 * Claude Code writes each subagent as `<session>/subagents/agent-<agentId>.jsonl` beside an
 * `agent-<agentId>.meta.json`. The meta file carries the Task `tool_use_id`, which is the same
 * canonical id the live stream uses — it is the bridge that lets the two paths agree.
 */

const ClaudeSubagentMetaSchema = z.object({
  agentType: z.string().optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  toolUseId: z.string().optional().catch(undefined),
  spawnDepth: z.number().optional().catch(undefined),
});

export type ClaudeSubagentMeta = z.infer<typeof ClaudeSubagentMetaSchema>;

/**
 * Parse a sidecar meta file. This is undocumented Claude Code internals, so every field is
 * optional and a malformed file is indistinguishable from an absent one: callers fall back to
 * the parent-transcript derivation rather than losing the subagent.
 */
export function parseClaudeSubagentMeta(contents: string): ClaudeSubagentMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }
  const result = ClaudeSubagentMetaSchema.safeParse(parsed);
  if (!result.success) return null;
  const meta = result.data;
  const hasAnyField =
    meta.agentType !== undefined ||
    meta.description !== undefined ||
    meta.toolUseId !== undefined ||
    meta.spawnDepth !== undefined;
  return hasAnyField ? meta : null;
}

export interface ClaudeReplayEntry {
  type?: unknown;
  agentId?: unknown;
  timestamp?: unknown;
  /** Claude Code stamps the active effort on each assistant entry. */
  effort?: unknown;
  message?: { content?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Last-observed model and effort from a subagent's own assistant entries.
 *
 * Effort is replay-only: the SDK's live assistant message does not carry it, and it can be
 * silently downgraded for the selected model, so any live value would be a guess.
 */
function readRuntime(entries: readonly ClaudeReplayEntry[]): { model?: string; effort?: string } {
  const runtime: { model?: string; effort?: string } = {};
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const effort = typeof entry.effort === "string" ? entry.effort.trim() : "";
    if (effort) runtime.effort = effort;
    const rawModel = (entry.message as { model?: unknown } | undefined)?.model;
    const model = resolveObservedClaudeModelId(typeof rawModel === "string" ? rawModel : undefined);
    if (model) runtime.model = model;
  }
  return runtime;
}

/**
 * Token counters as Claude Code stamps them onto an assistant entry. Undocumented internals, so
 * every field is optional and a wrong-typed field reads as absent rather than failing the entry.
 */
const ClaudeReplayUsageSchema = z.object({
  input_tokens: z.number().optional().catch(undefined),
  cache_creation_input_tokens: z.number().optional().catch(undefined),
  cache_read_input_tokens: z.number().optional().catch(undefined),
  output_tokens: z.number().optional().catch(undefined),
});

/**
 * The one number the live path calls `total_tokens`.
 *
 * This is not a guess. Claude Code 2.1.220 finalizes a subagent by summing the usage block of the
 * LAST assistant message — `input + (cache_creation ?? 0) + (cache_read ?? 0) + output` — and ships
 * that as `usage.total_tokens` on `task_notification`; `task_progress` reports the same sum from
 * the live tracker as it climbs. So it is a context-size reading at the final turn, not a
 * cumulative spend across turns, which is why a small subagent reports a number in the tens of
 * thousands: the reused prompt cache dominates it. Summing per-entry usage instead would multiply
 * the cached prefix by the turn count and report a number several times larger than the live path.
 */
function readTotalTokens(raw: unknown): number | undefined {
  const parsed = ClaudeReplayUsageSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens } =
    parsed.data;
  const counters = [
    input_tokens,
    cache_creation_input_tokens,
    cache_read_input_tokens,
    output_tokens,
  ];
  // An object with none of the four counters is not a usage block; reporting 0 would claim the
  // subagent spent nothing.
  if (counters.every((counter) => counter === undefined)) return undefined;
  return counters.reduce((total: number, counter) => total + (counter ?? 0), 0);
}

/**
 * Token context of a subagent's run, recovered from its own transcript.
 *
 * Descriptors are in-memory and dropped when the agent closes, so without this a reopened agent
 * permanently loses its children's counters. The live path gets these numbers handed to it by
 * Claude Code; here they are re-derived to match those definitions:
 *
 * The last assistant entry's summed usage matches Claude Code's live `total_tokens` definition.
 */
function readUsage(entries: readonly ClaudeReplayEntry[]): ClaudeSubagentUsage | null {
  let totalTokens: number | undefined;

  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const observed = readTotalTokens(entry.message?.usage);
    if (observed !== undefined) totalTokens = observed;
  }

  return totalTokens === undefined ? null : { totalTokens };
}

export interface ClaudeReplaySubagentInput {
  agentId: string;
  meta: ClaudeSubagentMeta | null;
  entries: ClaudeReplayEntry[];
}

export interface ClaudeReplayParentFacts {
  /** Task `tool_use` id -> identity declared in the parent's tool input. */
  toolCalls: ReadonlyMap<string, { title?: string; description?: string }>;
  /** agentId -> tool call, recovered by scraping tool-result text. Legacy fallback only. */
  linksByAgentId: ReadonlyMap<string, { toolCallId: string; failed: boolean }>;
  /** Task `tool_use` id -> outcome. Usable once meta.json supplies the link directly. */
  outcomesByToolCallId: ReadonlyMap<string, { failed: boolean }>;
}

interface ParentLink {
  id: string;
  toolCallId: string | null;
  /** Terminal status the parent implies, or null when the child may still be running. */
  status: ProviderSubagentStatus | null;
}

/**
 * Everything the parent transcript can say about one child: its canonical id and, when the parent
 * settles the question, its terminal status.
 *
 * `meta.toolUseId` is authoritative for identity — it is the same id the live stream keys on. The
 * legacy path scrapes `agentId:` out of stringified tool-result content, which both misses the link
 * when the parent's tool_result is absent and matches unrelated text — on a real five-subagent
 * session it produced eight ids, inventing `z`, `string`, and `update`. It stays only as a fallback
 * for sessions recorded before the meta file existed.
 *
 * ```
 * meta.toolUseId present?
 * ├─ yes → outcomesByToolCallId has it?
 * │         ├─ hit, is_error   → "failed"       id = toolCallId = toolUseId
 * │         ├─ hit, ok         → "completed"    id = toolCallId = toolUseId
 * │         └─ miss → parent.toolCalls has it?
 * │                   ├─ yes   → null           interrupted mid-Task; a resume
 * │                   │                         may still finish it — keep running
 * │                   └─ no    → "completed"    no Task call ⇒ nothing in the parent
 * │                                             can ever name it
 * └─ no  → linksByAgentId (legacy scrape) hit?
 *           ├─ hit, failed     → "failed"       id = toolCallId = scraped id
 *           ├─ hit, ok         → "completed"
 *           └─ miss            → "completed"    id = agentId, toolCallId = null
 * ```
 *
 * Outcomes are only ever recorded for a child whose Task call was parsed out of the parent
 * (`agent.ts` skips any tool_result whose id is not in `toolCalls`). So a child with no Task call
 * is one no reader can finish: across every such transcript recorded on a real machine, no
 * `tool_result` for it exists in the parent at all. Calling it completed is the only status that
 * does not strand it as running forever. A child that *does* have a Task call but no result yet is
 * the opposite case — the parent was interrupted mid-Task — and keeps running.
 */
function resolveParentLink(
  subagent: ClaudeReplaySubagentInput,
  parent: ClaudeReplayParentFacts,
): ParentLink {
  const metaToolUseId = subagent.meta?.toolUseId?.trim();
  if (metaToolUseId) {
    const outcome = parent.outcomesByToolCallId.get(metaToolUseId);
    if (outcome) {
      return {
        id: metaToolUseId,
        toolCallId: metaToolUseId,
        status: outcome.failed ? "failed" : "completed",
      };
    }
    return {
      id: metaToolUseId,
      toolCallId: metaToolUseId,
      status: parent.toolCalls.has(metaToolUseId) ? null : "completed",
    };
  }

  const scraped = parent.linksByAgentId.get(subagent.agentId);
  if (scraped) {
    return {
      id: scraped.toolCallId,
      toolCallId: scraped.toolCallId,
      status: scraped.failed ? "failed" : "completed",
    };
  }

  // No link at all. `parseClaudeSubagentMeta` collapses absent, malformed, and pre-sidecar metadata
  // into the same null, so all of those land here beside a genuine skill-spawned child: a
  // `/code-review` subagent has no Task tool_use to name, so its sidecar carries only `agentType`
  // and its id appears nowhere in the parent. Keep it visible under its own agent id rather than
  // dropping it — the transcript is real and readable.
  //
  // Known asymmetry: `live-source.ts` drops any announced task with no `tool_use_id`, so the live
  // path cannot declare a skill-spawned child and only replay produces this row. That is in tension
  // with the live/replay parity claim in `agent.ts`. Keeping the row is the reversible direction;
  // hiding a real transcript is not. If Claude Code ever does send a `tool_use_id` on the live
  // frame, this becomes an identity split — live would key the row by that id while replay keys it
  // by the raw agent id — and archive state would stop sticking across a reopen.
  return { id: subagent.agentId, toolCallId: null, status: "completed" };
}

/**
 * The parent's tool input is the same source the live path reads, so it wins; meta.json fills the
 * gap when the parent's Task call is missing from the transcript.
 */
function declareSubagent(
  subagent: ClaudeReplaySubagentInput,
  link: ParentLink,
  toolCall: { title?: string; description?: string } | undefined,
): SubagentObservation {
  const title = toolCall?.title ?? subagent.meta?.agentType;
  const description = toolCall?.description ?? subagent.meta?.description;
  const firstTimestamp = normalizeProviderReplayTimestamp(subagent.entries[0]?.timestamp);
  return {
    kind: "declared",
    id: link.id,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(link.toolCallId ? { toolCallId: link.toolCallId } : {}),
    ...(firstTimestamp ? { timestamp: firstTimestamp } : {}),
  };
}

function observeSubtitle(
  subagent: ClaudeReplaySubagentInput,
  link: ParentLink,
  title: string | undefined,
): SubagentObservation | null {
  const runtime = readRuntime(subagent.entries);
  const usage = readUsage(subagent.entries);
  const hasDetails =
    runtime.model !== undefined ||
    runtime.effort !== undefined ||
    (usage?.totalTokens !== undefined && usage.totalTokens > 0);
  if (!hasDetails) return null;
  const subtitle = buildClaudeSubagentSubtitle({
    title,
    ...runtime,
    ...(usage ? { usage } : {}),
  });
  if (!subtitle) return null;
  const timestamp = normalizeProviderReplayTimestamp(subagent.entries.at(-1)?.timestamp);
  return {
    kind: "subtitle",
    id: link.id,
    subtitle,
    ...(timestamp ? { timestamp } : {}),
  };
}

function observeSubagent(
  subagent: ClaudeReplaySubagentInput,
  parent: ClaudeReplayParentFacts,
  convertEntry: (entry: ClaudeReplayEntry) => AgentTimelineItem[],
): SubagentObservation[] {
  const link = resolveParentLink(subagent, parent);
  const toolCall = link.toolCallId ? parent.toolCalls.get(link.toolCallId) : undefined;

  const observations: SubagentObservation[] = [declareSubagent(subagent, link, toolCall)];
  const subtitle = observeSubtitle(subagent, link, toolCall?.title ?? subagent.meta?.agentType);
  if (subtitle) observations.push(subtitle);

  for (const entry of subagent.entries) {
    const timestamp = normalizeProviderReplayTimestamp(entry.timestamp);
    for (const item of convertEntry(entry)) {
      observations.push({
        kind: "timeline",
        id: link.id,
        item,
        ...(timestamp ? { timestamp } : {}),
      });
    }
  }

  // No terminal status means the parent was interrupted mid-Task, so leave the child running rather
  // than inventing a completion. The timestamp is the child's last entry, so a finished row sorts
  // at the time it actually stopped rather than at reopen.
  if (link.status) {
    const lastTimestamp = normalizeProviderReplayTimestamp(subagent.entries.at(-1)?.timestamp);
    observations.push({
      kind: "status",
      id: link.id,
      status: link.status,
      ...(lastTimestamp ? { timestamp: lastTimestamp } : {}),
    });
  }

  return observations;
}

/**
 * Whether this transcript belongs to a child of the session being replayed.
 *
 * Claude Code writes every descendant into the same `subagents/` directory, not just the session's
 * own children, and `spawnDepth` is what separates them: 1 is a direct child, 2+ was spawned by
 * another subagent. A grandchild's `toolUseId` names a Task call made inside its parent's session,
 * so nothing in this transcript can resolve it — surveyed across recorded sessions, every depth-1
 * id matched a Task tool_use block in the parent transcript and no deeper id did. Replaying them
 * anyway adds rows the live stream never showed, each with no Task card and no recoverable outcome.
 * One session recorded 10 subagents live and would replay 22.
 *
 * Absent depth means a session recorded before the field existed: keep the subagent rather than
 * lose it, matching how every other missing field here is treated.
 */
function isDirectChild(subagent: ClaudeReplaySubagentInput): boolean {
  const depth = subagent.meta?.spawnDepth;
  return depth === undefined || depth <= 1;
}

export function observeReplaySubagents(input: {
  subagents: readonly ClaudeReplaySubagentInput[];
  parent: ClaudeReplayParentFacts;
  convertEntry: (entry: ClaudeReplayEntry) => AgentTimelineItem[];
}): SubagentObservation[] {
  const observations: SubagentObservation[] = [];
  for (const subagent of input.subagents) {
    if (!isDirectChild(subagent)) continue;
    observations.push(...observeSubagent(subagent, input.parent, input.convertEntry));
  }
  return observations;
}
