# Governance follow-up: historical hardcoded JWT in pilot fixture migration

Status: OPEN - tracked separately from PR #26. Not resolved by, and not blocking, PR #26.

## Context

During the PR #26 enterprise readiness audit, a hardcoded bearer token (JWT-shaped, embedded in an inline HTTP `Authorization` header) was found in a historical migration file. Per explicit instruction, PR #26 does **not** modify, rotate, or remove this token; this note exists solely to hand the item to a governance/security owner as a tracked follow-up.

**This document intentionally does not reproduce the token value.** Anyone investigating should retrieve it directly from the file at a permitted access level, not from this note or from any chat/report log.

## Location

- Migration filename: `supabase/migrations/20260414203338_f63010ab-6e64-4841-9b57-d73791efc023.sql`
- The token appears inline as part of a `Bearer` `Authorization` header value used by an HTTP call embedded in that migration.

## Open questions for the governance/security owner

1. **Token classification still needs confirmation.** It is not yet confirmed whether this is a long-lived Supabase anon/service key, a short-lived project JWT that has since expired, or a synthetic/test value that was never valid against a live project. Classification determines urgency.
2. **Potential rotation.** If classification concludes this is (or was) a live credential, the corresponding Supabase project key(s) should be rotated regardless of whether the token still validates, since it has been present in plaintext in version control.
3. **Vault/configuration migration.** Regardless of classification outcome, the pattern of embedding bearer tokens inline in SQL migration files should be replaced with a Supabase Vault secret (or equivalent secret-manager reference) so future migrations do not repeat this pattern.
4. **Repository-history scan.** A full git-history scan (not just the current tree) should be run for this and similar token patterns, since a hardcoded credential in an old migration may also appear in earlier commits, forks, or force-pushed branches not visible from the current `main`.

## Explicit non-actions taken in PR #26

- The migration file above was not edited, and the token was not touched, rotated, or removed as part of PR #26.
- No report, log, commit message, or documentation produced during the PR #26 remediation reproduces the token value.

## Owner / next step

Assign to whoever holds the Supabase project credentials / secrets-management responsibility. This note should be converted into a tracked issue (or equivalent governance ticket) with the above four open questions as acceptance criteria, and closed only once classification is confirmed and, if warranted, rotation has occurred.
