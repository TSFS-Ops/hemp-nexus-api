/**
 * Batch D — Production Binding-Review resolver.
 *
 * Replaces the unsafe `.limit(1).maybeSingle()` resolver in
 * `poi-engagements/index.ts` (lines ~1170–1222) with a multi-profile
 * lookup that distinguishes:
 *
 *   • SAFE BIND       — exactly one distinct registered org has an exact
 *                       email match AND the local-part is not a known
 *                       shared mailbox.
 *   • BINDING REVIEW  — the supplied email is ambiguous on any of:
 *                       - exact email matches across ≥2 distinct orgs
 *                         ("shared_email_multi_org")
 *                       - local-part is a shared mailbox AND ≥1 profile
 *                         in any registered org shares that domain
 *                         ("shared_mailbox_local_part")
 *                       - no exact match, but the domain (excluding
 *                         known free providers) is registered to ≥2
 *                         distinct orgs ("domain_only_ambiguity")
 *   • NO MATCH        — nothing on the platform resembles the email.
 *   • LOOKUP ERROR    — transient DB error.
 *
 * The decision logic itself is a pure function (`decideBinding`) so it
 * can be unit-tested without a live DB. The DB-aware wrapper
 * (`evaluateCounterpartyEmailBinding`) is invoked from the PATCH
 * handler.
 *
 * IMPORTANT: This file NEVER reads counterparty contact data, NEVER
 * dispatches a notification, and NEVER writes recipient information
 * anywhere. Recipient resolution is the responsibility of
 * `_shared/batch-d-admin-notify.ts` which targets the platform admin
 * mailbox + Slack only.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Hard-coded shared-mailbox local-parts. Approved 2026-05 by Daniel.
 * Do NOT extend without separate written instruction.
 */
export const SHARED_MAILBOX_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "info",
  "sales",
  "admin",
  "accounts",
  "contact",
  "hello",
  "support",
  "ops",
  "finance",
]);

/**
 * Public/free email providers. A counterparty email on one of these
 * domains MUST NOT trigger domain-only binding review on its own.
 * Approved 2026-05 by Daniel.
 */
export const FREE_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "mail.com",
  "zoho.com",
]);

export type BindingReasonCode =
  | "shared_email_multi_org"
  | "shared_mailbox_local_part"
  | "domain_only_ambiguity";

export interface BindingCandidate {
  /** "exact_email" = email matched verbatim. "domain_match" = only the domain matched. */
  kind: "exact_email" | "domain_match";
  org_id: string;
  profile_id: string;
  /** Stored lowercase. */
  email: string;
}

export type BindingDecision =
  | { kind: "safe_bind"; org_id: string }
  | { kind: "no_match" }
  | {
      kind: "binding_review_required";
      reason_codes: BindingReasonCode[];
      candidates: BindingCandidate[];
    };

export interface ProfileLookupRow {
  id: string;
  org_id: string;
  email: string;
}

export function splitEmail(email: string): { localPart: string; domain: string } | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || at === trimmed.length - 1) return null;
  return { localPart: trimmed.slice(0, at), domain: trimmed.slice(at + 1) };
}

export function isSharedMailboxLocalPart(localPart: string): boolean {
  return SHARED_MAILBOX_LOCAL_PARTS.has(localPart.trim().toLowerCase());
}

