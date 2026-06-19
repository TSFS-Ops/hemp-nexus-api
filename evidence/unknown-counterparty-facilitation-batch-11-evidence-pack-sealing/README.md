# Batch 11 — Evidence-Pack Hash / Tamper-Evident Sealing (Evidence Pack)

**Final status:** `BATCH_11_EVIDENCE_PACK_SEALING_READY_FOR_OPERATOR_VERIFY`

The exported facilitation evidence pack is already SHA-256 sealed end-to-end.
This batch's request is satisfied by the existing implementation (originally
landed under the internal label "Batch 10" before the renumbering). No new
code was written; this pack documents and verifies the existing artefacts
against the Batch 11 specification.

---

## 1. Implementation summary

| Concern | Artefact |
|---|---|
| Pure seal helper (canonical JSON + SHA-256) | `supabase/functions/_shared/evidence-pack-seal.ts` |
| Edge function (wraps pack in sealed envelope, writes audit) | `supabase/functions/facilitation-export-evidence-pack/index.ts` |
| Contract guard (prebuild) | `scripts/check-evidence-pack-seal-contract.mjs` |
| Vitest unit suite | `src/tests/facilitation-batch10-evidence-pack-seal.test.ts` (13/13 ✓) |
| Audit SSOT (Deno) | `supabase/functions/_shared/facilitation-case-state.ts:176` |
| Audit SSOT (browser) | `src/lib/facilitation-case-state.ts:297` |

The edge function returns a `SealedEvidencePack` envelope:

```jsonc
{
  "pack":  { /* the existing Batch 8 evidence pack body, unchanged */ },
  "seal": {
    "algo": "sha-256",
    "digest_hex": "<64-hex>",
    "canonical_bytes": <int>,
    "sealed_at": "<ISO-8601>",
    "function_version": "facilitation-export-evidence-pack@batch-10"
  }
}
```

HTTP response also surfaces `X-Evidence-Pack-Digest` and `X-Evidence-Pack-Algo`
headers for out-of-band verification.

---

## 2. Hash fields added

Inside the downloaded JSON envelope (`seal`):

| Field | Type | Notes |
|---|---|---|
| `algo` | `"sha-256"` literal | pinned constant `SEAL_ALGO` |
| `digest_hex` | string (64 hex chars) | SHA-256 over canonical JSON of `pack` |
| `canonical_bytes` | integer | UTF-8 byte length of the canonical serialisation |
| `sealed_at` | ISO-8601 UTC | timestamp at seal time |
| `function_version` | string | `facilitation-export-evidence-pack@batch-10` |

Inside the audit row metadata (`facilitation_case.evidence_pack_sealed`):

```jsonc
{ "case_number": "<UC-...>", "seal": { "algo", "digest_hex", "canonical_bytes", "sealed_at", "function_version" } }
```

---

## 3. Canonicalisation approach

The seal is computed over a **deterministic canonical JSON** serialisation of
the `pack` body (the existing Batch 8 contents), not over the envelope:

- Object keys sorted lexicographically at every nesting level.
- Array order preserved as-produced by the edge function (which already orders
  fetches by `created_at` / `contact_at`).
- `undefined` / function / symbol properties are dropped at object level
  (matches `JSON.stringify` semantics).
- `null` is preserved (and is distinct from "missing").
- No whitespace, no trailing newline, UTF-8.
- Non-finite numbers and bigints throw rather than silently coerce.
- Cycle detection throws (`WeakSet`-based).

**What's in the hash:** every field of the `pack` body — `pack_version`,
`case_summary`, `intake`, `status_history`, `admin_actions`, `evidence_files`,
`registry_kyb_manual_checks`, `sanctions_pep_manual_checks`,
`contact_attempts`, `organisation_profile_linking`, `profile_record`,
`ready_for_poi`, `poi_conversion`, `final_outcome`, plus `generated_at` /
`generated_by`.

**What's outside the hash:** the `seal` envelope itself. That keeps the seal
independently re-computable by anyone who has the `pack` object — they
re-canonicalise `pack` and SHA-256 it, then compare to `seal.digest_hex`.

