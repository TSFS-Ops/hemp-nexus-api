
-- Basic Memory Record v1 — HQ-only retained-outcome record.
-- Append-only, admin-readable, service-role writable.

CREATE TABLE public.basic_memory_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_event_type text NOT NULL,
  outcome text NOT NULL,
  outcome_reason text NOT NULL,
  outcome_summary text NULL,
  match_id uuid NULL REFERENCES public.matches(id) ON DELETE SET NULL,
  poi_id uuid NULL,
  wad_id uuid NULL REFERENCES public.wads(id) ON DELETE SET NULL,
  engagement_id uuid NULL REFERENCES public.poi_engagements(id) ON DELETE SET NULL,
  dispute_id uuid NULL REFERENCES public.disputes(id) ON DELETE SET NULL,
  source_table text NOT NULL,
  source_record_id uuid NOT NULL,
  source_function text NOT NULL,
  status_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_event_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  environment_classification text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT basic_memory_records_unique_per_source
    UNIQUE (trigger_event_type, source_record_id),

  CONSTRAINT basic_memory_records_env_chk
    CHECK (environment_classification IN ('live','demo','test')),

  CONSTRAINT basic_memory_records_trigger_chk
    CHECK (trigger_event_type IN (
      'finality.collapsed',
      'wad.sealed',
      'dispute.resolved'
    )),

  CONSTRAINT basic_memory_records_outcome_chk
    CHECK (outcome IN (
      'completed',
      'wad_sealed',
      'dispute_resolved'
    )),

  CONSTRAINT basic_memory_records_reason_chk
    CHECK (outcome_reason IN (
      'collapse_recorded',
      'attestations_complete',
      'dispute_resolved'
    ))
);

-- Grants:
-- - authenticated may attempt SELECT; RLS reduces it to platform_admin only.
-- - NO insert/update/delete grants to authenticated or anon.
-- - service_role has full table privileges (writer in a later batch).
GRANT SELECT ON public.basic_memory_records TO authenticated;
GRANT ALL ON public.basic_memory_records TO service_role;
-- Explicitly do NOT grant to anon.

ALTER TABLE public.basic_memory_records ENABLE ROW LEVEL SECURITY;

-- HQ-only SELECT. is_admin() is the canonical platform_admin gate.
CREATE POLICY "HQ admins can view basic memory records"
  ON public.basic_memory_records
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Service role bypasses RLS, but include an explicit policy so the
-- intent is grep-able and any future role tightening is obvious.
CREATE POLICY "Service role manages basic memory records"
  ON public.basic_memory_records
  FOR ALL
  USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text))
  WITH CHECK (((auth.jwt() ->> 'role'::text) = 'service_role'::text));

-- Append-only protection. Blocks UPDATE/DELETE for ALL roles (including
-- service_role) so Memory records cannot be silently rewritten. If a
-- correction is ever needed it must come from a documented HQ-note
-- correction event in a later batch — never an in-place edit.
CREATE OR REPLACE FUNCTION public.prevent_basic_memory_records_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'basic_memory_records is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER trg_basic_memory_records_no_update
  BEFORE UPDATE ON public.basic_memory_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_basic_memory_records_mutation();

CREATE TRIGGER trg_basic_memory_records_no_delete
  BEFORE DELETE ON public.basic_memory_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_basic_memory_records_mutation();

-- Indexes for the HQ list view filters.
CREATE INDEX idx_basic_memory_records_created_at
  ON public.basic_memory_records (created_at DESC);

CREATE INDEX idx_basic_memory_records_match_id
  ON public.basic_memory_records (match_id);

CREATE INDEX idx_basic_memory_records_outcome
  ON public.basic_memory_records (outcome);

CREATE INDEX idx_basic_memory_records_trigger_event_type
  ON public.basic_memory_records (trigger_event_type);

CREATE INDEX idx_basic_memory_records_environment
  ON public.basic_memory_records (environment_classification);

CREATE INDEX idx_basic_memory_records_source_record_id
  ON public.basic_memory_records (source_record_id);

COMMENT ON TABLE public.basic_memory_records IS
  'Basic Memory Record v1 — HQ-only retained-outcome record. Append-only (UPDATE/DELETE blocked by trigger). Closed v1 vocabularies enforced via CHECK constraints; mirrored in src/lib/basic-memory/outcomes.ts and scripts/check-basic-memory-vocab-drift.mjs.';
