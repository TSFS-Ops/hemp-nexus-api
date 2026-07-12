
-- Pilot polish: populate safe demo jurisdiction and registration values on the two
-- pre-seeded demo funder organisations so non-technical testers no longer see the
-- confusing "Pilot Funder Bank (—)" label in the release form.
UPDATE public.p5_batch3_funder_organisations
SET jurisdiction = 'ZA (DEMO)',
    registration_number = 'DEMO-PFB-0001'
WHERE id = '11111111-1111-1111-1111-111111111111'
  AND (jurisdiction IS NULL OR registration_number IS NULL);

UPDATE public.p5_batch3_funder_organisations
SET jurisdiction = 'ZA (DEMO)',
    registration_number = 'DEMO-ITF-0001'
WHERE id = '22222222-2222-2222-2222-222222222222'
  AND (jurisdiction IS NULL OR registration_number IS NULL);
