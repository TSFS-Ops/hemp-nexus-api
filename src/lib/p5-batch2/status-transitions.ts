/**
 * P-5 Batch 2 — Stage 2: Evidence lifecycle state machine + actor-role
 * authorisation. Pure function. Illegal transitions return a structured
 * denial reason; never throw, never mutate.
 */
import type { P5B2EvidenceStatus } from "./constants";

export type P5B2Actor =
  | "platform_admin"
  | "compliance_owner"
  | "operator_case_manager"
  | "organisation_user"
  | "counterparty"
  | "director_officer"
  | "ubo_controller"
  | "funder"
  | "api_customer"
  | "system";

export type P5B2TransitionAction =
  | "request"
  | "upload"
  | "start_review"
  | "accept"
  | "accept_with_warning"
  | "reject"
  | "expire"
  | "replace"
  | "waive"
  | "mark_provider_dependent"
  | "suspend_hold"
  | "revoke"
  | "resume";

export interface P5B2TransitionInput {
  from: P5B2EvidenceStatus;
  action: P5B2TransitionAction;
  actor: P5B2Actor;
}

export type P5B2TransitionDenialCode =
  | "illegal_status_transition"
  | "actor_not_authorised"
  | "terminal_status";

export interface P5B2TransitionResult {
  allowed: boolean;
  to?: P5B2EvidenceStatus;
  denial?: {
    code: P5B2TransitionDenialCode;
    message: string;
  };
}

/* Legal `from -> action -> to` map. */
const TRANSITIONS: Record<P5B2EvidenceStatus, Partial<Record<P5B2TransitionAction, P5B2EvidenceStatus>>> = {
  missing: {
    request: "requested",
    upload: "uploaded",
    waive: "waived",
    mark_provider_dependent: "provider_dependent",
  },
  requested: {
    upload: "uploaded",
    waive: "waived",
    mark_provider_dependent: "provider_dependent",
    expire: "expired",
  },
  uploaded: {
    start_review: "under_review",
    reject: "rejected",
    accept: "accepted",
    accept_with_warning: "accepted_with_warning",
    replace: "uploaded",
    suspend_hold: "suspended_hold",
  },
  under_review: {
    accept: "accepted",
    accept_with_warning: "accepted_with_warning",
    reject: "rejected",
    suspend_hold: "suspended_hold",
    mark_provider_dependent: "provider_dependent",
  },
  accepted: {
    expire: "expired",
    replace: "replaced",
    revoke: "revoked",
    suspend_hold: "suspended_hold",
  },
  accepted_with_warning: {
    expire: "expired",
    replace: "replaced",
    revoke: "revoked",
    suspend_hold: "suspended_hold",
    accept: "accepted",
  },
  rejected: {
    upload: "uploaded",
    waive: "waived",
    replace: "uploaded",
  },
  expired: {
    upload: "uploaded",
    waive: "waived",
    replace: "uploaded",
  },
  replaced: {
    // Terminal for this version: replacement creates a new item version.
  },
  waived: {
    revoke: "missing",
  },
  provider_dependent: {
    accept: "accepted",
    accept_with_warning: "accepted_with_warning",
    reject: "rejected",
    upload: "uploaded",
    suspend_hold: "suspended_hold",
  },
  suspended_hold: {
    resume: "under_review",
    reject: "rejected",
    revoke: "revoked",
  },
  revoked: {
    // Terminal.
  },
};

const TERMINAL: ReadonlySet<P5B2EvidenceStatus> = new Set(["replaced", "revoked"]);

/* Who is allowed to invoke each action. */
const ACTION_ROLES: Record<P5B2TransitionAction, ReadonlySet<P5B2Actor>> = {
  request: new Set(["platform_admin", "compliance_owner", "operator_case_manager", "system"]),
  upload: new Set([
    "platform_admin",
    "compliance_owner",
    "operator_case_manager",
    "organisation_user",
    "counterparty",
    "director_officer",
    "ubo_controller",
  ]),
  start_review: new Set(["platform_admin", "compliance_owner", "operator_case_manager"]),
  accept: new Set(["platform_admin", "compliance_owner"]),
  accept_with_warning: new Set(["platform_admin", "compliance_owner"]),
  reject: new Set(["platform_admin", "compliance_owner", "operator_case_manager"]),
  expire: new Set(["system", "platform_admin"]),
  replace: new Set([
    "platform_admin",
    "compliance_owner",
    "operator_case_manager",
    "organisation_user",
    "counterparty",
  ]),
  waive: new Set(["platform_admin", "compliance_owner"]),
  mark_provider_dependent: new Set(["platform_admin", "compliance_owner", "system"]),
  suspend_hold: new Set(["platform_admin", "compliance_owner"]),
  revoke: new Set(["platform_admin"]),
  resume: new Set(["platform_admin", "compliance_owner"]),
};

export function evaluateP5B2Transition(input: P5B2TransitionInput): P5B2TransitionResult {
  if (TERMINAL.has(input.from)) {
    return {
      allowed: false,
      denial: {
        code: "terminal_status",
        message: `Evidence in status "${input.from}" is terminal and cannot transition.`,
      },
    };
  }

  const allowedRoles = ACTION_ROLES[input.action];
  if (!allowedRoles || !allowedRoles.has(input.actor)) {
    // Funders, API customers and read-only roles can never mutate evidence.
    return {
      allowed: false,
      denial: {
        code: "actor_not_authorised",
        message: `Actor "${input.actor}" is not authorised to perform action "${input.action}".`,
      },
    };
  }

  const to = TRANSITIONS[input.from]?.[input.action];
  if (!to) {
    return {
      allowed: false,
      denial: {
        code: "illegal_status_transition",
        message: `Action "${input.action}" is not legal from status "${input.from}".`,
      },
    };
  }
  return { allowed: true, to };
}

export const P5B2_TERMINAL_STATUSES = TERMINAL;
