-- Batch O Phase 2b Step 2 — local idempotency surface for future
-- detection-emit RPC. NO audit_logs change, NO triggers, NO outbound paths.
-- Writes are reserved for the future SECURITY DEFINER RPC / edge function;
-- this migration intentionally adds NO permissive write policy.

CREATE TABLE IF NOT EXISTS public.match_legacy_detection_emits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  signature text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  emitted_at timestamptz NOT NULL DEFAULT now(),
  emitted_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_legacy_detection_emits_signature_nonempty
    CHECK (length(signature) > 0),
  CONSTRAINT match_legacy_detection_emits_reasons_is_array
    CHECK (jsonb_typeof(reasons) = 'array'),
  CONSTRAINT match_legacy_detection_emits_unique_match_signature
    UNIQUE (match_id, signature)
);

CREATE INDEX IF NOT EXISTS idx_match_legacy_detection_emits_match
  ON public.match_legacy_detection_emits (match_id);
CREATE INDEX IF NOT EXISTS idx_match_legacy_detection_emits_emitted_at
  ON public.match_legacy_detection_emits (emitted_at DESC);

ALTER TABLE public.match_legacy_detection_emits ENABLE ROW LEVEL SECURITY;

-- Read-only access for platform admins. No INSERT/UPDATE/DELETE policy is
-- defined: writes must go through a future SECURITY DEFINER RPC bound to
-- service_role only. Without a write policy, RLS denies all client writes.
CREATE POLICY "Platform admins can view detection emits"
  ON public.match_legacy_detection_emits
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

COMMENT ON TABLE public.match_legacy_detection_emits IS
  'Batch O Phase 2b Step 2 (MT-008): idempotency ledger for future match.legacy_state_reconciliation_required detection-audit emits. Unique (match_id, signature) prevents duplicate audit rows. Writes go through future service-role RPC only.';