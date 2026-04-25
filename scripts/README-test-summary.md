# `test-summary.mjs`

Wraps `vitest run` and splits failures into two buckets so cleanup PRs are
easier to trust:

| Bucket | Meaning | Action |
|---|---|---|
| **Pre-existing UAT credential** | Failure is in `src/tests/uat/**` AND either (a) matches a known live-backend signature (rate-limit, auth, edge 401/404, missing RPC, network) or (b) lives in a UAT file where another failure already matched (a cascade from a broken setup step). | Safe to ignore for cleanup PRs that don't touch backend or auth. |
| **NEW failures** | Anything else. | Must be investigated before merge. |

## Usage

```bash
npm run test:summary                 # run + print summary, mirror vitest exit code
npm run test:summary:strict          # exit 0 if ONLY pre-existing UAT failures remain
node scripts/test-summary.mjs --json /tmp/report.json  # also write a structured report
```

## Tuning

The signature list lives in `UAT_CRED_PATTERNS` at the top of
`scripts/test-summary.mjs`. Add a regex there when a new flavour of
credential/live-backend failure appears. Keep entries narrow — anything matched
here is **excused**, so over-matching defeats the point of the runner.

## CI suggestion

For PRs that purely delete dead code or tweak frontend surfaces:

```yaml
- run: npm run test:summary:strict
```

This will pass as long as no NEW failures were introduced, even if the live
UAT backend is unreachable from CI.
