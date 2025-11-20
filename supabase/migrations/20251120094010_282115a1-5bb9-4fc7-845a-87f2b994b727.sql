-- Add sandbox mode to organizations
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS sandbox_enabled BOOLEAN DEFAULT true;

-- Add environment field to API keys (sandbox vs production)
ALTER TABLE public.api_keys
ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production'));

-- Create SDK code examples table for tracking
CREATE TABLE public.sdk_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  language TEXT NOT NULL,
  example_type TEXT NOT NULL,
  code_snippet TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create webhook events table
CREATE TABLE public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_endpoint_id UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  delivered BOOLEAN DEFAULT false,
  delivered_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_events_endpoint_id ON public.webhook_events(webhook_endpoint_id);
CREATE INDEX idx_webhook_events_org_id ON public.webhook_events(org_id);
CREATE INDEX idx_webhook_events_created_at ON public.webhook_events(created_at DESC);
CREATE INDEX idx_webhook_events_delivered ON public.webhook_events(delivered);

-- Enable RLS
ALTER TABLE public.sdk_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- SDK examples are public (for docs)
CREATE POLICY "Anyone can view SDK examples"
ON public.sdk_examples
FOR SELECT
TO authenticated
USING (true);

-- Admins can manage SDK examples
CREATE POLICY "Admins can manage SDK examples"
ON public.sdk_examples
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Users can view their org's webhook events
CREATE POLICY "Users can view their org's webhook events"
ON public.webhook_events
FOR SELECT
TO authenticated
USING (
  org_id IN (
    SELECT org_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- Service role can insert webhook events
CREATE POLICY "Service role can insert webhook events"
ON public.webhook_events
FOR INSERT
TO authenticated
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Insert sample SDK examples
INSERT INTO public.sdk_examples (language, example_type, code_snippet, description) VALUES
('typescript', 'create_signal', 
'import { ComplianceAPI } from "@compliance-matching/sdk";

const client = new ComplianceAPI({
  apiKey: process.env.API_KEY
});

const signal = await client.signals.create({
  type: "buyer",
  content: {
    what: "Paracetamol 500mg tablets",
    how_much: 10000,
    unit: "units",
    where: "Johannesburg, South Africa",
    when: "2024-12-01"
  }
});

console.log("Signal created:", signal.id);', 
'Create a buyer or seller signal'),

('python', 'create_signal',
'from compliance_matching import ComplianceAPI

client = ComplianceAPI(api_key=os.environ["API_KEY"])

signal = client.signals.create(
    type="buyer",
    content={
        "what": "Paracetamol 500mg tablets",
        "how_much": 10000,
        "unit": "units",
        "where": "Johannesburg, South Africa",
        "when": "2024-12-01"
    }
)

print(f"Signal created: {signal.id}")',
'Create a buyer or seller signal'),

('curl', 'create_signal',
'curl -X POST https://your-project.supabase.co/functions/v1/signals \
  -H "x-api-key: your_api_key_here" \
  -H "Content-Type: application/json" \
  -d ''{
    "type": "buyer",
    "content": {
      "what": "Paracetamol 500mg tablets",
      "how_much": 10000,
      "unit": "units",
      "where": "Johannesburg, South Africa",
      "when": "2024-12-01"
    }
  }''',
'Create a buyer or seller signal'),

('typescript', 'create_match',
'const match = await client.matches.create({
  buyer_id: "buyer-org-id",
  buyer_name: "Acme Pharmacy",
  seller_id: "seller-org-id",
  seller_name: "PharmaCorp",
  commodity: "Paracetamol 500mg tablets",
  quantity_amount: 10000,
  quantity_unit: "units",
  price_amount: 50.00,
  price_currency: "ZAR",
  terms: "Net 30 days"
});

console.log("Match created:", match.id);',
'Create a compliance match'),

('python', 'create_match',
'match = client.matches.create(
    buyer_id="buyer-org-id",
    buyer_name="Acme Pharmacy",
    seller_id="seller-org-id",
    seller_name="PharmaCorp",
    commodity="Paracetamol 500mg tablets",
    quantity_amount=10000,
    quantity_unit="units",
    price_amount=50.00,
    price_currency="ZAR",
    terms="Net 30 days"
)

print(f"Match created: {match.id}")',
'Create a compliance match');