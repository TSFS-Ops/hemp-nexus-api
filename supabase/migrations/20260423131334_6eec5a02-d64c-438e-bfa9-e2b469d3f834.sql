
CREATE TABLE public.rating_methodology_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE,
  weights JSONB NOT NULL,
  decay_half_life_days INTEGER NOT NULL DEFAULT 180,
  recent_window_days INTEGER NOT NULL DEFAULT 365,
  recent_weight NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  min_sample_size INTEGER NOT NULL DEFAULT 10,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rating_methodology_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view methodology versions"
  ON public.rating_methodology_versions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.rating_methodology_versions (version, weights, notes, active)
VALUES (
  1,
  '{"reliability": 0.35, "responsiveness": 0.20, "compliance": 0.25, "settlement": 0.20}'::jsonb,
  'Initial methodology: derived-only, no free-text reviews. 70/30 recent/historical weighting, 180-day half-life decay, min 10 settled deals for a rated band.',
  TRUE
);

CREATE TABLE public.counterparty_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  methodology_version INTEGER NOT NULL REFERENCES public.rating_methodology_versions(version),
  reliability_score NUMERIC(5,2),
  responsiveness_score NUMERIC(5,2),
  compliance_score NUMERIC(5,2),
  settlement_score NUMERIC(5,2),
  overall_score NUMERIC(5,2),
  band TEXT NOT NULL DEFAULT 'insufficient_history'
    CHECK (band IN ('platinum','gold','silver','bronze','new','insufficient_history')),
  sample_size INTEGER NOT NULL DEFAULT 0,
  recent_sample_size INTEGER NOT NULL DEFAULT 0,
  signals_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_recompute_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_counterparty_ratings_band ON public.counterparty_ratings(band);
CREATE INDEX idx_counterparty_ratings_overall ON public.counterparty_ratings(overall_score DESC NULLS LAST);

ALTER TABLE public.counterparty_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users view counterparty ratings"
  ON public.counterparty_ratings FOR SELECT
  TO authenticated
  USING (true);

CREATE TABLE public.rating_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pillar TEXT NOT NULL CHECK (pillar IN ('reliability','responsiveness','compliance','settlement')),
  signal_type TEXT NOT NULL,
  source_entity_type TEXT,
  source_entity_id UUID,
  raw_value NUMERIC,
  normalized_value NUMERIC,
  weight NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  decay_factor NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  methodology_version INTEGER NOT NULL REFERENCES public.rating_methodology_versions(version),
  observed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_rating_signals_org ON public.rating_signals(org_id, observed_at DESC);
CREATE INDEX idx_rating_signals_pillar ON public.rating_signals(org_id, pillar, observed_at DESC);

ALTER TABLE public.rating_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view rating signals"
  ON public.rating_signals FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.rating_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  filed_by_user_id UUID NOT NULL,
  rating_snapshot JSONB NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','reviewing','upheld','dismissed','recomputed')),
  reviewing_admin_id UUID,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rating_appeals_status ON public.rating_appeals(status, created_at DESC);
CREATE INDEX idx_rating_appeals_org ON public.rating_appeals(org_id, created_at DESC);

ALTER TABLE public.rating_appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins and platform admins view appeals"
  ON public.rating_appeals FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_org_admin(auth.uid(), org_id)
  );

CREATE POLICY "Org admins file appeals on own org"
  ON public.rating_appeals FOR INSERT
  TO authenticated
  WITH CHECK (
    filed_by_user_id = auth.uid()
    AND public.is_org_admin(auth.uid(), org_id)
  );

CREATE POLICY "Platform admins resolve appeals"
  ON public.rating_appeals FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_counterparty_ratings_updated_at
  BEFORE UPDATE ON public.counterparty_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_rating_appeals_updated_at
  BEFORE UPDATE ON public.rating_appeals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
