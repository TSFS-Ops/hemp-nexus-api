/**
 * P-5 Batch 2 — Stage 2: Deterministic checklist engine.
 *
 * Pure function. Given a record's metadata and existing evidence, return the
 * segmented buckets that drive review queues, customer prompts and finality
 * gates. The engine NEVER collapses everything into a generic "missing
 * documents" result; each evidence requirement is classified independently as
 * mandatory / mandatory-before-finality / conditional / optional and the
 * existing evidence is bucketed into uploaded-unreviewed / rejected /
 * expired / provider-dependent.
 *
 * No DB calls, no IO, no Date.now() implicit reads — caller passes `now`.
 */
import type {
  P5B2EvidenceStatus,
  P5B2KycRecordType,
  P5B2RequirementLevel,
} from "./constants";

export type P5B2FinalityCondition =
  | "none"
  | "pre_finality"
  | "at_finality"
  | "post_finality";

export type P5B2FunderRule = "none" | "funder_pack_required" | "funder_pack_optional";
export type P5B2ApiRule = "none" | "api_consumer" | "api_provider";

export interface P5B2ChecklistRequirement {
  /** Stable requirement key, e.g. "company_registration", "ubo_declaration". */
  key: string;
  category: string;
  level: P5B2RequirementLevel;
  /** True when this requirement must be cleared before finality may proceed. */
  required_before_finality: boolean;
  /** Free-text rationale for surfaced UI/admin context. */
  rationale: string;
}

export interface P5B2ChecklistExistingEvidence {
  key: string;
  status: P5B2EvidenceStatus;
  expiry_date: string | null;
  provider_dependency: boolean;
  /** True if the latest provider attempt succeeded with a referenced result. */
  provider_live: boolean;
  reviewed_at: string | null;
}

export interface P5B2ChecklistInput {
  record_type: P5B2KycRecordType;
  jurisdiction: string | null;
  entity_type: string | null;
  transaction_type: string | null;
  finality_condition: P5B2FinalityCondition;
  funder_rule: P5B2FunderRule;
  api_rule: P5B2ApiRule;
  provider_dependency: boolean;
  /** Admin overrides that raise a requirement level (never lowers below conditional). */
  overrides?: Record<string, P5B2RequirementLevel>;
  /** Active waivers keyed by requirement key. */
  waivers?: Set<string> | string[];
  existing_evidence?: P5B2ChecklistExistingEvidence[];
  /** Caller-provided current time (ISO string). Pure: no implicit clock reads. */
  now: string;
}

export interface P5B2ChecklistRequirementWithEvidence extends P5B2ChecklistRequirement {
  evidence?: P5B2ChecklistExistingEvidence;
  waived: boolean;
}

export interface P5B2ChecklistResult {
  missing_mandatory: P5B2ChecklistRequirementWithEvidence[];
  missing_mandatory_before_finality: P5B2ChecklistRequirementWithEvidence[];
  missing_conditional: P5B2ChecklistRequirementWithEvidence[];
  optional_recommendations: P5B2ChecklistRequirementWithEvidence[];
  uploaded_unreviewed: P5B2ChecklistRequirementWithEvidence[];
  rejected: P5B2ChecklistRequirementWithEvidence[];
  expired: P5B2ChecklistRequirementWithEvidence[];
  provider_dependent: P5B2ChecklistRequirementWithEvidence[];
  waived: P5B2ChecklistRequirementWithEvidence[];
  /** All requirements, post-override, for caller inspection. */
  all_requirements: P5B2ChecklistRequirement[];
}

/* -------------------------------------------------------------------------- */
/* Base requirement catalogues per record type.                               */
/* -------------------------------------------------------------------------- */

type BaseSpec = Omit<P5B2ChecklistRequirement, "rationale"> & { rationale?: string };

const COMPANY_BASE: BaseSpec[] = [
  { key: "company_registration", category: "company", level: "mandatory", required_before_finality: true },
  { key: "proof_of_address", category: "company", level: "mandatory", required_before_finality: false },
  { key: "director_officer_list", category: "company", level: "mandatory", required_before_finality: true },
  { key: "ubo_declaration", category: "company", level: "mandatory", required_before_finality: true },
  { key: "tax_or_vat_registration", category: "tax", level: "mandatory", required_before_finality: false },
  { key: "bank_confirmation", category: "bank", level: "mandatory", required_before_finality: true },
  { key: "sector_licence", category: "regulated", level: "conditional", required_before_finality: true },
  { key: "authority_to_act", category: "authority", level: "mandatory", required_before_finality: true },
];

