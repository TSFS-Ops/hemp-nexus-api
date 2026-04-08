/**
 * Completion Engine - Deterministic Next-Action Resolver
 *
 * Inspects match/WaD/PoD state and returns structured, role-aware actions.
 * This is a pure-logic module with no React or Supabase dependencies.
 * All data is passed in; all output is structured data.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type StageId = "poi" | "wad" | "pod" | "evidence";

export type StageStatus =
  | "complete"
  | "in_progress"
  | "blocked"
  | "pending"
  | "not_started";

export type ActionType =
  | "confirm_intent"
  | "upload_document"
  | "edit_deal_terms"
  | "create_wad"
  | "open_wad"
  | "generate_evidence_pack"
  | "download_evidence"
  | "create_pod"
  | "complete_milestone"
  | "resolve_breach"
  | "raise_dispute"
  | "view_disputes"
  | "navigate_tab";

export type UserRole = "platform_admin" | "org_admin" | "org_member";

export interface TrackerAction {
  id: string;
  label: string;
  description: string;
  type: ActionType;
  /** Tab name to navigate to, or null for non-tab actions */
  targetTab: string | null;
  /** Whether the action is currently allowed */
  allowed: boolean;
  /** Plain-language reason the action is blocked, or null */
  blockedReason: string | null;
  /** Minimum role required, or null if any authenticated user */
  requiredRole: UserRole | null;
  /** Which stage this action belongs to */
  stage: StageId;
  /** Priority for ordering (lower = more important) */
  priority: number;
  /** Is this the recommended next action? */
  isRecommended: boolean;
}

export interface Substep {
  label: string;
  done: boolean;
  detail?: string;
}

export interface StageState {
  id: StageId;
  label: string;
  status: StageStatus;
  detail: string;
  substeps: Substep[];
  actions: TrackerAction[];
  completionPct: number;
}

export interface CompletionState {
  stages: StageState[];
  overallPct: number;
  recommendedAction: TrackerAction | null;
  summary: string;
}

// ─── Input types ────────────────────────────────────────────────────

export interface MatchData {
  id: string;
  status: string;
  state?: string | null;
  poi_state?: string | null;
  org_id: string;
  buyer_committed_at?: string | null;
  seller_committed_at?: string | null;
  counterparty_sighted_at?: string | null;
  settled_at?: string | null;
  buyer_org_id?: string | null;
  seller_org_id?: string | null;
}

export interface WadData {
  id: string;
  state?: string;
  status?: string;
  seal_hash?: string | null;
  sealed_at?: string | null;
  denial_reasons?: string[] | null;
  attestations_count?: number;
}

export interface PodData {
  id: string;
  state: string;
  wad_id?: string | null;
}

export interface MilestoneData {
  id: string;
  name: string;
  status: string;
  depends_on?: string | null;
  sequence_order?: number;
  due_at?: string;
  breach_detected_at?: string | null;
  grace_period_ends_at?: string | null;
}

export interface BreachData {
  id: string;
  status: string;
  reason: string;
  severity?: string;
  resolved_at?: string | null;
}

export interface DocumentSummary {
  total: number;
  reviewed: number;
  pending: number;
}

export interface DisputeSummary {
  active: number;
  total: number;
}

