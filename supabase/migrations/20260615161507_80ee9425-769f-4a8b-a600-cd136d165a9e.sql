
-- Batch 4: Request More Information workflow fields
ALTER TABLE public.facilitation_cases
  ADD COLUMN IF NOT EXISTS info_request_message text,
  ADD COLUMN IF NOT EXISTS info_request_items text[],
  ADD COLUMN IF NOT EXISTS info_request_due_date date,
  ADD COLUMN IF NOT EXISTS info_request_requested_by uuid,
  ADD COLUMN IF NOT EXISTS info_request_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS info_request_response_message text,
  ADD COLUMN IF NOT EXISTS info_request_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS info_request_response_evidence_summary text;
