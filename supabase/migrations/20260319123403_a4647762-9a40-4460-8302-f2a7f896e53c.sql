ALTER TABLE public.matches ALTER COLUMN quantity_amount DROP NOT NULL;
ALTER TABLE public.matches ALTER COLUMN quantity_unit DROP NOT NULL;
ALTER TABLE public.matches ALTER COLUMN price_amount DROP NOT NULL;
ALTER TABLE public.matches ALTER COLUMN price_currency DROP NOT NULL;