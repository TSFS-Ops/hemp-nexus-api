# Registry — Client-Safe Limitations (Batch 18)

> Show this list to Izenzo, bank or institutional stakeholders before any
> demo. Canonical strings live in `CLIENT_SAFE_LIMITATIONS` in
> [`src/lib/registry-release-gate-ssot.ts`](../../src/lib/registry-release-gate-ssot.ts).

- Live provider verification is not enabled.
- Production API access is disabled by default.
- Imported registry data requires provenance and freshness controls.
- Claim approval does not itself verify the company.
- Authority approval does not itself verify the company.
- Bank-detail capture does not itself verify the bank details.
- Manual verification requires an approved business decision and a
  compliance gate.
- Provider simulation is not real provider verification.
- Raw bank details are not exposed through public or API routes.
- Country readiness is controlled country-by-country.
- Demo / UAT data must not be treated as production data.