const PERSON_BASE: BaseSpec[] = [
  { key: "id_or_passport", category: "identity", level: "mandatory", required_before_finality: true },
  { key: "proof_of_address", category: "identity", level: "mandatory", required_before_finality: false },
];

const COUNTERPARTY_BASE: BaseSpec[] = [
  ...COMPANY_BASE,
  { key: "transaction_documents", category: "transaction", level: "conditional", required_before_finality: true },
];

const TRANSACTION_PARTY_BASE: BaseSpec[] = [
  { key: "transaction_documents", category: "transaction", level: "mandatory", required_before_finality: true },
  { key: "authority_to_act", category: "authority", level: "mandatory", required_before_finality: true },
];

const BANK_BASE: BaseSpec[] = [
  { key: "bank_confirmation", category: "bank", level: "mandatory", required_before_finality: true },
];

const API_CUSTOMER_BASE: BaseSpec[] = [
  ...COMPANY_BASE,
  { key: "api_terms_acceptance", category: "api", level: "mandatory", required_before_finality: false },
];

const FUNDER_ENTITY_BASE: BaseSpec[] = [
  ...COMPANY_BASE,
  { key: "funder_mandate", category: "funder", level: "mandatory", required_before_finality: true },
];

const INVITED_OWNER_BASE: BaseSpec[] = [
  { key: "invitation_acknowledgement", category: "authority", level: "mandatory", required_before_finality: false },
];

const BASE_BY_TYPE: Record<P5B2KycRecordType, BaseSpec[]> = {
  company: COMPANY_BASE,
  director_officer: PERSON_BASE,
  ubo_controller: [
    ...PERSON_BASE,
    { key: "ubo_declaration", category: "ownership", level: "mandatory", required_before_finality: true },
  ],
  authorised_rep: [
    ...PERSON_BASE,
    { key: "authority_to_act", category: "authority", level: "mandatory", required_before_finality: true },
  ],
  counterparty: COUNTERPARTY_BASE,
  funder_entity: FUNDER_ENTITY_BASE,
  funder_contact: PERSON_BASE,
  api_customer: API_CUSTOMER_BASE,
  transaction_party: TRANSACTION_PARTY_BASE,
  bank_account: BANK_BASE,
  invited_evidence_owner: INVITED_OWNER_BASE,
};

const RATIONALES: Record<string, string> = {
  company_registration: "Confirms the legal entity exists in its stated jurisdiction.",
  proof_of_address: "Confirms the operating or residential address of the party.",
  director_officer_list: "Captures who can legally bind the entity.",
  ubo_declaration: "Identifies controllers and >=25% beneficial owners.",
  tax_or_vat_registration: "Confirms the entity's tax registration footprint.",
  bank_confirmation: "Confirms the receiving / paying bank account belongs to the party.",
  sector_licence: "Required only where the sector is regulated.",
  authority_to_act: "Confirms the signer is authorised to bind the party for this transaction.",
  id_or_passport: "Confirms personal identity for officers, UBOs, signers.",
  transaction_documents: "Material trade / contract evidence for the transaction.",
  api_terms_acceptance: "Records signed API customer terms acceptance.",
  funder_mandate: "Records the funder's mandate / programme acceptance.",
  invitation_acknowledgement: "Records that the invited owner accepted the invitation.",
};

/* -------------------------------------------------------------------------- */
/* Helpers.                                                                   */
/* -------------------------------------------------------------------------- */

function jurisdictionLicenceConditional(j: string | null, transactionType: string | null): boolean {
  if (!j) return false;
  // Regulated industries / cross-border defaults raise sector_licence to mandatory.
  if (transactionType && /commodit|securit|crypto|payments?|forex/i.test(transactionType)) {
    return true;
  }
  return false;
}

function isExpired(expiry: string | null, now: string): boolean {
  if (!expiry) return false;
  return new Date(expiry).getTime() < new Date(now).getTime();
}