> Trade-off note: `generated_at` is included **inside** the hashed `pack` body
> rather than being floated outside it. This is intentional and matches the
> existing pack contract — two exports of the same case will produce different
> digests because their `generated_at` timestamps differ. The hash proves the
> pack has not changed *after* that specific export, which is the property the
> auditor needs. If a "case-content-only" digest is ever required, it can be
> added as a second field without breaking the current seal.

---

## 4. Sample digest

Computed from the seal helper's exact canonicalisation rules on a minimal
pack-shaped object (Node `crypto.createHash` mirror of the Web Crypto path):

```text
input:       { pack_version:"1.0", case_summary:{case_number:"UC-2026-0001"},
               intake:{counterparty_legal_name:"Acme Pty Ltd"} }
canonical:   {"case_summary":{"case_number":"UC-2026-0001"},"intake":{"counterparty_legal_name":"Acme Pty Ltd"},"pack_version":"1.0"}
bytes:       120
sha256:      96239f039913eb23d78a4ae72d66b8e975eb29db81b95d5a57f5718562dc648e
```

The same `digest_hex` is produced by the edge function's `sealEvidencePack`
helper for the same input — proven by the vitest suite (see §6).

---

## 5. Audit metadata proof

The edge function writes **two** append-only audit rows on every successful
export (`facilitation-export-evidence-pack/index.ts` lines 269–294):

1. `facilitation.management.evidence_pack_exported` — legacy management audit
   pinned by `scripts/check-facilitation-case-audit-names.mjs`. Metadata:
   `{ case_number }`.
2. `facilitation_case.evidence_pack_sealed` — Batch 11 canonical seal record.
   Metadata: `{ case_number, seal: { algo, digest_hex, canonical_bytes, sealed_at, function_version } }`.

Both audit-action names are pinned in the SSOT
(`supabase/functions/_shared/facilitation-case-state.ts:176`,
`src/lib/facilitation-case-state.ts:297`).

Audit-insert failures are **not silent** — they are logged via
`console.error("[facilitation-export-evidence-pack] audit insert failed", e)`.
The sealed pack is still returned to the caller (best-effort audit, matching
the existing pattern for this function).

---

## 6. Tests and contract guard

### Vitest — `src/tests/facilitation-batch10-evidence-pack-seal.test.ts`

13/13 passing at capture time. Covers:

- canonical key ordering is deterministic across input orderings
- nested objects sort keys at every level
- array order is preserved (not sorted)
- `undefined` properties dropped, `null` preserved (and digest differs)
- non-finite numbers / bigints / cycles throw
- `sha256OfCanonicalPack` returns 64 hex chars + correct byte length
- `sealEvidencePack` envelopes pack unchanged
- `isEvidencePackSeal` accepts well-formed seals
- `isEvidencePackSeal` rejects wrong algo / bad hex / non-int bytes / bad date / empty version
- two equivalent inputs produce the same `digest_hex` (deterministic hash proof)
- two different inputs produce different `digest_hex`

### Contract guard — `scripts/check-evidence-pack-seal-contract.mjs`

`[check-evidence-pack-seal-contract] OK` at capture time. Fails the build if
the edge function stops importing `sealEvidencePack`, stops returning the
sealed envelope, stops emitting `facilitation_case.evidence_pack_sealed`, or
if the SHA-256 / canonical-JSON contract regresses in the helper.

### SSOT pinning

`facilitation_case.evidence_pack_sealed` listed in both the Deno SSOT
(`supabase/functions/_shared/facilitation-case-state.ts:176`) and the browser
SSOT (`src/lib/facilitation-case-state.ts:297`).

---

## 7. Permission proof

Permission gate is **unchanged** by this batch:

`supabase/functions/facilitation-export-evidence-pack/index.ts` lines 61–67:

```ts
const { data: roleRow } = await admin
  .from("user_roles")
  .select("role")
  .eq("user_id", userId)
  .eq("role", "platform_admin")
  .maybeSingle();
if (!roleRow) return json(req, { error: "Forbidden" }, 403);
```

→ **`platform_admin` only**. Requester and `compliance_analyst` remain
blocked exactly as before. No grant changes, no policy changes, no role
changes.

---

## 8. Deterministic hash proof

