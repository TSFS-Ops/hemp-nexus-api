/**
 * P-5 Batch 1 — Stage 2 transition guard.
 *
 * Pure-TS allowed-transition table per the client's Batch 1 answers. Any
 * actor/action invalid for a target transition throws. Reason codes and notes
 * are required for: reject, apply_hold, release_hold, waive, override,
 * escalate, request_more_information.
 */
import {
  P5_ACTIONS_REQUIRING_REASON,
  type P5ActionRequiringReason,
  type P5ReasonCode,
  type P5Status,
} from "./constants";

/** Roles that may move a case forward in the lifecycle. */
export const P5_REVIEWER_ROLES = [
  "platform_admin",
  "executive_approver",
  "compliance_analyst",
  "governance_reviewer",
  "operator_case_manager",
] as const;
export type P5ReviewerRole = (typeof P5_REVIEWER_ROLES)[number];

export const P5_ADMIN_ROLES = [
  "platform_admin",
  "executive_approver",
] as const;
export type P5AdminRole = (typeof P5_ADMIN_ROLES)[number];

export type P5TransitionAction =
  | "submit"
  | "assign_review"
  | "request_more_information"
  | "approve_internal"
  | "mark_provider_dependent"
  | "approve_ready_to_proceed"
  | "approve_conditional"
  | "apply_hold"
  | "release_hold"
  | "escalate"
  | "reject"
  | "waive"
  | "override"
  | "reopen"
  | "archive_supersede"
  | "system_recompute";

export interface TransitionActor {
  /** `app_role` values held by the actor. May contain user-assigned and
   * inherited roles. */
  roles: readonly string[];
  /** `user`, `system`, `api`, or `provider`. */
  type: "user" | "system" | "api" | "provider";
}

export interface TransitionRule {
  from: P5Status;
  to: P5Status;
  action: P5TransitionAction;
  /** Allowed actor types. Defaults to `["user"]`. */
  actorTypes?: Array<TransitionActor["type"]>;
  /** Allowed actor roles when actorType is `user`. Empty = any authenticated. */
  requiredAnyRole?: readonly string[];
}

const R = (rule: TransitionRule): TransitionRule => rule;

export const P5_ALLOWED_TRANSITIONS: readonly TransitionRule[] = [
  // Intake
  R({ from: "not_started", to: "incomplete", action: "submit" }),
  R({ from: "incomplete", to: "submitted", action: "submit" }),
  R({
    from: "submitted",
    to: "under_review",
    action: "assign_review",
    actorTypes: ["user", "system"],
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  // Review feedback loops
  R({
    from: "under_review",
    to: "more_information_required",
    action: "request_more_information",
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  R({ from: "more_information_required", to: "submitted", action: "submit" }),
  R({
    from: "under_review",
    to: "internally_ready",
    action: "approve_internal",
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  // Internal → provider / ready paths
  R({
    from: "internally_ready",
    to: "provider_dependent",
    action: "mark_provider_dependent",
    actorTypes: ["user", "system"],
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  R({
    from: "provider_dependent",
    to: "internally_ready",
    action: "system_recompute",
    actorTypes: ["system"],
  }),
  R({
    from: "internally_ready",
    to: "ready_to_proceed",
    action: "approve_ready_to_proceed",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  R({
    from: "internally_ready",
    to: "conditional_ready",
    action: "approve_conditional",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  R({
    from: "conditional_ready",
    to: "ready_to_proceed",
    action: "approve_ready_to_proceed",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  // Holds / escalations
  R({
    from: "under_review",
    to: "on_hold",
    action: "apply_hold",
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  R({
    from: "internally_ready",
    to: "on_hold",
    action: "apply_hold",
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  R({
    from: "on_hold",
    to: "under_review",
    action: "release_hold",
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  R({
    from: "blocked",
    to: "under_review",
    action: "release_hold",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  R({
    from: "under_review",
    to: "escalated",
    action: "escalate",
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  R({
    from: "provider_dependent",
    to: "escalated",
    action: "escalate",
    actorTypes: ["user", "system"],
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  R({
    from: "escalated",
    to: "under_review",
    action: "release_hold",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  // Terminal-ish
  R({
    from: "under_review",
    to: "rejected",
    action: "reject",
    requiredAnyRole: P5_REVIEWER_ROLES,
  }),
  R({
    from: "rejected",
    to: "reopened",
    action: "reopen",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  R({
    from: "ready_to_proceed",
    to: "reopened",
    action: "reopen",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  R({ from: "reopened", to: "under_review", action: "assign_review" }),
  // Waivers / overrides
  R({
    from: "internally_ready",
    to: "waived",
    action: "waive",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  R({
    from: "blocked",
    to: "override_approved",
    action: "override",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  R({
    from: "on_hold",
    to: "override_approved",
    action: "override",
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
  // Archiving
  R({
    from: "ready_to_proceed",
    to: "archived_superseded",
    action: "archive_supersede",
    actorTypes: ["user", "system"],
    requiredAnyRole: P5_ADMIN_ROLES,
  }),
];

export class P5TransitionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "P5TransitionError";
  }
}

const REASON_REQUIRED: ReadonlySet<P5TransitionAction> = new Set(
  P5_ACTIONS_REQUIRING_REASON as readonly P5ActionRequiringReason[] as P5TransitionAction[],
);

export function actionRequiresReason(action: P5TransitionAction): boolean {
  return REASON_REQUIRED.has(action);
}

export interface AssertTransitionArgs {
  from: P5Status;
  to: P5Status;
  action: P5TransitionAction;
  actor: TransitionActor;
  reasonCode?: P5ReasonCode | null;
  note?: string | null;
}

/**
 * Validates that the (from → to, action, actor) tuple is allowed, and that a
 * reason code + note exist for actions that require them. Throws on any
 * violation; returns the matched rule on success.
 */
export function assertTransition(args: AssertTransitionArgs): TransitionRule {
  const { from, to, action, actor, reasonCode, note } = args;

  if (from === to) {
    throw new P5TransitionError(
      `No-op transition (${from} → ${to}) is not allowed`,
      "noop_transition",
    );
  }

  const rule = P5_ALLOWED_TRANSITIONS.find(
    (r) => r.from === from && r.to === to && r.action === action,
  );
  if (!rule) {
    throw new P5TransitionError(
      `Illegal transition: ${from} → ${to} via ${action}`,
      "illegal_transition",
    );
  }

  const allowedActorTypes = rule.actorTypes ?? ["user"];
  if (!allowedActorTypes.includes(actor.type)) {
    throw new P5TransitionError(
      `Actor type ${actor.type} not permitted for ${action}`,
      "actor_type_not_permitted",
    );
  }

  if (actor.type === "user" && rule.requiredAnyRole?.length) {
    const ok = rule.requiredAnyRole.some((r) => actor.roles.includes(r));
    if (!ok) {
      throw new P5TransitionError(
        `Actor lacks any required role (${rule.requiredAnyRole.join(", ")}) for ${action}`,
        "actor_role_not_permitted",
      );
    }
  }

  if (actionRequiresReason(action)) {
    if (!reasonCode) {
      throw new P5TransitionError(
        `Reason code is required for action ${action}`,
        "reason_code_required",
      );
    }
    if (!note || !note.trim()) {
      throw new P5TransitionError(
        `Note is required for action ${action}`,
        "note_required",
      );
    }
  }

  return rule;
}

export function isTransitionAllowed(
  from: P5Status,
  to: P5Status,
  action: P5TransitionAction,
): boolean {
  return P5_ALLOWED_TRANSITIONS.some(
    (r) => r.from === from && r.to === to && r.action === action,
  );
}
