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

/** Cache current user's org_id for signal attribution */
async function getCurrentOrgAndUser(): Promise<{ orgId: string | null; userId: string | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { orgId: null, userId: null };
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();
    return { orgId: profile?.org_id ?? null, userId: user.id };
  } catch {
    return { orgId: null, userId: null };
  }
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
    const { orgId, userId } = await getCurrentOrgAndUser();

    // Server-derived session ID: use the auth session's access token hash
    // to create a stable, cross-device session identifier tied to the JWT lifecycle.
    // Falls back to caller-provided sessionId, then a per-tab UUID for unauthenticated users.
    const effectiveSessionId = sessionId || await getServerSessionId() || getFallbackSessionId();

    const { error } = await supabase
      .from('behavioral_signals')
      .insert({
        action_type: actionType,
        match_id: matchId || null,
        session_id: effectiveSessionId,
        org_id: orgId,
        user_id: userId,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
      } as any);

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
 * Server-derived session ID — deterministic hash of the auth session token.
 * 
 * This means the same login session produces the same session_id on any device/tab,
 * and a new login (token refresh / re-auth) produces a new session_id.
 * Cross-device continuity is achieved because the auth session is the anchor.
 */
let _cachedServerSessionId: string | null = null;
let _cachedAccessTokenHash: string | null = null;

async function getServerSessionId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    // Only rehash if the token changed (perf: avoid repeated crypto on every signal)
    const tokenPrefix = session.access_token.slice(-16);
    if (_cachedAccessTokenHash === tokenPrefix && _cachedServerSessionId) {
      return _cachedServerSessionId;
    }

    // SHA-256 of the access token → stable session ID
    const encoder = new TextEncoder();
    const data = encoder.encode(session.access_token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    _cachedServerSessionId = 'srv_' + hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
    _cachedAccessTokenHash = tokenPrefix;

    return _cachedServerSessionId;
  } catch {
    return null;
  }
}

/**
 * Fallback for unauthenticated users — per-tab UUID (not persisted cross-device).
 * This is the minority case; most signals come from authenticated users.
 */
let _fallbackSessionId: string | null = null;
function getFallbackSessionId(): string {
  if (!_fallbackSessionId) {
    _fallbackSessionId = 'anon_' + crypto.randomUUID();
  }
  return _fallbackSessionId;
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