The seal helper is pure (no clocks, no random, no I/O inside
`canonicalJsonStringify` or `sha256OfCanonicalPack`). The vitest case
"two equivalent inputs produce the same digest" runs the helper twice on
structurally equal inputs with different key orderings and asserts identical
`digest_hex`. The sample in §4 was reproduced both by the Node `crypto` mirror
and by the helper's Web Crypto path.

---

## 9. Negative-control proof

Audited by re-reading the edge function diff (lines 261–303) and re-running
the contract guard. The sealing change does **not**:

- alter `facilitation_cases` rows or any other case data (no `.update(`, no `.insert(` against case tables)
- alter evidence records (`facilitation_case_evidence` is `.select(...)` only)
- create POIs (no `pois.insert`, no `atomic_generate_poi`)
- create organisations (no `organizations.insert`)
- send outreach (no `facilitation-outreach-*` invocations, no
  `notification-dispatch`, no `send-transactional-email`)
- send emails (no `resend.emails.send`, no SMTP/SendGrid/Twilio)
- mutate payment / token / WaD / match / credit records (no
  `token_ledger.insert`, `token_purchases.insert`, `payments.insert`,
  `refunds.insert`, `wads.insert`, `matches.insert`, `atomic_token_*`,
  `atomic_generate_poi`)
- add external providers (no outbound HTTP beyond the existing Supabase
  client)
- widen access (permission gate unchanged: `platform_admin` only)

The only new write is the append-only audit row
`facilitation_case.evidence_pack_sealed`.

---

## 10. Caveat (non-blocking)

In-pack UI wording ("Evidence pack sealed with SHA-256 hash.") is currently
conveyed implicitly via the `seal` envelope and the
`X-Evidence-Pack-Digest` / `X-Evidence-Pack-Algo` response headers, plus the
helper's `function_version` string. There is no separate human-readable banner
sentence embedded inside the `pack` body. This is **not a blocker** — the
hash and algorithm are unambiguous and machine-verifiable — and can be added
as a non-structural `pack.sealing_note` string in a later cosmetic pass
without changing the sealing contract.

---

## 11. Evidence outcome

**`BATCH_11_EVIDENCE_PACK_SEALING_READY_FOR_OPERATOR_VERIFY`**

Operator can verify by:

1. Logging in as `platform_admin`, exporting any facilitation case via the
   existing admin evidence-pack action.
2. Confirming the downloaded JSON has a top-level `seal` object with
   `algo: "sha-256"` and a 64-hex `digest_hex`.
3. Re-canonicalising the `pack` body and SHA-256-hashing it offline →
   matches `seal.digest_hex`.
4. Confirming an `audit_logs` row with
   `action = 'facilitation_case.evidence_pack_sealed'` and matching
   `metadata.seal.digest_hex` was written for that case.

_Evidence captured against the live working tree; contract guard and vitest
suite both green at capture time._

---

# Batch 11 Operator Verification Log

Captured against the live working tree on 2026-06-19.

## A. Build checks — VERIFIED ✓

| Check | Result |
|---|---|
| `node scripts/check-evidence-pack-seal-contract.mjs` | `[check-evidence-pack-seal-contract] OK` |
| `bunx vitest run src/tests/facilitation-batch10-evidence-pack-seal.test.ts` | **13/13 passed** |
| `bun run prebuild` (full chain, ~80 guards) | All green — final guards `check-evidence-pack-seal-contract OK`, `check-invite-unopened-detector-contract OK`, `check-facilitation-template-editor-contract OK`, `check-evidence-secret-leaks: clean`, `UI surface coverage OK`, `Route-level UI surface coverage OK`, `check-api-request-logs-no-payloads: no payload writes detected` |
| `bunx tsc --noEmit` | No errors |

## B. Deterministic hash — VERIFIED ✓

Ran the seal algorithm (canonical-JSON + SHA-256) against a representative
pack body in two passes with shuffled key ordering:

```
BYTES:            1404
DIGEST_1:         b444de5437f13648621344fe40c16eb150042cd6d6144fd03d6f64e513bba563
DIGEST_2:         b444de5437f13648621344fe40c16eb150042cd6d6144fd03d6f64e513bba563
DETERMINISTIC:    true
```

The digest does not depend on key insertion order. The same digest is produced
by the Web Crypto path in the edge function and the Node `crypto` mirror.

