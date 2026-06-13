GRANT SELECT, INSERT, UPDATE ON public.facilitation_cases TO authenticated;
GRANT ALL ON public.facilitation_cases TO service_role;
GRANT SELECT, INSERT ON public.facilitation_case_events TO authenticated;
GRANT ALL ON public.facilitation_case_events TO service_role;
GRANT SELECT, INSERT ON public.facilitation_case_evidence TO authenticated;
GRANT ALL ON public.facilitation_case_evidence TO service_role;