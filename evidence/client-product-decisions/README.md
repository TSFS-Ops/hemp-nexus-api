# Client / Product Decisions — Deferred Tracker Items

**Status:** `CLIENT_PRODUCT_DECISIONS_RECORDED_IMPLEMENTATION_BATCHES_READY`

This document records authorised client/product decisions for tracker items
that were previously deferred as `CLIENT_DECISION_REQUIRED` (or similar).
It is a decision-recording turn only — **no code, RLS, grants, schema,
edge functions, provider calls, emails, refunds, or production data were
changed.** Implementation is broken into small batches (J1–J4) queued for
separate authorisation.

---

## 1. Item #22 — Suppressed auth/security emails

**Decision:** Split approach approved.

**Rule:**
- Security-critical account emails **may still send with a clear
  disclaimer** even if the recipient is on the suppression list:
  password reset (`recovery`), email change (`email_change`),
  re-authentication (`reauthentication`), account-security notices.
- Less-critical auth emails remain **fully suppressed** where
  suppression applies: signup (`signup`), invite (`invite`),
  magic-link (`magiclink`).

**Rationale:** Suppression must not lock a user out of their own account
or hide a security event (compromise recovery, unauthorised
email-change). Marketing-adjacent auth flows (signup, invite,
magic-link) stay suppressed to respect the suppression list.

**Approved status:** `ITEM_22_AUTH_EMAIL_SUPPRESSION_SPLIT_APPROACH_APPROVED`
**Reclassification:** `CLIENT_DECISION_REQUIRED` → `READY_TO_APPLY_PARTIAL`
**Now allowed to apply:** Batch J3 (see below).
**Still deferred:** Any change to the suppression-list write/opt-out
semantics themselves; disclaimer copy needs product/legal sign-off before
J3 apply.

---

## 2. Item #67 — Settlement mismatch payments

**Decision:** Manual admin review retained. No automated crediting. No
automated refunds.

**Rule:**
- If Paystack confirms payment but amount/currency/package does **not**
  match the expected purchase: **do not auto-credit tokens**.
- **Do not auto-refund.**
- Retain / ensure `admin_risk_items` visibility and a manual resolution
  workflow.
- Automated refunds are a **separate future client decision**.

**Rationale:** Money movement stays under human control until a
dedicated refund-automation decision is taken.

**Approved status:** `ITEM_67_SETTLEMENT_MISMATCH_MANUAL_REVIEW_APPROVED`
**Reclassification:** `CLIENT_DECISION_REQUIRED` → `CONTAINED_MANUAL_REVIEW_APPROVED`
**Now allowed to apply:** Nothing — current behaviour is the approved
behaviour. Only a documentation/UI gap check is authorised (see J4-adjacent).
**Still deferred:** Automated refund / auto-reversal policy.

---

## 3. Item #35 — Token ledger correction / append-only

**Decision:** Narrow internal ledger-label promotion allowlist only.
Everything else on `public.token_ledger` UPDATE/DELETE is blocked.

**Rule (allowlisted UPDATE):**
- Existing internal promotion from a temporary/holding entry to final
  `credit_purchase` label is allowed.
- `balance_after` / running-balance must **not** change.
- Token `amount` must **not** change.
- `org_id`, `user_id`, purchase/request identifier must **not** change.
- Only the approved promotion metadata marker (label transition +
  associated audit marker) may change.
- All other UPDATE column diffs → blocked.
- All DELETE → blocked.

**Rationale:** Preserves append-only shape of the ledger while
tolerating the one legitimate label-promotion path already in code.

**Approved status:** `ITEM_35_TOKEN_LEDGER_NARROW_PROMOTION_ALLOWLIST_APPROVED`
**Reclassification:** `NEEDS_MORE_INSPECTION` / `OPEN_NEEDS_REPAIR` →
`READY_TO_APPLY_WITH_NARROW_ALLOWLIST`
**Now allowed to apply:** Batch J1.
**Still deferred:** Anything that would let balances be edited.

---

## 4. Item #9 — Sealed match_documents full freeze

**Decision:** Full freeze of the original sealed document row.

**Rule:**
- Once a `match_documents` row is referenced inside a **sealed,
  non-revoked** WaD evidence bundle, that document row is frozen:
  - no post-seal metadata edits;
  - no post-seal delete;
  - no post-seal review/revoke/supersession mutation on the original
    sealed document row.
- Legitimate changes are expressed as a **new document version** plus a
  **new / superseding WaD flow** — never in place on the sealed row.

**Rationale:** Matches the WaD seal contract (C10) and Batch B3
attestations — evidence sealed inside an active WaD must be
byte-identical to what was signed.

**Approved status:** `ITEM_9_SEALED_DOCUMENT_FULL_FREEZE_APPROVED`
**Reclassification:** `CLIENT_DECISION_REQUIRED` → `READY_TO_APPLY_FULL_FREEZE`
**Now allowed to apply:** Batch J2.
**Still deferred:** None for the freeze itself; supersession/versioning
UX remains a separate product track.

---

## 5. C10 — Legal-hold badge visibility

**Decision:** Admin-only.

**Rule:**
- Legal-hold badge/status visible to platform_admin / legal / compliance
  roles only.
- Do **not** expose legal-hold state to normal match participants (buyer
  / seller / counterparty).
- Customer-facing legal-hold badges require a separate future approval.

**Rationale:** Legal-hold exposure to counterparties could tip off
subjects of an investigation and create legal risk.