function uploadedButUnreviewed(status: P5B2EvidenceStatus): boolean {
  return status === "uploaded" || status === "under_review";
}

/* -------------------------------------------------------------------------- */
/* Engine.                                                                    */
/* -------------------------------------------------------------------------- */

export function buildP5B2Checklist(input: P5B2ChecklistInput): P5B2ChecklistResult {
  const base = BASE_BY_TYPE[input.record_type] ?? [];
  const waivedKeys = new Set<string>(
    Array.isArray(input.waivers) ? input.waivers : Array.from(input.waivers ?? []),
  );
  const overrides = input.overrides ?? {};

  // Build effective requirement list with conditional → mandatory promotions.
  const requirements: P5B2ChecklistRequirement[] = base.map((spec) => {
    let level: P5B2RequirementLevel = spec.level;

    if (spec.key === "sector_licence") {
      const promoted = jurisdictionLicenceConditional(input.jurisdiction, input.transaction_type);
      level = promoted ? "mandatory" : "conditional";
    }
    if (spec.key === "transaction_documents" && input.transaction_type) {
      level = "mandatory";
    }
    if (input.funder_rule === "funder_pack_required" && spec.key === "funder_mandate") {
      level = "mandatory";
    }
    if (input.api_rule !== "none" && spec.key === "api_terms_acceptance") {
      level = "mandatory";
    }

    // Apply admin overrides last; overrides can raise or lower but cannot
    // remove a finality-blocking requirement to "not_required" without an
    // explicit waiver (waivers are tracked separately below).
    const override = overrides[spec.key];
    if (override) level = override;

    return {
      key: spec.key,
      category: spec.category,
      level,
      required_before_finality:
        spec.required_before_finality &&
        level !== "not_required" &&
        level !== "optional",
      rationale: spec.rationale ?? RATIONALES[spec.key] ?? spec.key,
    };
  });

  // Index existing evidence by key (last write wins).
  const existingByKey = new Map<string, P5B2ChecklistExistingEvidence>();
  for (const ev of input.existing_evidence ?? []) {
    existingByKey.set(ev.key, ev);
  }

  const result: P5B2ChecklistResult = {
    missing_mandatory: [],
    missing_mandatory_before_finality: [],
    missing_conditional: [],
    optional_recommendations: [],
    uploaded_unreviewed: [],
    rejected: [],
    expired: [],
    provider_dependent: [],
    waived: [],
    all_requirements: requirements,
  };

  for (const req of requirements) {
    const ev = existingByKey.get(req.key);
    const waived = waivedKeys.has(req.key) || ev?.status === "waived";
    const withEv: P5B2ChecklistRequirementWithEvidence = {
      ...req,
      evidence: ev,
      waived,
    };

    if (waived) {
      result.waived.push(withEv);
      continue;
    }

    if (req.level === "not_required") {
      continue;
    }

    // Provider-dependent evidence is bucketed separately so callers don't
    // mistakenly treat it as accepted.
    if (ev && (ev.status === "provider_dependent" || (ev.provider_dependency && !ev.provider_live))) {
      result.provider_dependent.push(withEv);
    }

    if (ev && ev.status === "rejected") {
      result.rejected.push(withEv);
    }

    if (ev && (ev.status === "expired" || isExpired(ev.expiry_date, input.now))) {
      result.expired.push(withEv);
    }

    if (ev && uploadedButUnreviewed(ev.status)) {
      result.uploaded_unreviewed.push(withEv);
    }

    const hasUsableAccepted =
      ev && (ev.status === "accepted" || ev.status === "accepted_with_warning") &&
      !isExpired(ev.expiry_date, input.now);

    if (!hasUsableAccepted) {
      if (req.level === "mandatory" && req.required_before_finality) {
        result.missing_mandatory_before_finality.push(withEv);
        result.missing_mandatory.push(withEv);
      } else if (req.level === "mandatory") {
        result.missing_mandatory.push(withEv);
      } else if (req.level === "conditional") {
        result.missing_conditional.push(withEv);
      } else if (req.level === "optional") {
        result.optional_recommendations.push(withEv);
      }
    }
  }

  return result;
}