export interface CompletionInput {
  match: MatchData;
  wad: WadData | null;
  pod: PodData | null;
  milestones: MilestoneData[];
  breaches: BreachData[];
  documents: DocumentSummary;
  disputes: DisputeSummary;
  userRole: UserRole;
  userOrgId: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function hasRole(current: UserRole, required: UserRole | null): boolean {
  if (!required) return true;
  const hierarchy: Record<UserRole, number> = {
    org_member: 0,
    org_admin: 1,
    platform_admin: 2,
  };
  return hierarchy[current] >= hierarchy[required];
}

// ─── POI Stage ──────────────────────────────────────────────────────

function derivePoi(input: CompletionInput): StageState {
  const { match, disputes, userRole } = input;

  const isSettled = match.status === "settled";
  const isDisputed = match.status === "disputed";
  const isCancelled = match.status === "cancelled";
  const poiState = match.poi_state || match.state || "discovery";
  const poiIssued = ["issued", "settled"].includes(poiState) || isSettled;

  // Substeps
  const substeps: Substep[] = [
    {
      label: "Counterparty sighted",
      done: !!(match.buyer_committed_at || match.seller_committed_at || match.counterparty_sighted_at),
    },
    {
      label: "Buyer committed",
      done: !!match.buyer_committed_at,
    },
    {
      label: "Seller committed",
      done: !!match.seller_committed_at,
    },
    {
      label: "Intent confirmed (settlement)",
      done: !!match.settled_at || isSettled,
    },
  ];

  const doneCount = substeps.filter(s => s.done).length;
  const completionPct = Math.round((doneCount / substeps.length) * 100);

  // Status
  let status: StageStatus;
  let detail: string;

  if (isCancelled) {
    status = "blocked";
    detail = "This match has been cancelled";
  } else if (isDisputed) {
    status = "blocked";
    detail = "An active dispute is blocking progress. Resolve it before continuing.";
  } else if (poiIssued) {
    status = "complete";
    detail = "Both parties have trade request - POI is issued";
  } else if (doneCount > 0) {
    status = "in_progress";
    detail = `${doneCount} of ${substeps.length} steps complete - current state: ${poiState}`;
  } else {
    status = "pending";
    detail = "Awaiting counterparty commitment";
  }

  // Actions
  const actions: TrackerAction[] = [];

  // Confirm intent
  const canConfirm = match.status === "matched";
  actions.push({
    id: "poi-confirm-intent",
    label: "Confirm Intent",
    description: "Confirm your intent to proceed with this match. This burns 1 credit (R10 ZAR).",
    type: "confirm_intent",
    targetTab: "details",
    allowed: canConfirm && !isDisputed,
    blockedReason: isDisputed
      ? "Cannot confirm while a dispute is active"
      : isCancelled
        ? "Match is cancelled"
        : isSettled
          ? "Intent already confirmed"
          : null,
    requiredRole: "org_member",
    stage: "poi",
    priority: canConfirm ? 1 : 99,
    isRecommended: false,
  });

  // Upload documents
  actions.push({
    id: "poi-upload-docs",
    label: "Upload Documents",
    description: "Attach supporting documents to this match",
    type: "upload_document",
    targetTab: "documents",
    allowed: !isCancelled,
    blockedReason: isCancelled ? "Match is cancelled" : null,
    requiredRole: "org_member",
    stage: "poi",
    priority: 10,
    isRecommended: false,
  });

  // Edit deal terms
  actions.push({
    id: "poi-edit-terms",
    label: "Edit Deal Terms",
    description: "Negotiate payment, delivery, and inspection terms",
    type: "edit_deal_terms",
    targetTab: "terms",
    allowed: match.status === "matched",
    blockedReason: match.status !== "matched"
      ? "Terms can only be edited before intent is confirmed"
      : null,
    requiredRole: "org_member",
    stage: "poi",
    priority: 5,
    isRecommended: false,
  });

  // Raise dispute
  if (disputes.active > 0) {
    actions.push({
      id: "poi-view-disputes",
      label: `View Disputes (${disputes.active} active)`,
      description: "Review and resolve active disputes",
      type: "view_disputes",
      targetTab: "disputes",
      allowed: true,
      blockedReason: null,
      requiredRole: "org_member",
      stage: "poi",
      priority: 2,
      isRecommended: false,
    });
  } else if (!isCancelled && !isSettled) {
    actions.push({
      id: "poi-raise-dispute",
      label: "Raise Dispute",
      description: "Flag an issue with this match",
      type: "raise_dispute",
      targetTab: "disputes",
      allowed: match.status === "matched",
      blockedReason: match.status !== "matched" ? "Disputes can only be raised on active matches" : null,
      requiredRole: "org_member",
      stage: "poi",
      priority: 20,
      isRecommended: false,
    });
  }

  return {
    id: "poi",
    label: "Trade Request (POI)",
    status,
    detail,
    substeps,
    actions,
    completionPct,
  };
}

// ─── WaD Stage ──────────────────────────────────────────────────────

function deriveWad(input: CompletionInput, poiStatus: StageStatus): StageState {
  const { match, wad, userRole } = input;
  const isSettled = match.status === "settled";

  const substeps: Substep[] = [];
  const actions: TrackerAction[] = [];

  if (!wad) {
    // No WaD exists
    const canCreate = isSettled && poiStatus === "complete";

    substeps.push(
      { label: "POI must be issued (intent confirmed)", done: isSettled },
      { label: "WaD record created", done: false },
      { label: "9-gate validation passed", done: false },
      { label: "Attestations collected", done: false },
      { label: "WaD sealed", done: false },
    );

    actions.push({
      id: "wad-create",
      label: "Create WaD",
      description: "Start the Signed Deal evidence bundle process. The system will validate 9 compliance gates.",
      type: "create_wad",
      targetTab: "wad",
      allowed: canCreate,
      blockedReason: !isSettled
        ? "Intent must be confirmed before creating a WaD"
        : poiStatus !== "complete"
          ? "POI stage must be complete first"
          : null,
      requiredRole: "org_admin",
      stage: "wad",
      priority: canCreate ? 1 : 99,
      isRecommended: false,
    });

    return {
      id: "wad",
      label: "Written Acknowledgement of Debt (WaD)",
      status: canCreate ? "pending" : "not_started",
      detail: canCreate
        ? "Ready to create - POI is complete. Navigate to WaD tab to begin."
        : "Waiting for POI completion before WaD can be initiated",
      substeps,
      actions,
      completionPct: isSettled ? 20 : 0,
    };
  }

  // WaD exists - derive from its state
  const wadStatus = wad.state || wad.status || "draft";
  const isSealed = wadStatus === "sealed" || wadStatus === "ISSUED";
  const isDenied = wadStatus === "DENIED" || wadStatus === "denied";
  const isDraft = wadStatus === "draft" || wadStatus === "DRAFT";
  const hasAttestation = (wad.attestations_count ?? 0) > 0;

  substeps.push(
    { label: "POI issued", done: true },
    { label: "WaD record created", done: true },
    {
      label: "9-gate validation passed",
      done: isSealed || hasAttestation,
      detail: isDenied
        ? `Failed: ${(wad.denial_reasons || []).join(", ") || "See WaD tab for details"}`
        : undefined,
    },
    { label: "Attestations collected", done: isSealed || hasAttestation },
    {
      label: "WaD sealed with SHA-256",
      done: isSealed,
      detail: isSealed && wad.seal_hash
        ? `Hash: ${wad.seal_hash.substring(0, 16)}…`
        : undefined,
    },
  );

  const doneCount = substeps.filter(s => s.done).length;

  // Action: open WaD tab
  actions.push({
    id: "wad-open",
    label: isSealed ? "View Sealed WaD" : isDraft ? "Continue WaD Process" : "Review WaD",
    description: isSealed
      ? "View the sealed evidence bundle, attestations, and certificate"
      : "Continue the WaD attestation and sealing process",
    type: "open_wad",
    targetTab: "wad",
    allowed: true,
    blockedReason: null,
    requiredRole: "org_member",
    stage: "wad",
    priority: isDraft ? 1 : 5,
    isRecommended: false,
  });

  // Upload docs if WaD is still in draft
  if (isDraft) {
    actions.push({
      id: "wad-upload-docs",
      label: "Upload Supporting Documents",
      description: "Attach governance or compliance documents required for WaD gates",
      type: "upload_document",
      targetTab: "documents",
      allowed: true,
      blockedReason: null,
      requiredRole: "org_member",
      stage: "wad",
      priority: 3,
      isRecommended: false,
    });
  }

  let status: StageStatus;
  let detail: string;

  if (isSealed) {
    status = "complete";
    detail = `WaD sealed at ${wad.sealed_at ? new Date(wad.sealed_at).toLocaleDateString() : "unknown date"}`;
  } else if (isDenied) {
    status = "blocked";
    detail = `WaD denied: ${(wad.denial_reasons || []).join(", ") || "One or more gates failed"}. Fix the issues and retry.`;
  } else {
    status = "in_progress";
    detail = `WaD in ${wadStatus} state - ${doneCount} of ${substeps.length} steps complete`;
  }

  return {
    id: "wad",
    label: "Written Acknowledgement of Debt (WaD)",
    status,
    detail,
    substeps,
    actions,
    completionPct: Math.round((doneCount / substeps.length) * 100),
  };
}

// ─── PoD Stage ──────────────────────────────────────────────────────

function derivePod(input: CompletionInput, wadStatus: StageStatus): StageState {
  const { wad, pod, milestones, breaches, userRole } = input;
  const wadComplete = wadStatus === "complete";

  const substeps: Substep[] = [];
  const actions: TrackerAction[] = [];

  if (!pod) {
    substeps.push(
      { label: "WaD must be sealed", done: wadComplete },
      { label: "PoD record created", done: false },
      { label: "Milestones defined", done: false },
      { label: "All milestones complete", done: false },
    );

    const canCreate = wadComplete && !!wad;

    actions.push({
      id: "pod-create",
      label: "Create PoD",
      description: "Start Proof of Delivery tracking with milestone management",
      type: "create_pod",
      targetTab: "progress",
      allowed: canCreate,
      blockedReason: !wadComplete
        ? "WaD must be sealed before creating a PoD"
        : !wad
          ? "No WaD record found"
          : null,
      requiredRole: "org_admin",
      stage: "pod",
      priority: canCreate ? 1 : 99,
      isRecommended: false,
    });

    return {
      id: "pod",
      label: "Proof of Delivery (PoD)",
      status: canCreate ? "pending" : "not_started",
      detail: canCreate
        ? "Ready to create - WaD is sealed"
        : "Waiting for WaD to be sealed",
      substeps,
      actions,
      completionPct: wadComplete ? 10 : 0,
    };
  }

  // PoD exists
  const podState = pod.state || "ACTIVE";
  const isFinalised = podState === "FINALISED";
  const isBreached = podState === "BREACHED";
  const completedMs = milestones.filter(m => m.status === "completed");
  const pendingMs = milestones.filter(m => ["pending", "OPEN", "breach_detected"].includes(m.status));
  const overdueMs = milestones.filter(m => m.due_at && !["completed"].includes(m.status) && new Date(m.due_at) < new Date());
  const openBreaches = breaches.filter(b => !["resolved", "remediated", "dismissed"].includes(b.status));

  substeps.push(
    { label: "WaD sealed", done: true },
    { label: "PoD record created", done: true },
    {
      label: `Milestones: ${completedMs.length}/${milestones.length} complete`,
      done: milestones.length > 0 && completedMs.length === milestones.length,
    },
  );

  // Add individual milestones as substeps with overdue awareness
  for (const ms of milestones) {
    const isDone = ms.status === "completed";
    const isOverdue = ms.due_at && !isDone && new Date(ms.due_at) < new Date();
    const hasDep = ms.depends_on;
    const depMet = !hasDep || milestones.some(
      m => m.id === hasDep && m.status === "completed"
    );
    const isBreachDetected = ms.breach_detected_at != null;
    const graceEnds = ms.grace_period_ends_at ? new Date(ms.grace_period_ends_at) : null;
    const gracePast = graceEnds && graceEnds < new Date();

    let detail: string | undefined;
    if (isBreachDetected && !isDone) {
      detail = gracePast
        ? "Breach finalised - grace period expired"
        : graceEnds
          ? `Breach detected - grace period ends ${graceEnds.toLocaleDateString()}`
          : "Breach detected";
    } else if (isOverdue) {
      const daysOverdue = Math.floor((Date.now() - new Date(ms.due_at!).getTime()) / (24 * 60 * 60 * 1000));
      detail = `Overdue by ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""}`;
    } else if (!isDone && hasDep && !depMet) {
      detail = "Blocked - prerequisite milestone not yet complete";
    }

    substeps.push({
      label: ms.name + (isOverdue && !isDone ? " ⚠" : ""),
      done: isDone,
      detail,
    });
  }

  // Add breach substeps
  if (openBreaches.length > 0) {
    substeps.push({
      label: `${openBreaches.length} open breach${openBreaches.length > 1 ? "es" : ""} require resolution`,
      done: false,
      detail: openBreaches[0].reason,
    });
  }

  // Actions: complete next available milestone
  for (const ms of pendingMs) {
    const hasDep = ms.depends_on;
    const depMet = !hasDep || milestones.some(
      m => m.id === hasDep && m.status === "completed"
    );
    actions.push({
      id: `pod-complete-${ms.id}`,
      label: `Complete: ${ms.name}`,
      description: depMet
        ? "Mark this milestone as complete"
        : `Blocked by prerequisite - complete the dependency first`,
      type: "complete_milestone",
      targetTab: "progress",
      allowed: depMet && !isBreached,
      blockedReason: isBreached
        ? "PoD is in breach state - resolve breaches first"
        : !depMet
          ? "Prerequisite milestone must be completed first"
          : null,
      requiredRole: "org_admin",
      stage: "pod",
      priority: depMet ? 2 : 50,
      isRecommended: false,
    });
  }

  // Resolve breach action
  if (openBreaches.length > 0) {
    actions.push({
      id: "pod-resolve-breach",
      label: `Resolve Breach${openBreaches.length > 1 ? "es" : ""}`,
      description: "Address the breach condition to unblock milestone progress",
      type: "resolve_breach",
      targetTab: "progress",
      allowed: true,
      blockedReason: null,
      requiredRole: "org_admin",
      stage: "pod",
      priority: 1,
      isRecommended: false,
    });
  }

  let status: StageStatus;
  let detail: string;

  if (isFinalised) {
    status = "complete";
    detail = "All milestones complete - delivery finalised";
  } else if (isBreached) {
    status = "blocked";
    detail = `Breach detected - ${openBreaches.length} breach${openBreaches.length !== 1 ? "es" : ""} require resolution`;
  } else {
    status = "in_progress";
    detail = `${completedMs.length} of ${milestones.length} milestones complete`;
  }

  const totalSteps = substeps.length;
  const doneSteps = substeps.filter(s => s.done).length;

  return {
    id: "pod",
    label: "Proof of Delivery (PoD)",
    status,
    detail,
    substeps,
    actions,
    completionPct: totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0,
  };
}

// ─── Evidence Stage ─────────────────────────────────────────────────

function deriveEvidence(input: CompletionInput, poiStatus: StageStatus): StageState {
  const { match, documents } = input;
  const isSettled = match.status === "settled";

  const substeps: Substep[] = [
    {
      label: "Intent confirmed",
      done: isSettled,
    },
    {
      label: `Documents: ${documents.reviewed} reviewed, ${documents.pending} pending`,
      done: documents.pending === 0 && documents.total > 0,
    },
    {
      label: "Evidence pack available",
      done: isSettled,
      detail: isSettled ? "Generate from Evidence tab" : undefined,
    },
  ];

  const actions: TrackerAction[] = [];

  actions.push({
    id: "evidence-generate",
    label: "Generate Evidence Pack",
    description: "Create a SHA-256 hashed, tamper-evident evidence bundle",
    type: "generate_evidence_pack",
    targetTab: "evidence",
    allowed: isSettled,
    blockedReason: !isSettled
      ? "Intent must be confirmed before generating an evidence pack"
      : null,
    requiredRole: "org_member",
    stage: "evidence",
    priority: isSettled ? 3 : 99,
    isRecommended: false,
  });

  if (documents.pending > 0) {
    actions.push({
      id: "evidence-review-docs",
      label: `Review ${documents.pending} Pending Document${documents.pending > 1 ? "s" : ""}`,
      description: "Documents are awaiting review",
      type: "upload_document",
      targetTab: "documents",
      allowed: true,
      blockedReason: null,
      requiredRole: "org_admin",
      stage: "evidence",
      priority: 4,
      isRecommended: false,
    });
  }

  const doneCount = substeps.filter(s => s.done).length;

  return {
    id: "evidence",
    label: "Evidence & Finality",
    status: isSettled && documents.pending === 0
      ? "complete"
      : isSettled
        ? "in_progress"
        : poiStatus === "complete"
          ? "pending"
          : "not_started",
    detail: isSettled
      ? documents.pending > 0
        ? `${documents.pending} document${documents.pending > 1 ? "s" : ""} still pending review`
        : "Evidence pack ready for generation"
      : "Waiting for intent confirmation",
    substeps,
    actions,
    completionPct: Math.round((doneCount / substeps.length) * 100),
  };
}

// ─── Main Resolver ──────────────────────────────────────────────────

/**
 * Resolve the full completion state for a match.
 * Pure function - no side effects.
 */
export function resolveCompletion(input: CompletionInput): CompletionState {
  const poi = derivePoi(input);
  const wad = deriveWad(input, poi.status);
  const pod = derivePod(input, wad.status);
  const evidence = deriveEvidence(input, poi.status);

  const stages = [poi, wad, pod, evidence];

  // Overall progress: weighted average
  const overallPct = Math.round(
    stages.reduce((sum, s) => sum + s.completionPct, 0) / stages.length
  );

  // Find recommended action: first allowed action with lowest priority
  const allActions = stages.flatMap(s => s.actions);
  const allowedActions = allActions
    .filter(a => a.allowed && hasRole(input.userRole, a.requiredRole))
    .sort((a, b) => a.priority - b.priority);

  const recommended = allowedActions[0] || null;
  if (recommended) {
    recommended.isRecommended = true;
  }

  // Summary
  const completedStages = stages.filter(s => s.status === "complete").length;
  const blockedStages = stages.filter(s => s.status === "blocked");
  let summary: string;

  if (completedStages === stages.length) {
    summary = "All stages complete - deal has reached finality";
  } else if (blockedStages.length > 0) {
    summary = `${blockedStages.length} stage${blockedStages.length > 1 ? "s" : ""} blocked - action required`;
  } else if (recommended) {
    summary = `Next step: ${recommended.label}`;
  } else {
    summary = `${completedStages} of ${stages.length} stages complete`;
  }

  return { stages, overallPct, recommendedAction: recommended, summary };
}