**Approved status:** `C10_LEGAL_HOLD_BADGE_ADMIN_ONLY_APPROVED`
**Reclassification:** `CLIENT_DECISION_REQUIRED` →
`DO_NOT_APPLY_CUSTOMER_BADGE_ADMIN_ONLY_APPROVED`
**Now allowed to apply:** Nothing customer-facing. J4 is a tracker/UI
audit only (confirm no customer surface leaks the flag).
**Still deferred:** Any customer-facing legal-hold UI.

---

## Recommended implementation order (queued, NOT applied)

Each batch below is inspection-approved and awaits an explicit apply
authorisation in a subsequent turn.

### Batch J1 — Token ledger append-only trigger (#35)
- **Files/functions likely to change:**
  - new migration under `supabase/migrations/` creating
    `public.assert_token_ledger_append_only()` + BEFORE UPDATE OR DELETE
    trigger on `public.token_ledger`;
  - static guard in `src/tests/` pinning the allowlist and non-changes;
  - rollback-only SQL proof under `supabase/tests/`;
  - evidence README under `evidence/batch-j1-token-ledger-append-only/`.
- **Migration required:** Yes.
- **Edge deploy required:** No.
- **Tests / guards needed:** static allowlist assertions; SQL proof for
  allowed promotion, blocked amount/balance/org edit, blocked DELETE;
  writer scan (rg) confirming no live writer needs additional allowance.
- **Risk:** Medium. Trigger fires for service_role too — must be
  writer-audited first.
- **Sandbox verification:** Yes via SQL proof + writer scan.
- **Recommended next status on apply:**
  `BATCH_J1_TOKEN_LEDGER_APPEND_ONLY_DEPLOYED_PENDING_VERIFICATION`.

### Batch J2 — Sealed match_documents full-freeze trigger (#9)
- **Files/functions likely to change:**
  - new migration adding
    `public.assert_match_document_sealed_freeze()` + BEFORE UPDATE OR
    DELETE trigger on `public.match_documents`;
  - guard predicate: freeze when the document is referenced by any
    `wads` row with `sealed_at IS NOT NULL` AND `status <> 'revoked'`;
  - static guard test + rollback-only SQL proof;
  - evidence README under `evidence/batch-j2-sealed-match-documents-freeze/`.
- **Migration required:** Yes.
- **Edge deploy required:** No.
- **Tests / guards needed:** SQL proof covering unsealed edit allowed;
  sealed non-revoked edit/delete blocked; revoked WaD allows edit;
  writer scan of `match_documents`.
- **Risk:** Medium. Must not block legitimate pre-seal/unsealed flows or
  the versioning path.
- **Sandbox verification:** Yes.
- **Recommended next status on apply:**
  `BATCH_J2_SEALED_MATCH_DOCUMENTS_FULL_FREEZE_DEPLOYED_PENDING_VERIFICATION`.

### Batch J3 — Suppressed auth/security email split (#22)
- **Files/functions likely to change:**
  - `supabase/functions/auth-email-hook/index.ts` — classify template
    into `security_critical` vs `suppressible`;
  - `supabase/functions/send-transactional-email/index.ts` — pre-enqueue
    suppression check gains a bypass for `security_critical` with
    mandatory disclaimer variable;
  - shared classifier module (new) under
    `supabase/functions/_shared/`;
  - template updates for the four security-critical types to include
    the disclaimer block;
  - static guard test.
- **Migration required:** No.
- **Edge deploy required:** Yes (`auth-email-hook`,
  `send-transactional-email`).
- **Tests / guards needed:** static assertions on the classifier set,
  bypass predicate scoped to `security_critical` only, disclaimer
  presence in the four templates, negative guard that
  signup/invite/magiclink remain fully suppressed. Must include a
  guarded dispatch test that never contacts a real provider.
- **Risk:** Medium — touches auth email delivery. **Disclaimer copy
  needs product/legal sign-off before apply.**
- **Sandbox verification:** Partial (static + local dispatch, no live
  send).
- **Recommended next status on apply:**
  `BATCH_J3_AUTH_EMAIL_SUPPRESSION_SPLIT_DEPLOYED_PENDING_VERIFICATION`.

### Batch J4 — Legal-hold badge admin-only audit (documentation/UI only)
- **Files/functions likely to change:**
  - `rg` audit of all references to legal-hold flags across `src/` to
    confirm no customer surface renders them;
  - if any leak found, remove/gate behind admin role check;
  - evidence README under
    `evidence/c10-sealed-records/legal-hold-badge-admin-only/`.
- **Migration required:** No.
- **Edge deploy required:** No.
- **Tests / guards needed:** static rg guard asserting legal-hold badge
  components only render inside admin/governance route trees.
- **Risk:** Low.
- **Sandbox verification:** Yes.
- **Recommended next status on apply:**
  `BATCH_J4_LEGAL_HOLD_BADGE_ADMIN_ONLY_AUDIT_COMPLETE`.

### Item #67 — No implementation batch
Current manual-review behaviour is the approved behaviour. Only action
authorised is a read-only check that the admin risk-item surface for
settlement mismatches is present and visible; if that check finds a gap,
that becomes a separate small batch proposal — not an automatic apply.

---

## Explicit non-changes in this turn

- ❌ No code, migration, RLS, grant, policy, schema, or edge function
  changed.
- ❌ No edge function deployed.
- ❌ No provider call, no email sent, no refund, no credit/token
  mutation, no production row inserted/updated/deleted.
- ❌ Suppression list semantics unchanged.
- ❌ Settlement mismatch behaviour unchanged.
- ❌ Token ledger unchanged.
- ❌ `match_documents` unchanged.
- ❌ Legal-hold visibility unchanged (audit pending in J4).

**Final status:** `CLIENT_PRODUCT_DECISIONS_RECORDED_IMPLEMENTATION_BATCHES_READY`
