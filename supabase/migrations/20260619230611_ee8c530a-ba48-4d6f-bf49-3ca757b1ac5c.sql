ALTER TABLE public.facilitation_cases
  ADD COLUMN IF NOT EXISTS linked_poi_id uuid NULL REFERENCES public.pois(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS poi_conversion_confirmed_by uuid NULL,
  ADD COLUMN IF NOT EXISTS poi_conversion_eligibility_payload jsonb NULL,
  ADD COLUMN IF NOT EXISTS poi_conversion_method text NULL
    CHECK (poi_conversion_method IS NULL OR poi_conversion_method IN ('linked_existing','recorded_reference'));

CREATE INDEX IF NOT EXISTS idx_facilitation_cases_linked_poi_id
  ON public.facilitation_cases (linked_poi_id)
  WHERE linked_poi_id IS NOT NULL;