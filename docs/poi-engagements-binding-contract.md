# POI Engagement — Binding Hint Contract

The admin endpoint `PATCH /poi-engagements/:id` returns a `binding` object on
the response **whenever the request body includes `counterparty_email`**. The
reviewer dashboard uses this object to show an immediate, accurate signal of
whether the recipient will actually see the engagement in their inbound queue.

This document is the canonical reference for that contract.

---

## Why the hint exists

Engagement visibility on the counterparty side is filtered by
`poi_engagements.counterparty_org_id`. If that column is `NULL`, the recipient
**cannot see the engagement** even if their email is on file. To close that
gap, the PATCH handler resolves `counterparty_email → profiles.org_id` at
write-time and auto-binds when a match exists.

The `binding` hint tells the reviewer the outcome of that resolution without
forcing them to inspect the row afterwards. It is **always non-fatal** — the
email is saved regardless of whether resolution succeeds.

---

## Response shape

```jsonc
// 200 OK
{
  "engagement": { /* full poi_engagements row */ },
  "binding": {
    "status": "bound" | "no_match" | "already_bound" | "lookup_error",
    // ...status-specific fields
  }
}
```

The `binding` field is **only** present when the PATCH payload included
`counterparty_email`. For status updates, support-notes edits, etc., it is
omitted.

---

## `binding.status` values

| Status           | Fields                                  | What it means                                                                                                                                                | Reviewer dashboard tone |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `bound`          | `org_id`, `email`                       | The supplied email matched a registered profile. The engagement is now bound to `org_id` and **will appear in the counterparty's inbound queue**.            | success (green)         |
| `no_match`       | `email`, `message`                      | The email is valid but **no registered organisation matches it yet**. The engagement is saved but stays unbound until the recipient signs up or it's fixed.  | warning (amber)         |
| `already_bound`  | `org_id`                                | The engagement was already bound to an organisation before this PATCH. The auto-resolver **will not overwrite** a deliberate prior binding.                  | info (neutral)          |
| `lookup_error`   | `email`, `message`                      | The profile lookup failed transiently (e.g. brief DB hiccup). The email is still saved; the admin should retry shortly to pick up an auto-bind if available. | error (red)             |

---

## What the reviewer should do

| Status           | Action                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `bound`          | None. The notification email and the recipient dashboard are now aligned.                            |
| `no_match`       | Confirm the email is correct. If it is, no action — the recipient will be auto-bound on signup.      |
| `already_bound`  | None. If you intended to re-target the engagement, raise it through admin manual overrides instead.  |
| `lookup_error`   | Retry the email update once. If it persists, escalate to engineering.                                |

---

## Validation errors

Invalid or missing emails do **not** produce a `binding` hint — they are
returned as a standard `400 VALIDATION_ERROR`:

```jsonc
// 400 Bad Request
{
  "code": "VALIDATION_ERROR",
  "message": "Validation failed: counterparty_email: counterparty_email must be a valid email address",
  "details": {
    "errors": [
      { "path": "counterparty_email", "message": "...", "code": "invalid_string" }
    ]
  },
  "requestId": "<uuid>"
}
```

This is the same canonical error envelope used by every other endpoint
(`code` / `message` / `details` / `requestId`).

---

## Idempotency

PATCH supports the `Idempotency-Key` header. Replaying the same key returns
the **byte-identical** cached body — including the `binding` hint — so the
reviewer dashboard sees a stable status across retries. Validation failures
are not cached, so a corrected payload under the same key still executes.

See `supabase/functions/poi-engagements/index_test.ts` for the full set of
contract tests covering validation, normalisation, binding outcomes, and
idempotency replay.

---

## Source of truth

* **Resolver** — `supabase/functions/poi-engagements/index.ts` (PATCH handler)
* **Type definition** — `src/types/poi-engagement.ts`
* **Reviewer copy** — `BINDING_HINT_MESSAGES` in `src/types/poi-engagement.ts`
* **Tests** — `supabase/functions/poi-engagements/index_test.ts`
