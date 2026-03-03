/**
 * Probabilistic Exploration Layer — Layer 2 (Non-binding)
 * 
 * Responsible for signal creation, option discovery, and shortlisting.
 * All activity in this layer is explicitly non-binding and exploratory.
 * 
 * This module owns:
 * - Signal lifecycle (create, search, expire)
 * - Option scoring and ranking
 * - Data source orchestration
 * - Shortlist management
 * - Pre-flight validation (risk deltas before POI commitment)
 */

export interface ExplorationSignal {
  id: string;
  product: string;
  quantity?: number;
  unit?: string;
  location?: string;
  status: 'searching' | 'matched' | 'expired';
}

export interface ExplorationOption {
  id: string;
  signalId: string;
  what: string;
  howMuch: number;
  unit: string;
  price?: number;
  currency?: string;
  score?: number;
  source: string;
}

export interface RiskDelta {
  category: 'trade_approval' | 'kyc' | 'risk' | 'approval_workflow' | 'fields';
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: Record<string, unknown>;
}

export interface PreflightResult {
  canCollapse: boolean;
  overallStatus: 'pass' | 'fail' | 'warning';
  deltas: RiskDelta[];
  checkedAt: string;
  note: string;
}

/**
 * Determine if exploration results are sufficient to proceed to POI.
 */
export function canProceedToIntent(options: ExplorationOption[]): boolean {
  return options.length > 0 && options.some(o => (o.score ?? 0) > 0.5);
}

/**
 * Score an option based on relevance, price, and freshness.
 */
export function scoreOption(option: ExplorationOption): number {
  const baseScore = option.score ?? 0.5;
  const priceBonus = option.price ? 0.1 : 0;
  return Math.min(1, baseScore + priceBonus);
}

/**
 * Client-side guard: collapse is only allowed when preflight passes.
 * This is a UI-level check; the server enforces the real rules.
 */
export function isCollapseAllowed(preflight: PreflightResult | null): boolean {
  return preflight !== null && preflight.canCollapse === true;
}
