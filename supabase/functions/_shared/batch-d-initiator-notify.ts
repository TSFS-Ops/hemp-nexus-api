/**
 * Batch D — D4c-2 INITIATOR notification helper.
 *
 * ════════════════════════════════════════════════════════════════════
 * SCOPE
 * ════════════════════════════════════════════════════════════════════
 * Single chokepoint for all Batch D INITIATOR-side operational alerts.
 * D4c-2 implements the helper ONLY — it is NOT wired into any
 * production trigger site. Wiring is deferred to D4c-3.
 *
 * ════════════════════════════════════════════════════════════════════
 * SAFETY CONTRACT — READ BEFORE EDITING
 * ════════════════════════════════════════════════════════════════════
 *   - Only events in `D4C_INITIATOR_ALLOWLIST` may dispatch.
 *   - Recipients are derived ONLY via `resolveInitiatorRecipients`
 *     which intentionally ignores counterparty / candidate /
 *     disputed identity fields.
 *   - Subject and body come ONLY from the canonical event catalogue
 *     `safeWording` / `label`. Free-text interpolation of
 *     counterparty / commodity / org / candidate / disputed identity
 *     is forbidden and guarded by `findForbiddenWords`.
 *   - Hard suppression (`reason IN ('bounce','complaint')`) is
 *     honoured. Marketing `unsubscribe` does NOT block these
 *     operational notices (per signed Workflow Decision Form), but
 *     the audit row records that fact explicitly.
 *   - Audit logs NEVER store counterparty email, candidate org,
 *     binding-candidate data, or disputed-party identity. Recipient
 *     emails are stored as SHA-256 hashes, never plain text.
 *   - Dedupe: 60-minute audit-log window keyed on event_type +
 *     engagement_id + dedupe_key.
 *   - Helper is best-effort. It returns a structured result and
 *     never throws.
 * ════════════════════════════════════════════════════════════════════
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { clampSubject } from "./email-subject.ts";
import {
  resolveInitiatorRecipients as defaultResolveInitiatorRecipients,
  type HardSuppressionChecker,
  type InitiatorRecipient,
  type ResolveInitiatorRecipientsResult,
} from "./initiator-recipients.ts";

// ─────────────────────────────────────────────────────────────────────
// Catalogue mirror.
//
// The canonical catalogue lives in `src/lib/batch-d-events.ts` and is
// exercised by Vitest. Edge-function code cannot import from `src/`
// reliably under Deno, so we mirror the four catalogue fields the
// helper actually needs and pin parity in tests.
// ─────────────────────────────────────────────────────────────────────

interface CatalogueEntry {
  event: string;
  label: string;
  /** Mirror of `allowedRecipients` for the runtime invariant check. */
  allowedRecipients: ReadonlyArray<string>;
  /** Mirror of `forbiddenRecipients` for the runtime invariant check. */
  forbiddenRecipients: ReadonlyArray<string>;
  safeWording: string;
}

/**
 * Hard allowlist of events D4c-2 will dispatch.
 *
 * NOTE: `outreach.blocked.*` events are intentionally excluded from
 * D4c-2. Outreach-block notices are evaluated in a later D4c phase
 * after a recipient-class review.
 */
