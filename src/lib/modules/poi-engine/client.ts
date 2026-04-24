/**
 * POI Engine Client - Frontend API for state transitions and history.
 */

import { supabase } from '@/integrations/supabase/client';
import { fetchEdgeFunction, EdgeInvokeError } from '@/lib/edge-invoke';
import type { TransitionRequest, TransitionResult } from './state-machine';

/**
 * Request a Intent state transition via the backend edge function.
 * All validation and audit logging happens server-side.
 *
 * Note: the legacy signature accepted an explicit `accessToken` for callers
 * that managed sessions manually. It is now ignored — `fetchEdgeFunction`
 * pulls a fresh token from the live Supabase session and refreshes it if
 * it's about to expire, so callers no longer leak `Unauthorized` to users
 * when their token has gone stale.
 */
export async function requestTransition(
  request: TransitionRequest,
  _accessToken?: string
): Promise<TransitionResult> {
  try {
    const data = await fetchEdgeFunction<{ event?: unknown; error?: string; message?: string }>(
      'poi-transition',
      {
        method: 'POST',
        body: request,
        label: 'request state transition',
      }
    );
    return { success: true, event: (data as { event: unknown }).event };
  } catch (err) {
    if (err instanceof EdgeInvokeError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: (err as Error).message || 'Transition failed',
    };
  }
}

/**
 * Fetch the full state transition history for an intent (match).
 */
export async function getPoiHistory(matchId: string) {
  const { data, error } = await supabase
    .from('poi_events')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}
