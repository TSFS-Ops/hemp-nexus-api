/**
 * P-5 Batch 4 Stage 7 — Readiness / Memory bridge (pure).
 *
 * Wraps `buildMemorySummary` with the additional Stage 7 guard surface:
 *  - bridge must be explicitly enabled,
 *  - finality must have been admin-recorded,
 *  - readiness must be one of the bridge-eligible statuses,
 *  - any raw bank, ID, tax, UBO, passport, personal-document and
 *    unrestricted-sensitive-evidence fields are stripped — twice
 *    (once via memory-summary, once again as defence-in-depth here).
 */
import {
  buildMemorySummary,
  stripSensitiveFields,
  P5B4_MEMORY_FORBIDDEN_FIELDS,
  type P5B4MemorySummary,
  type P5B4MemorySummaryInput,
} from "./memory-summary";
import type { P5B4ReadinessStatus, P5B4RoleKey } from "./constants";
import { P5B4_TERMINAL_FINALITY_OUTCOMES } from "./finality";

export const P5B4_MEMORY_BRIDGE_ELIGIBLE_READINESS: ReadonlySet<P5B4ReadinessStatus> =
  new Set(["ready_for_finality"]);

export interface P5B4MemoryBridgeInput {
  enable_bridge: boolean;
  has_admin_recorded_finality: boolean;
  readiness_status: P5B4ReadinessStatus;
  actor_role: P5B4RoleKey | null;
  memory: P5B4MemorySummaryInput;
}

export interface P5B4MemoryBridgeResult {
  bridge_allowed: boolean;
  reasons: string[];
  payload: P5B4MemorySummary | null;
}

/** Defence-in-depth strip applied a second time to the produced summary. */
function reStripSummary(s: P5B4MemorySummary): P5B4MemorySummary {
  return {
    ...s,
    safe_facts: stripSensitiveFields(s.safe_facts),
  };
}

export function evaluateMemoryBridge(
  input: P5B4MemoryBridgeInput,
): P5B4MemoryBridgeResult {
  const reasons: string[] = [];
  if (!input.enable_bridge) reasons.push("bridge_disabled");
  if (!input.has_admin_recorded_finality) reasons.push("finality_not_recorded_by_admin");
  if (input.actor_role !== "platform_admin") reasons.push("actor_not_platform_admin");
  if (!P5B4_MEMORY_BRIDGE_ELIGIBLE_READINESS.has(input.readiness_status)) {
    reasons.push("readiness_not_bridge_eligible");
  }
  if (!P5B4_TERMINAL_FINALITY_OUTCOMES.has(input.memory.final_outcome)) {
    reasons.push("non_terminal_finality");
  }

  if (reasons.length > 0) {
    return { bridge_allowed: false, reasons, payload: null };
  }
  const summary = reStripSummary(buildMemorySummary(input.memory));
  // Final assertion: no forbidden field name survived.
  for (const k of Object.keys(summary.safe_facts)) {
    const lower = k.toLowerCase();
    if (P5B4_MEMORY_FORBIDDEN_FIELDS.some((f) => lower.includes(f))) {
      throw new Error(`P5B4 memory-bridge leak: forbidden field "${k}" survived strip`);
    }
  }
  return { bridge_allowed: true, reasons: [], payload: summary };
}
