/**
 * Behavioral Signals Library
 * 
 * Tracks non-binding user interactions (skip, maybe_later, view, etc.)
 * These signals are used for UX analytics ONLY and do NOT create:
 * - Audit records
 * - Evidence chain entries
 * - Match/intent records
 * - Legal obligations
 * 
 * Only "Confirm Intent" creates binding records.
 */

import { supabase } from "@/integrations/supabase/client";

export type BehavioralActionType = 
  | 'skip' 
  | 'maybe_later' 
  | 'not_now' 
  | 'view' 
  | 'browse';

interface LogBehavioralSignalParams {
  actionType: BehavioralActionType;
  matchId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

/**
 * Log a non-binding behavioral signal
 * 
 * IMPORTANT: This does NOT create any legal intent or evidence records.
 * This is purely for UX analytics and improving the user experience.
 */
export async function logBehavioralSignal({
  actionType,
  matchId,
  sessionId,
  metadata = {},
}: LogBehavioralSignalParams): Promise<{ success: boolean; error?: string }> {
  try {
    // Generate a session ID if not provided
    const effectiveSessionId = sessionId || getOrCreateSessionId();

    const { error } = await supabase
      .from('behavioral_signals')
      .insert({
        action_type: actionType,
        match_id: matchId || null,
        session_id: effectiveSessionId,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
      });

    if (error) {
      console.error('Failed to log behavioral signal:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Error logging behavioral signal:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Get or create a session ID for tracking user sessions
 */
function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return crypto.randomUUID();
  
  const storageKey = 'behavioral_session_id';
  let sessionId = sessionStorage.getItem(storageKey);
  
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(storageKey, sessionId);
  }
  
  return sessionId;
}

/**
 * Helper functions for specific action types
 */
export const behavioralSignals = {
  skip: (matchId?: string, metadata?: Record<string, any>) =>
    logBehavioralSignal({ actionType: 'skip', matchId, metadata }),
  
  maybeLater: (matchId?: string, metadata?: Record<string, any>) =>
    logBehavioralSignal({ actionType: 'maybe_later', matchId, metadata }),
  
  notNow: (matchId?: string, metadata?: Record<string, any>) =>
    logBehavioralSignal({ actionType: 'not_now', matchId, metadata }),
  
  view: (matchId?: string, metadata?: Record<string, any>) =>
    logBehavioralSignal({ actionType: 'view', matchId, metadata }),
  
  browse: (metadata?: Record<string, any>) =>
    logBehavioralSignal({ actionType: 'browse', metadata }),
};

/**
 * Action type documentation for reference
 */
export const ACTION_DOCUMENTATION = {
  BINDING: {
    confirm_intent: {
      createsAuditRecord: true,
      createsEvidence: true,
      hasLegalMeaning: false, // Signals interest, NOT a contract
      description: 'Signals serious interest so seller can prepare final terms. No contract or payment.',
    },
  },
  NON_BINDING: {
    skip: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User skipped this match - purely behavioral signal for UX improvement',
    },
    maybe_later: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User deferred decision - tracked for re-engagement opportunities',
    },
    not_now: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User declined for now - no commitment or obligation',
    },
    view: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User viewed match details - read-only operation',
    },
    browse: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User browsed listings - no specific match interaction',
    },
  },
};
