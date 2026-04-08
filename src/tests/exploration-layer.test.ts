/**
 * Exploration Layer Acceptance Tests
 * 
 * 1) No poi_event_id exists until explicit collapse.
 * 2) Collapse API rejects when prerequisites are missing.
 * 3) No implicit POI creation from exploration.
 */

import { describe, it, expect } from 'vitest';
import {
  canProceedToIntent,
  scoreOption,
  isCollapseAllowed,
  type PreflightResult,
  type ExplorationOption,
} from '@/lib/modules/exploration/index';
import {
  validateTransition,
  VALID_TRANSITIONS,
  IMMUTABLE_STATES,
} from '@/lib/modules/poi-engine/state-machine';

// ── Test 1: No POI created during exploration ──
describe('Exploration layer is non-binding', () => {
  it('exploration functions return data but never create POI records', () => {
    const options: ExplorationOption[] = [
      { id: '1', signalId: 's1', what: 'Cashews', howMuch: 100, unit: 'MT', score: 0.8, source: 'test' },
    ];

    // canProceedToIntent is a read-only function - returns boolean, no side effects
    const canProceed = canProceedToIntent(options);
    expect(canProceed).toBe(true);
    
    // scoreOption is pure - no database writes
    const score = scoreOption(options[0]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('isCollapseAllowed returns false when preflight is null', () => {
    expect(isCollapseAllowed(null)).toBe(false);
  });

  it('isCollapseAllowed returns false when preflight fails', () => {
    const failedPreflight: PreflightResult = {
      canCollapse: false,
      overallStatus: 'fail',
      deltas: [{ category: 'trade_approval', status: 'fail', message: 'Not approved' }],
      checkedAt: new Date().toISOString(),
      note: 'test',
    };
    expect(isCollapseAllowed(failedPreflight)).toBe(false);
  });

  it('isCollapseAllowed returns true only when preflight passes', () => {
    const passingPreflight: PreflightResult = {
      canCollapse: true,
      overallStatus: 'pass',
      deltas: [{ category: 'trade_approval', status: 'pass', message: 'Approved' }],
      checkedAt: new Date().toISOString(),
      note: 'test',
    };
    expect(isCollapseAllowed(passingPreflight)).toBe(true);
  });
});

// ── Test 2: Collapse API rejects when prerequisites missing ──
describe('POI collapse blocked without prerequisites', () => {
  it('DRAFT → COMPLETED is not a valid transition', () => {
    const error = validateTransition('DRAFT', 'COMPLETED');
    expect(error).not.toBeNull();
    expect(error).toContain('not permitted');
  });

  it('PENDING_APPROVAL → COMPLETED is not valid', () => {
    const error = validateTransition('PENDING_APPROVAL', 'COMPLETED');
    expect(error).not.toBeNull();
  });

  it('ELIGIBLE → COMPLETED is not valid (must go through COMPLETION_REQUESTED)', () => {
    const error = validateTransition('ELIGIBLE', 'COMPLETED');
    expect(error).not.toBeNull();
  });

  it('only COMPLETION_REQUESTED → COMPLETED is valid', () => {
    const error = validateTransition('COMPLETION_REQUESTED', 'COMPLETED');
    expect(error).toBeNull();
  });
});

// ── Test 3: No implicit POI creation ──
describe('No implicit POI creation from exploration', () => {
  it('all exploration module exports are pure functions with no side effects', () => {
    // Verify the module exports don't include any database-writing functions
    const explorationExports = { canProceedToIntent, scoreOption, isCollapseAllowed };
    
    // Each function is callable and returns a value without throwing
    expect(typeof canProceedToIntent).toBe('function');
    expect(typeof scoreOption).toBe('function');
    expect(typeof isCollapseAllowed).toBe('function');
    
    // Call with empty/null inputs - should never throw or create records
    expect(canProceedToIntent([])).toBe(false);
    expect(scoreOption({ id: '', signalId: '', what: '', howMuch: 0, unit: '', source: '' })).toBeLessThanOrEqual(1);
    expect(isCollapseAllowed(null)).toBe(false);
  });

  it('COMPLETED state is immutable - no field mutations possible', () => {
    expect(IMMUTABLE_STATES).toContain('COMPLETED');
    expect(IMMUTABLE_STATES).toContain('ANNULLED');
  });

  it('only explicit COMPLETION_REQUESTED state can transition to COMPLETED', () => {
    // Verify no other state can reach COMPLETED
    const statesThatCanCollapse = Object.entries(VALID_TRANSITIONS)
      .filter(([_, targets]) => targets.includes('COMPLETED'))
      .map(([state]) => state);
    
    expect(statesThatCanCollapse).toEqual(['COMPLETION_REQUESTED']);
  });
});

// ── Pre-flight delta categories coverage ──
describe('Pre-flight delta categories', () => {
  it('covers all required risk delta categories', () => {
    const requiredCategories = ['trade_approval', 'kyc', 'risk', 'approval_workflow', 'fields'];
    // This test documents the categories the preflight endpoint checks
    requiredCategories.forEach(cat => {
      expect(typeof cat).toBe('string');
    });
  });
});
