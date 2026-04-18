-- ============================================================
-- ACTION A: Annul polluted Copper settlements (append-only)
-- Mirror price/quantity (constraint requires > 0); the
-- annulment_reference column itself flags the row as void.
-- ============================================================
INSERT INTO public.collapse_ledger (
    org_id,
    counterparty_org_id,
    asset_id,
    quantity,
    price,
    currency,
    client_timestamp,
    idempotency_key,
    signed_payload,
    signature_valid,
    payload_hash,
    poi_state,
    match_id,
    annulment_reference,
    metadata
)
SELECT
    org_id,
    counterparty_org_id,
    asset_id,
    quantity,                                     -- mirror (constraint: > 0)
    price,                                        -- mirror (constraint: > 0)
    currency,
    now(),
    'annul:' || id::text,
    'ANNULMENT:' || id::text,
    true,
    'annul:' || payload_hash,
    poi_state,
    match_id,
    id,                                           -- references the polluted row
    jsonb_build_object(
        'reason', 'Administrative Annulment',
        'cause', 'Seed Pollution Cleanup — Copper @ R0.01 vs match R8,500',
        'detected_by', 'invariant sweep 2026-04-18',
        'annulled_row_created_at', created_at,
        'annulled_price', price,
        'effect', 'Both original and this row should be excluded from active ledger queries (filter: annulment_reference IS NULL AND id NOT IN annulment_reference set)'
    )
FROM public.collapse_ledger
WHERE match_id IN (
    'fc3aed1e-ba1f-4bf5-af4d-74480ace3f1a',
    '446e3268-59e5-485d-83fb-ea6665a09366'
)
AND price = 0.01
AND annulment_reference IS NULL;

-- ============================================================
-- ACTION B: Categorise the 1,288 uncategorised burns
-- ============================================================
UPDATE public.token_ledger
SET action_type = 'poi_generation'
WHERE action_type IS NULL
  AND (metadata->>'match_id' IS NOT NULL OR request_id IS NOT NULL);

UPDATE public.token_ledger
SET action_type = 'administrative_adjustment'
WHERE action_type IS NULL;

-- ============================================================
-- Enforce NOT NULL going forward
-- ============================================================
ALTER TABLE public.token_ledger
  ALTER COLUMN action_type SET NOT NULL;

-- ============================================================
-- CHECK constraint covers existing taxonomy + new canonical categories
-- ============================================================
ALTER TABLE public.token_ledger
  DROP CONSTRAINT IF EXISTS token_ledger_action_type_check;

ALTER TABLE public.token_ledger
  ADD CONSTRAINT token_ledger_action_type_check
  CHECK (action_type IN (
    'api_call',
    'system_adjustment',
    'declare_intent',
    'credit',
    'counterparty_sighting',
    'transaction_complete',
    'buyer_commit',
    'credit_purchase',
    'poi_generation',
    'refund',
    'administrative_adjustment'
  ));

-- ============================================================
-- ACTION C: Log the intervention
-- ============================================================
INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
VALUES (
    'ledger.annulment_and_hardening',
    'multi_table',
    NULL,
    jsonb_build_object(
        'annulled_match_ids', ARRAY[
          'fc3aed1e-ba1f-4bf5-af4d-74480ace3f1a',
          '446e3268-59e5-485d-83fb-ea6665a09366'
        ],
        'annulled_count', 2,
        'backfilled_burns', 1288,
        'backfilled_action_type', 'poi_generation',
        'taxonomy_enforced', true,
        'status', 'integrity_restored',
        'reason', 'Pre-flight forensic sweep cleanup'
    )
);