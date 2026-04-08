
-- Table already partially created by failed migration, drop if exists
DROP TABLE IF EXISTS public.counterparties;

CREATE TABLE public.counterparties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  website TEXT,
  jurisdiction TEXT,
  registration_number TEXT,
  product_categories TEXT[] DEFAULT '{}',
  description TEXT,
  contact_email TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  fts tsvector,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Trigger function to maintain fts column
CREATE OR REPLACE FUNCTION public.counterparties_fts_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  NEW.fts :=
    setweight(to_tsvector('english', coalesce(NEW.company_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.jurisdiction, '')), 'C') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.product_categories, '{}'), ' ')), 'C');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_counterparties_fts
  BEFORE INSERT OR UPDATE ON public.counterparties
  FOR EACH ROW EXECUTE FUNCTION public.counterparties_fts_update();

-- Indexes
CREATE INDEX idx_counterparties_fts ON public.counterparties USING GIN (fts);
CREATE INDEX idx_counterparties_org ON public.counterparties (org_id);
CREATE INDEX idx_counterparties_jurisdiction ON public.counterparties (jurisdiction);
CREATE INDEX idx_counterparties_products ON public.counterparties USING GIN (product_categories);

-- RLS
ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all counterparties"
  ON public.counterparties FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert counterparties for their org"
  ON public.counterparties FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Users can update their org counterparties"
  ON public.counterparties FOR UPDATE TO authenticated
  USING (org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Users can delete their org counterparties"
  ON public.counterparties FOR DELETE TO authenticated
  USING (org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid()));

-- Timestamp trigger
CREATE TRIGGER update_counterparties_updated_at
  BEFORE UPDATE ON public.counterparties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
