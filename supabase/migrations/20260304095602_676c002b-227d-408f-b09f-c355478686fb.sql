DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'data_residency_region') THEN
    ALTER TABLE public.organizations ADD COLUMN data_residency_region text DEFAULT 'za-jnb';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;