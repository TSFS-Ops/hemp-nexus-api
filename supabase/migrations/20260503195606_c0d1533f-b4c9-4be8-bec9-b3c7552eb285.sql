
ALTER TABLE public.token_ledger DROP CONSTRAINT token_ledger_action_type_check;
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'api_call', 'system_adjustment', 'declare_intent', 'credit',
    'counterparty_sighting', 'transaction_complete', 'buyer_commit',
    'credit_purchase', 'poi_generation', 'refund', 'administrative_adjustment',
    'legacy_pre_production_poi_generation'
  ]));
