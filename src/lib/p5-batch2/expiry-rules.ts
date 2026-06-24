/**
 * P-5 Batch 2 — Stage 2: Expiry and reminder rules.
 *
 * Pure. Caller passes `now`; engine computes expiry, days remaining and
 * reminder due dates (30 / 14 / 7 days before expiry).
 */

export type P5B2ExpiryCategory =
  | "proof_of_address"
  | "bank_confirmation_profile"
  | "bank_confirmation_payment_finality"
  | "tax_or_vat"
  | "id_or_passport"
  | "company_registration"
  | "director_officer_list"
  | "ubo_declaration"
  | "authority_to_act"
  | "sector_licence"
  | "transaction_documents";

export interface P5B2ExpiryPolicy {
  category: P5B2ExpiryCategory;
  /** Default validity window in days, applied when no explicit expiry exists. */
  default_validity_days: number | null;
  /**
   * Default review cadence in days, used when there is no concept of
   * "expiry" (e.g. company registration: review every 12 months).
   */
  review_cadence_days: number | null;
  /** True if admin approval can extend or override default validity. */
  admin_extendable: boolean;
  notes?: string;
}

export const P5B2_EXPIRY_POLICIES: Record<P5B2ExpiryCategory, P5B2ExpiryPolicy> = {
  proof_of_address: {
    category: "proof_of_address",
    default_validity_days: 90,
    review_cadence_days: null,
    admin_extendable: false,
    notes: "3 months.",
  },
  bank_confirmation_profile: {
    category: "bank_confirmation_profile",
    default_validity_days: 180,
    review_cadence_days: null,
    admin_extendable: false,
    notes: "6 months for profile use.",
  },
  bank_confirmation_payment_finality: {
    category: "bank_confirmation_payment_finality",
    default_validity_days: 30,
    review_cadence_days: null,
    admin_extendable: true,
    notes: "30 days for payment / finality unless admin-approved extension.",
  },
  tax_or_vat: {
    category: "tax_or_vat",
    default_validity_days: 180,
    review_cadence_days: null,
    admin_extendable: false,
    notes: "6 months or stated expiry if earlier.",
  },
  id_or_passport: {
    category: "id_or_passport",
    default_validity_days: null,
    review_cadence_days: 365 * 3,
    admin_extendable: false,
    notes: "Document expiry; if no expiry, review every 3 years.",
  },
  company_registration: {
    category: "company_registration",
    default_validity_days: null,
    review_cadence_days: 365,
    admin_extendable: false,
    notes: "Refresh / review every 12 months.",
  },
  director_officer_list: {
    category: "director_officer_list",
    default_validity_days: null,
    review_cadence_days: 365,
    admin_extendable: false,
    notes: "Review every 12 months or on company change.",
  },
  ubo_declaration: {
    category: "ubo_declaration",
    default_validity_days: 365,
    review_cadence_days: null,
    admin_extendable: false,
    notes: "12 months or on ownership / control change.",
  },
  authority_to_act: {
    category: "authority_to_act",
    default_validity_days: 365,
    review_cadence_days: null,
    admin_extendable: false,
    notes: "Expiry date, revocation, transaction end, or 12 months if no expiry.",
  },
  sector_licence: {
    category: "sector_licence",
    default_validity_days: null,
    review_cadence_days: null,
    admin_extendable: false,
    notes: "Licence expiry.",
  },
  transaction_documents: {
    category: "transaction_documents",
    default_validity_days: null,
    review_cadence_days: null,
    admin_extendable: true,
    notes: "Stated validity, version replacement or admin revocation.",
  },
};

export const P5B2_REMINDER_DAYS_BEFORE = [30, 14, 7] as const;

export interface P5B2ExpiryComputeInput {
  category: P5B2ExpiryCategory;
  /** Explicit expiry from the document (preferred). */
  document_expiry: string | null;
  /** When the evidence was issued / uploaded — used when only a cadence applies. */
  issued_at: string | null;
  /** Caller-provided now. */
  now: string;
  /** Admin-approved override expiry, if any. */
  admin_extended_expiry?: string | null;
}

export interface P5B2ExpiryComputeResult {
  effective_expiry: string | null;
  days_until_expiry: number | null;
  is_expired: boolean;
  /** ISO dates on which reminders should fire (deduped, future only). */
  reminders_due: string[];
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function computeP5B2Expiry(input: P5B2ExpiryComputeInput): P5B2ExpiryComputeResult {
  const policy = P5B2_EXPIRY_POLICIES[input.category];
  const now = new Date(input.now).getTime();

  let effective: string | null = null;

  // Document expiry wins if it is earlier than the policy default.
  const candidates: string[] = [];
  if (input.document_expiry) candidates.push(input.document_expiry);

  if (input.issued_at && policy.default_validity_days != null) {
    candidates.push(addDaysIso(input.issued_at, policy.default_validity_days));
  }
  if (input.issued_at && policy.review_cadence_days != null) {
    candidates.push(addDaysIso(input.issued_at, policy.review_cadence_days));
  }

  if (policy.admin_extendable && input.admin_extended_expiry) {
    // Admin extension only applies on top of the earliest candidate.
    candidates.push(input.admin_extended_expiry);
  }

  if (candidates.length === 0) {
    return { effective_expiry: null, days_until_expiry: null, is_expired: false, reminders_due: [] };
  }

  const earliest = candidates.reduce((a, b) => (new Date(a).getTime() < new Date(b).getTime() ? a : b));
  // Admin extension may push past earliest only if it is later AND policy allows.
  if (policy.admin_extendable && input.admin_extended_expiry) {
    const ext = new Date(input.admin_extended_expiry).getTime();
    if (ext > new Date(earliest).getTime()) {
      effective = input.admin_extended_expiry;
    } else {
      effective = earliest;
    }
  } else {
    effective = earliest;
  }

  const effectiveMs = new Date(effective).getTime();
  const daysUntil = Math.floor((effectiveMs - now) / (1000 * 60 * 60 * 24));
  const reminders_due = P5B2_REMINDER_DAYS_BEFORE.map((d) => addDaysIso(effective!, -d))
    .filter((iso) => new Date(iso).getTime() > now);

  return {
    effective_expiry: effective,
    days_until_expiry: daysUntil,
    is_expired: effectiveMs < now,
    reminders_due,
  };
}
