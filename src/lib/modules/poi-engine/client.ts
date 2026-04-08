/**
 * POI Engine Client - Frontend API for state transitions and history.
 */

import { supabase } from '@/integrations/supabase/client';
import type { TransitionRequest, TransitionResult } from './state-machine';

/**
 * Request a Intent state transition via the backend edge function.
 * All validation and audit logging happens server-side.
 */
export async function requestTransition(
  request: TransitionRequest,
  accessToken: string
): Promise<TransitionResult> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/poi-transition`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return {
      success: false,
      error: data.error || data.message || 'Transition failed',
    };
  }

  return { success: true, event: data.event };
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
