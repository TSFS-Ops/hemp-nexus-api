/**
 * Shared response contract for the admin POI-engagement endpoints.
 *
 * The backend (`supabase/functions/poi-engagements/index.ts`) returns a
 * `binding` object on every PATCH that includes `counterparty_email`. The
 * reviewer dashboard renders different toasts and badge states based on
 * `binding.status`, so the contract is centralised here.
 *
 * IMPORTANT: When adding a new status, also update:
 *   • supabase/functions/poi-engagements/index.ts (resolver)
 *   • supabase/functions/poi-engagements/index_test.ts (contract tests)
 *   • docs/poi-engagements-binding-contract.md (admin docs)
 *   • the BINDING_HINT_MESSAGES map below (UI copy)
 */

/** The engagement was auto-bound to a registered organisation. */
export interface BindingHintBound {
  status: "bound";
  /** UUID of the organisation the engagement is now bound to. */
  org_id: string;
  /** The normalised (trimmed, lowercased) email that resolved. */
  email: string;
}

/**
 * The email is valid but no registered profile matches it. Engagement is
 * still saved — the recipient simply won't see it in their inbound queue
 * until they sign up or the email is corrected. NON-FATAL.
 */
export interface BindingHintNoMatch {
  status: "no_match";
  email: string;
  message: string;
}

/**
 * The engagement was already bound to an organisation before this PATCH.
 * The auto-resolver intentionally does NOT overwrite an existing binding —
 * a deliberate prior binding wins.
 */
export interface BindingHintAlreadyBound {
  status: "already_bound";
  org_id: string;
}

/**
 * The profile lookup failed transiently (e.g. brief DB issue). The email
 * is still saved; the admin should retry the action shortly. NON-FATAL.
 */
export interface BindingHintLookupError {
  status: "lookup_error";
  email: string;
  message: string;
}

/**
 * The supplied counterparty email is ambiguous (multi-org exact match,
 * shared mailbox local-part, or domain-only ambiguity outside the free
 * provider list). The engagement has been moved to the
 * `binding_review_required` operational state and a platform admin
 * must resolve it via the resolve-binding endpoint. The reviewer
 * dashboard renders this with the existing binding-review queue.
 */
export interface BindingHintBindingReviewRequired {
  status: "binding_review_required";
  email: string;
  /**
   * One or more of:
   *   • "shared_email_multi_org"       — same email registered to ≥2 orgs
   *   • "shared_mailbox_local_part"    — info@/sales@/etc. with real candidates
   *   • "domain_only_ambiguity"        — domain registered to ≥2 orgs (non-free)
   */
  reason_codes: string[];
  candidate_count: number;
}

export type PoiEngagementBindingHint =
  | BindingHintBound
  | BindingHintNoMatch
  | BindingHintAlreadyBound
  | BindingHintLookupError
  | BindingHintBindingReviewRequired;

/** PATCH /poi-engagements/:id response envelope. */
export interface UpdatePoiEngagementResponse {
  /** The engagement row after the update (full poi_engagements row). */
  engagement: Record<string, unknown>;
  /**
   * Present whenever the PATCH included `counterparty_email`. Tells the
   * reviewer dashboard whether the email auto-resolved to a registered org.
   */
  binding?: PoiEngagementBindingHint;
}

/**
 * UI copy keyed by binding status. The reviewer dashboard uses these as
 * the canonical, brand-aligned messages — keeping them out of the panel
 * component keeps the admin/UI contract close to the type definition.
 */
export const BINDING_HINT_MESSAGES: Record<
  PoiEngagementBindingHint["status"],
  { tone: "success" | "info" | "warning" | "error"; title: string }
> = {
  bound: {
    tone: "success",
    title: "Email matched a registered organisation — counterparty will see this in their inbound queue.",
  },
  no_match: {
    tone: "warning",
    title:
      "Email saved, but no registered organisation matches it yet. The engagement will remain unbound until the recipient signs up or the email is corrected.",
  },
  already_bound: {
    tone: "info",
    title: "Engagement was already bound to a counterparty — the existing binding was preserved.",
  },
  lookup_error: {
    tone: "error",
    title:
      "Email saved, but the platform could not check whether it matches a registered organisation. Please retry shortly.",
  },
  binding_review_required: {
    tone: "warning",
    title:
      "Email saved, but it is ambiguous on the platform. The engagement has been moved to binding review and is awaiting a platform-admin decision before any outreach can begin.",
  },
};