const D4C_INITIATOR_CATALOGUE: ReadonlyArray<CatalogueEntry> = [
  {
    event: "engagement.binding_review_required",
    label: "Binding review required",
    allowedRecipients: ["platform_admin"],
    forbiddenRecipients: [
      "initiating_org_admin",
      "counterparty_org_admin",
      "ordinary_org_member",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "A Pending Engagement requires a binding-review decision and is awaiting platform review.",
  },
  {
    event: "engagement.binding_review_resolved",
    label: "Binding review resolved",
    allowedRecipients: ["platform_admin"],
    forbiddenRecipients: [
      "counterparty_org_admin",
      "ordinary_org_member",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "Binding review resolved. The engagement state has been updated by the platform.",
  },
  {
    event: "engagement.disputed_being_named",
    label: "Counterparty dispute received",
    allowedRecipients: ["platform_admin"],
    forbiddenRecipients: [
      "ordinary_org_member",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "A counterparty has queried being named on a Pending Engagement. The engagement is paused for platform review.",
  },
  {
    event: "engagement.cancelled_email_change",
    label: "Cancelled for email change",
    allowedRecipients: ["platform_admin", "initiating_org_admin"],
    forbiddenRecipients: [
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "Pending Engagement cancelled for email change. The initiating organisation may create a replacement engagement.",
  },
  {
    event: "engagement.late_acceptance_pending_reconfirmation",
    label: "Late acceptance recorded — initiator reconfirmation required",
    allowedRecipients: ["initiating_org_admin", "platform_admin"],
    forbiddenRecipients: [
      "counterparty_org_admin",
      "ordinary_org_member",
      "external_unregistered_counterparty",
      "disputed_counterparty",
      "candidate_org",
    ],
    safeWording:
      "The Pending Engagement expired and the counterparty's late acceptance has been recorded. Initiator reconfirmation is required before the engagement can proceed. No Proof of Intent has been issued, no Without a Doubt has been triggered, and no credit has been used.",
  },
] as const;

export const D4C_INITIATOR_ALLOWLIST: ReadonlyArray<string> =
  D4C_INITIATOR_CATALOGUE.map((e) => e.event);

const D4C_CATALOGUE_BY_EVENT: ReadonlyMap<string, CatalogueEntry> = new Map(
  D4C_INITIATOR_CATALOGUE.map((e) => [e.event, e]),
);

// Mirror of `BATCH_D_FORBIDDEN_WORDS` — kept in sync with
// `src/lib/batch-d-events.ts` and pinned by parity test.
const FORBIDDEN_WORDS: ReadonlyArray<string> = [
  "accusation",
  "accuse",
  "guilty",
  "liable",
  "liability",
  "wrongdoing",
  "fraud",
  "fraudulent",
  "upheld",
  "dismissed",
  "winner",
  "loser",
  "blame",
  "fault",
  "violation",
  "breach",
] as const;

function findForbiddenWords(text: string): string[] {
  const hits: string[] = [];
  for (const word of FORBIDDEN_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(text)) hits.push(word);
  }
  return hits;
}

const DEDUPE_WINDOW_MINUTES = 60;
const SYSTEM_ORG_SENTINEL = "00000000-0000-0000-0000-000000000000";

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface D4cInitiatorNotifyArgs {
  /** Canonical event name. Must be in `D4C_INITIATOR_ALLOWLIST`. */
  eventType: string;
  /** Target engagement id — used for resolution + dedupe + trace. */
  engagementId: string;
  /** Optional caller id, recorded in audit metadata for forensics. */
  actorUserId?: string | null;
  /** Optional dedupe override; defaults to `${eventType}:${engagementId}`. */
  dedupeKey?: string;
  /** Caller-supplied non-PII metadata. NEVER include counterparty PII. */
  metadata?: Record<string, unknown>;
  /** Caller name for forensics. Required. */
  sourceFunction: string;
}

export interface QueuedEmailArgs {
  recipientEmail: string;
  subject: string;
  templateName: "batch-d-initiator-alert";
  templateData: {
    label: string;
    safeWording: string;
    subject: string;
    engagementId: string;
  };
  idempotencyKey: string;
}

export interface QueuedEmailResult {
  ok: boolean;
  /** Optional error string for audit metadata; never thrown. */
  error?: string;
}

export interface D4cInitiatorNotifyDeps {
  resolveRecipients?: typeof defaultResolveInitiatorRecipients;
  /** Hard suppression checker; defaults to a `suppressed_emails` query. */
  hardSuppressionChecker?: HardSuppressionChecker;
  /**
   * Queue dispatcher. Defaults to invoking `send-transactional-email`
   * with the registered `batch-d-initiator-alert` template.
   */
  enqueueEmail?: (args: QueuedEmailArgs) => Promise<QueuedEmailResult>;
  /** Hash function for recipient-email redaction. Defaults to SHA-256 hex. */
  hashEmail?: (email: string) => Promise<string>;
  /** Clock injection for tests. */
  now?: () => Date;
}

export type D4cInitiatorNotifyResult =
  | {
      ok: true;
      eventType: string;
      engagementId: string;
      queuedCount: number;
      skippedCount: number;
      deduped: false;
    }
  | {
      ok: true;
      eventType: string;
      engagementId: string;
      queuedCount: 0;
      skippedCount: 0;
      deduped: true;
    }
  | {
      ok: false;
      eventType: string;
      engagementId: string;
      reason:
        | "event_not_in_allowlist"
        | "event_missing_from_catalogue"
        | "wording_forbidden_word"
        | "wording_disallows_initiating_org"
        | "wording_forbids_initiating_org"
        | "recipient_resolution_failed"
        | "all_recipients_hard_suppressed"
        | "queue_unavailable";
      detail?: string;
    };

// ─────────────────────────────────────────────────────────────────────
// Default dependency implementations
// ─────────────────────────────────────────────────────────────────────

async function defaultHashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeDefaultHardSuppressionChecker(
  supabase: SupabaseClient,
): HardSuppressionChecker {
  return async (emails: string[]) => {
    const out = new Set<string>();
    if (emails.length === 0) return out;
    const normalised = emails.map((e) => e.trim().toLowerCase());
    const { data, error } = await supabase
      .from("suppressed_emails")
      .select("email, reason")
      .in("email", normalised)
      .in("reason", ["bounce", "complaint"]);
    if (error) {
      // Fail-closed: treat all as suppressed rather than risk sending
      // to a hard-bounced address.
      console.warn(
        "[batch-d-initiator-notify] hard-suppression lookup failed; failing closed",
        error,
      );
      for (const e of normalised) out.add(e);
      return out;
    }
    for (const row of (data as { email: string }[] | null) ?? []) {
      out.add(String(row.email).trim().toLowerCase());
    }
    return out;
  };
}

function makeDefaultEnqueueEmail(
  supabase: SupabaseClient,
): (args: QueuedEmailArgs) => Promise<QueuedEmailResult> {
  return async (args) => {
    try {
      const { error } = await supabase.functions.invoke(
        "send-transactional-email",
        {
          body: {
            templateName: args.templateName,
            recipientEmail: args.recipientEmail,
            idempotencyKey: args.idempotencyKey,
            templateData: args.templateData,
          },
        },
      );
      if (error) {
        return { ok: false, error: error.message ?? String(error) };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────

/**
 * Dispatch a Batch D INITIATOR-side operational alert.
 *
 * Returns a structured result; never throws. Best-effort: callers must
 * not depend on the outcome for primary correctness.
 */
export async function dispatchD4cInitiatorAlert(
  supabase: SupabaseClient,
  args: D4cInitiatorNotifyArgs,
  deps: D4cInitiatorNotifyDeps = {},
): Promise<D4cInitiatorNotifyResult> {
  const now = deps.now?.() ?? new Date();
  const hashEmail = deps.hashEmail ?? defaultHashEmail;
  const resolveRecipients =
    deps.resolveRecipients ?? defaultResolveInitiatorRecipients;
  const enqueueEmail = deps.enqueueEmail ?? makeDefaultEnqueueEmail(supabase);
  const hardSuppressionChecker =
    deps.hardSuppressionChecker ?? makeDefaultHardSuppressionChecker(supabase);

  const dedupeKey = args.dedupeKey ?? `${args.eventType}:${args.engagementId}`;

  // ── 1. Allowlist check ─────────────────────────────────────────────
  if (!D4C_INITIATOR_ALLOWLIST.includes(args.eventType)) {
    await writeSkippedAudit(supabase, {
      ...args,
      now,
      dedupeKey,
      recipientCount: 0,
      hardSuppressedCount: 0,
      recipientUserIds: [],
      recipientEmailHashes: [],
      reason: "event_not_in_allowlist",
    });
    return {
      ok: false,
      eventType: args.eventType,
      engagementId: args.engagementId,
      reason: "event_not_in_allowlist",
    };
  }

  // ── 2. Catalogue presence + invariant checks ───────────────────────
  const entry = D4C_CATALOGUE_BY_EVENT.get(args.eventType);
  if (!entry) {
    await writeSkippedAudit(supabase, {
      ...args,
      now,
      dedupeKey,
      recipientCount: 0,
      hardSuppressedCount: 0,
      recipientUserIds: [],
      recipientEmailHashes: [],
      reason: "event_missing_from_catalogue",
    });
    return {
      ok: false,
      eventType: args.eventType,
      engagementId: args.engagementId,
      reason: "event_missing_from_catalogue",
    };
  }

  if (entry.forbiddenRecipients.includes("initiating_org_admin")) {
    await writeSkippedAudit(supabase, {
      ...args,
      now,
      dedupeKey,
      recipientCount: 0,
      hardSuppressedCount: 0,
      recipientUserIds: [],
      recipientEmailHashes: [],
      reason: "wording_forbids_initiating_org",
    });
    return {
      ok: false,
      eventType: args.eventType,
      engagementId: args.engagementId,
      reason: "wording_forbids_initiating_org",
    };
  }

  if (!entry.allowedRecipients.includes("initiating_org_admin")) {
    // Catalogue allows only platform-admin (D4b admin-only event).
    // D4c-2 must not deliver to initiating org admins for it.
    await writeSkippedAudit(supabase, {
      ...args,
      now,
      dedupeKey,
      recipientCount: 0,
      hardSuppressedCount: 0,
      recipientUserIds: [],
      recipientEmailHashes: [],
      reason: "wording_disallows_initiating_org",
    });
    return {
      ok: false,
      eventType: args.eventType,
      engagementId: args.engagementId,
      reason: "wording_disallows_initiating_org",
    };
  }

  // ── 3. Wording guard ───────────────────────────────────────────────
  const subjectRaw = `[Izenzo] ${entry.label}`;
  const subject = clampSubject(subjectRaw, ` [${args.engagementId.slice(0, 8)}]`);
  const body = entry.safeWording;
  const wordingHits = [
    ...findForbiddenWords(subject),
    ...findForbiddenWords(body),
  ];
  if (wordingHits.length > 0) {
    await writeSkippedAudit(supabase, {
      ...args,
      now,
      dedupeKey,
      recipientCount: 0,
      hardSuppressedCount: 0,
      recipientUserIds: [],
      recipientEmailHashes: [],
      reason: "wording_forbidden_word",
      extra: { forbidden_word_hits: wordingHits },
    });
    return {
      ok: false,
      eventType: args.eventType,
      engagementId: args.engagementId,
      reason: "wording_forbidden_word",
      detail: wordingHits.join(","),
    };
  }

  // ── 4. Dedupe (60-min audit-log window) ────────────────────────────
  try {
    const sinceIso = new Date(
      now.getTime() - DEDUPE_WINDOW_MINUTES * 60 * 1000,
    ).toISOString();
    const { data: existing } = await supabase
      .from("audit_logs")
      .select("id")
      .eq("action", "engagement.initiator_alert_queued")
      .eq("entity_id", args.engagementId)
      .gte("created_at", sinceIso)
      .contains("metadata", {
        event_type: args.eventType,
        dedupe_key: dedupeKey,
      })
      .limit(1);
    if (existing && existing.length > 0) {
      return {
        ok: true,
        eventType: args.eventType,
        engagementId: args.engagementId,
        queuedCount: 0,
        skippedCount: 0,
        deduped: true,
      };
    }
  } catch (dedupeErr) {
    console.warn(
      "[batch-d-initiator-notify] dedupe lookup failed; continuing",
      dedupeErr,
    );
  }

  // ── 5. Resolve recipients (hard suppression applied here) ──────────
  let resolution: ResolveInitiatorRecipientsResult;
  try {
    resolution = await resolveRecipients(
      supabase as unknown as { from: (table: string) => any },
      args.engagementId,
      hardSuppressionChecker,
    );
  } catch (e) {
    await writeSkippedAudit(supabase, {
      ...args,
      now,
      dedupeKey,
      recipientCount: 0,
      hardSuppressedCount: 0,
      recipientUserIds: [],
      recipientEmailHashes: [],
      reason: "recipient_resolution_failed",
      extra: { error: e instanceof Error ? e.message : String(e) },
    });
    return {
      ok: false,
      eventType: args.eventType,
      engagementId: args.engagementId,
      reason: "recipient_resolution_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  if (!resolution.ok) {
    const isAllSuppressed =
      resolution.reason === "no_eligible_admins" &&
      typeof resolution.detail === "string" &&
      resolution.detail.includes("hard-suppressed");
    const skipReason = isAllSuppressed
      ? "all_recipients_hard_suppressed"
      : "recipient_resolution_failed";
    await writeSkippedAudit(supabase, {
      ...args,
      now,
      dedupeKey,
      recipientCount: 0,
      hardSuppressedCount: 0,
      recipientUserIds: [],
      recipientEmailHashes: [],
      reason: skipReason,
      extra: {
        resolver_reason: resolution.reason,
        resolver_detail: resolution.detail ?? null,
      },
    });
    return {
      ok: false,
      eventType: args.eventType,
      engagementId: args.engagementId,
      reason: skipReason,
      detail: resolution.detail ?? resolution.reason,
    };
  }

  const recipients: InitiatorRecipient[] = resolution.recipients;
  const recipientEmailHashes = await Promise.all(
    recipients.map((r) => hashEmail(r.email)),
  );
  const recipientUserIds = recipients.map((r) => r.user_id);

  // ── 6. Queue per recipient ─────────────────────────────────────────
  let queuedCount = 0;
  let skippedCount = 0;
  const perRecipientErrors: string[] = [];
  for (const recipient of recipients) {
    let result: QueuedEmailResult;
    try {
      result = await enqueueEmail({
        recipientEmail: recipient.email,
        subject,
        templateName: "batch-d-initiator-alert",
        templateData: {
          label: entry.label,
          safeWording: entry.safeWording,
          subject,
          engagementId: args.engagementId,
        },
        idempotencyKey: `d4c:${dedupeKey}:${recipient.user_id}`,
      });
    } catch (e) {
      result = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    if (result.ok) {
      queuedCount += 1;
    } else {
      skippedCount += 1;
      if (result.error) perRecipientErrors.push(result.error);
    }
  }

  if (queuedCount === 0) {
    await writeSkippedAudit(supabase, {
      ...args,
      now,
      dedupeKey,
      recipientCount: recipients.length,
      hardSuppressedCount: 0,
      recipientUserIds,
      recipientEmailHashes,
      reason: "queue_unavailable",
      extra: { errors: perRecipientErrors },
    });
    return {
      ok: false,
      eventType: args.eventType,
      engagementId: args.engagementId,
      reason: "queue_unavailable",
      detail: perRecipientErrors.join("|"),
    };
  }

  // ── 7. Audit row used by future dedupe lookups ─────────────────────
  try {
    await supabase.from("audit_logs").insert({
      org_id: resolution.initiating_org_id ?? SYSTEM_ORG_SENTINEL,
      action: "engagement.initiator_alert_queued",
      entity_type: "poi_engagement",
      entity_id: args.engagementId,
      metadata: buildAuditMetadata({
        ...args,
        now,
        dedupeKey,
        recipientCount: recipients.length,
        hardSuppressedCount: 0,
        recipientUserIds,
        recipientEmailHashes,
        queued: true,
        timestamp: now.toISOString(),
      }),
    });
  } catch (auditErr) {
    console.warn(
      "[batch-d-initiator-notify] queued audit insert failed",
      auditErr,
    );
  }

  return {
    ok: true,
    eventType: args.eventType,
    engagementId: args.engagementId,
    queuedCount,
    skippedCount,
    deduped: false,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Audit helpers
// ─────────────────────────────────────────────────────────────────────

interface AuditCommon {
  eventType: string;
  engagementId: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  sourceFunction: string;
  dedupeKey: string;
  now: Date;
  recipientCount: number;
  hardSuppressedCount: number;
  recipientUserIds: string[];
  recipientEmailHashes: string[];
}

interface SkipAudit extends AuditCommon {
  reason: string;
  extra?: Record<string, unknown>;
}

function buildAuditMetadata(
  args: AuditCommon & {
    queued: boolean;
    timestamp: string;
    extra?: Record<string, unknown>;
  },
): Record<string, unknown> {
  // Strip caller metadata of any banned keys defensively. Even though
  // the contract forbids callers from passing PII, we never trust input.
  const callerMeta = sanitiseCallerMetadata(args.metadata ?? {});
  return {
    event_type: args.eventType,
    engagement_id: args.engagementId,
    actor_user_id: args.actorUserId ?? null,
    source_function: args.sourceFunction,
    dedupe_key: args.dedupeKey,
    recipient_count: args.recipientCount,
    recipient_user_ids: args.recipientUserIds,
    recipient_emails_hash: args.recipientEmailHashes,
    classification: "transactional_operational",
    suppression_checked: true,
    hard_suppressed_count: args.hardSuppressedCount,
    marketing_unsubscribe_ignored_for_operational_notice: true,
    queued: args.queued,
    timestamp: args.timestamp,
    caller_metadata: callerMeta,
    ...(args.extra ?? {}),
  };
}

async function writeSkippedAudit(
  supabase: SupabaseClient,
  args: SkipAudit,
): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      org_id: SYSTEM_ORG_SENTINEL,
      action: "engagement.initiator_alert_skipped",
      entity_type: "poi_engagement",
      entity_id: args.engagementId,
      metadata: {
        ...buildAuditMetadata({
          ...args,
          queued: false,
          timestamp: args.now.toISOString(),
          extra: args.extra,
        }),
        reason: args.reason,
      },
    });
  } catch (e) {
    console.warn("[batch-d-initiator-notify] skipped audit insert failed", e);
  }
}

const BANNED_METADATA_KEYS = new Set([
  "counterparty_email",
  "counterparty_name",
  "counterparty_org_id",
  "counterparty_org_name",
  "candidate_org",
  "candidate_org_id",
  "candidate_org_name",
  "binding_candidates",
  "disputed_party",
  "disputed_party_id",
  "disputed_party_name",
  "disputed_counterparty",
  "external_unregistered_counterparty",
  "commodity",
  "deal_value",
  "intent_description",
]);

function sanitiseCallerMetadata(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (BANNED_METADATA_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}