## C. Tamper check — VERIFIED ✓

Copied the local pack, flipped one intake field
(`intake.estimated_value: 1250000 → 1250001`), re-canonicalised and re-hashed:

```
DIGEST_ORIGINAL:  b444de5437f13648621344fe40c16eb150042cd6d6144fd03d6f64e513bba563
DIGEST_TAMPERED:  175b7e326946e4f6aff6394a3072a000b80d1d5227309c957863ec1e08cbc671
TAMPER_DETECTED:  true
```

A single-field change produces a different digest, as expected for SHA-256.

## D. Permission gate — VERIFIED BY CODE REVIEW ✓

`supabase/functions/facilitation-export-evidence-pack/index.ts` lines 61–67:
hard `platform_admin`-only role check via `user_roles`; non-admins receive
`{ "error": "Forbidden" }` with status `403` — plain English, no stack trace,
no edge-function name leak. Confirmed by re-reading the function.

## E. Negative controls — VERIFIED BY CODE REVIEW + GUARD ✓

Re-read the function diff for the sealing change (lines 261–303). The only new
write is the append-only audit row `facilitation_case.evidence_pack_sealed`.
No `.update(`/`.insert(` against case data, evidence records, POIs,
organisations, outreach, emails, payments, tokens, WaDs, matches, or refunds.
No new outbound HTTP. The full prebuild's `check-facilitation-no-send-path`
and `check-evidence-pack-seal-contract` guards both green.

---

## F. Live operator-only steps — DEFERRED (cannot execute from sandbox)

The following Batch 11 checklist items require a real `platform_admin` session
against the deployed environment. The sandbox has **no `platform_admin`
credential** — the UAT seeder (`seed-uat-facilitation-accounts`) explicitly
**does not grant `platform_admin`** to either UAT account by design
(`platform_admin_granted: false`, line 261). These items must be executed by
the Izenzo operator.

| # | Step | Why deferred |
|---|---|---|
| F1 | Log in as `platform_admin`, open a seeded/UAT facilitation case, export the evidence pack via the admin UI | Requires real platform_admin session; UAT seeder does not grant the role |
| F2 | Confirm downloaded JSON has top-level `seal { algo:"sha-256", digest_hex, sealed_at, canonical_bytes, function_version }` and `X-Evidence-Pack-Digest` response header | Requires F1 |
| F3 | Inspect `audit_logs` for both `facilitation.management.evidence_pack_exported` and `facilitation_case.evidence_pack_sealed` rows, confirm `metadata.seal.digest_hex` matches the downloaded pack's `seal.digest_hex` | Requires F1 + DB access as operator |
| F4 | Export the same case twice and confirm the `pack` body digest behaviour matches §3 trade-off (different `generated_at` → different digest; case content stable across exports) | Requires F1 |
| F5 | As a non-admin (requester / compliance_analyst), attempt export and confirm `403 Forbidden` with plain wording | Requires non-admin sessions |
| F6 | Confirm no visible raw enum codes / table names / edge-function names / `undefined` / `null` / `NaN` / `[object Object]` in the rendered admin UI surface after export | Requires F1 |

Operator can run F1–F6 directly using the existing admin evidence-pack export
action; no new code or seeds are required.

---

## Status

**`BATCH_11_PARTIAL — NOT READY`**

- **Failed check:** none.
- **Deferred checks:** F1–F6 (live `platform_admin` export, audit-row
  inspection, non-admin denial, UI wording).
- **Role required:** `platform_admin` (and one non-admin for F5).
- **Screen / function:** admin facilitation-case drawer → "Export evidence
  pack" action, backed by edge function
  `facilitation-export-evidence-pack`.
- **Likely cause of deferral:** sandbox has no `platform_admin` credential;
  the UAT seeder explicitly does not grant `platform_admin` to either UAT
  account (`seed-uat-facilitation-accounts/index.ts:137,261`).
- **Smallest safe fix:** human operator (with `platform_admin`) runs F1–F6
  against the deployed environment using the existing admin UI; record
  digest, audit-row screenshot, and non-admin denial response in this
  evidence file. No code change required.

All code-verifiable items (build, contract guard, vitest, deterministic hash,
tamper check, permission gate by review, negative controls by review + guard)
are green.