export function isFreeProviderDomain(domain: string): boolean {
  return FREE_PROVIDER_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * PURE decision function. Given the normalised email plus the rows
 * fetched by the DB wrapper, return the binding decision.
 *
 * @param email             normalised (trim+lowercase) counterparty email
 * @param exactMatches      profiles whose `email` equals `email` (any org)
 * @param domainMatches     profiles whose email shares the domain (any org).
 *                          May overlap with `exactMatches`; the function
 *                          deduplicates as needed.
 */
export function decideBinding(
  email: string,
  exactMatches: ProfileLookupRow[],
  domainMatches: ProfileLookupRow[],
): BindingDecision {
  const parts = splitEmail(email);
  if (!parts) return { kind: "no_match" };
  const { localPart, domain } = parts;

  // 1. Distinct-org count from exact matches
  const exactByOrg = new Map<string, ProfileLookupRow>();
  for (const row of exactMatches) {
    if (!row.org_id) continue;
    if (!exactByOrg.has(row.org_id)) exactByOrg.set(row.org_id, row);
  }
  const exactOrgCount = exactByOrg.size;

  const reasonCodes: BindingReasonCode[] = [];
  const candidatesMap = new Map<string, BindingCandidate>(); // dedupe by profile_id

  // 2. Multi-org exact match → review
  if (exactOrgCount >= 2) {
    reasonCodes.push("shared_email_multi_org");
    for (const row of exactMatches) {
      if (!row.org_id) continue;
      candidatesMap.set(`exact:${row.id}`, {
        kind: "exact_email",
        org_id: row.org_id,
        profile_id: row.id,
        email: row.email.toLowerCase(),
      });
    }
  }

  // 3. Shared-mailbox local-part → review (only if there is at least
  //    one registered candidate worth reviewing — exact match OR a
  //    profile sharing the domain).
  if (isSharedMailboxLocalPart(localPart)) {
    const hasAnyRegistered = exactMatches.length > 0 || domainMatches.length > 0;
    if (hasAnyRegistered) {
      if (!reasonCodes.includes("shared_mailbox_local_part")) {
        reasonCodes.push("shared_mailbox_local_part");
      }
      for (const row of exactMatches) {
        if (!row.org_id) continue;
        candidatesMap.set(`exact:${row.id}`, {
          kind: "exact_email",
          org_id: row.org_id,
          profile_id: row.id,
          email: row.email.toLowerCase(),
        });
      }
      for (const row of domainMatches) {
        if (!row.org_id) continue;
        candidatesMap.set(`domain:${row.id}`, {
          kind: "domain_match",
          org_id: row.org_id,
          profile_id: row.id,
          email: row.email.toLowerCase(),
        });
      }
    }
  }

  // 4. Domain-only ambiguity → review (only if no exact match exists,
  //    domain is not a free provider, and ≥2 distinct orgs share the
  //    domain).
  if (
    exactMatches.length === 0 &&
    !isFreeProviderDomain(domain)
  ) {
    const domainOrgs = new Set<string>();
    for (const row of domainMatches) {
      if (row.org_id) domainOrgs.add(row.org_id);
    }
    if (domainOrgs.size >= 2) {
      if (!reasonCodes.includes("domain_only_ambiguity")) {
        reasonCodes.push("domain_only_ambiguity");
      }
      for (const row of domainMatches) {
        if (!row.org_id) continue;
        candidatesMap.set(`domain:${row.id}`, {
          kind: "domain_match",
          org_id: row.org_id,
          profile_id: row.id,
          email: row.email.toLowerCase(),
        });
      }
    }
  }

  if (reasonCodes.length > 0) {
    return {
      kind: "binding_review_required",
      reason_codes: reasonCodes,
      candidates: Array.from(candidatesMap.values()),
    };
  }

  // 5. Unique exact match across exactly one org → safe bind.
  if (exactOrgCount === 1) {
    const onlyOrg = exactByOrg.values().next().value!;
    return { kind: "safe_bind", org_id: onlyOrg.org_id };
  }

  return { kind: "no_match" };
}

/**
 * DB-aware wrapper. Fetches the rows needed by `decideBinding` and
 * returns either the pure decision OR a lookup-error sentinel.
 */
export async function evaluateCounterpartyEmailBinding(
  supabase: SupabaseClient,
  email: string,
): Promise<
  | BindingDecision
  | { kind: "lookup_error"; message: string }
> {
  const parts = splitEmail(email);
  if (!parts) return { kind: "no_match" };
  const { domain } = parts;
  const normalisedEmail = `${parts.localPart}@${domain}`;

  // Exact email matches (case-insensitive). Cap result set defensively.
  const { data: exactRows, error: exactErr } = await supabase
    .from("profiles")
    .select("id, org_id, email")
    .ilike("email", normalisedEmail)
    .not("org_id", "is", null)
    .limit(50);
  if (exactErr) {
    return { kind: "lookup_error", message: exactErr.message };
  }

  // Domain matches — only fetched when we actually need them
  // (non-free-provider domain OR shared-mailbox local-part).
  const needDomainScan =
    !isFreeProviderDomain(domain) || isSharedMailboxLocalPart(parts.localPart);

  let domainRows: ProfileLookupRow[] = [];
  if (needDomainScan) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, org_id, email")
      .ilike("email", `%@${domain}`)
      .not("org_id", "is", null)
      .limit(200);
    if (error) {
      return { kind: "lookup_error", message: error.message };
    }
    domainRows = (data ?? []) as ProfileLookupRow[];
  }

  return decideBinding(
    normalisedEmail,
    (exactRows ?? []) as ProfileLookupRow[],
    domainRows,
  );
}
