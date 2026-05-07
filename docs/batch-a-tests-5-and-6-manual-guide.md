# Batch A — Manual Testing Guide for Tests 5 and 6

**Audience:** Daniel Davies, James, David
**Scope:** Tests 5 and 6 only (org-admin contact-card visibility on the
counterparty side). All other Batch A items already pass automatically.
**Environment:** Test environment only. Do **not** use live client or
counterparty data.

---

## What Tests 5 and 6 actually check

These two tests verify the **MT-009 visibility rule** on the inline
"Complete counterparty contact" card that appears on a Match Details page
when an engagement is still pending:

- **Test 5 — Authorised case:** an org admin **on the counterparty side**
  of the match SHOULD see the card and be able to fill in the missing
  contact details (email / contact type / contact name).
- **Test 6 — Unauthorised case:** an org admin **on the initiator side**,
  an **unrelated org admin**, a normal org member, and a platform admin
  should **NOT** see that card on the same match.

Backend RLS and the `poi-engagements` edge function already enforce this
(covered by `supabase/functions/poi-engagements/batch-a_test.ts`). Tests
5/6 are the **front-end visual confirmation** that the gate also hides
the UI surface.

---

## Fixture data — required?

Yes. Tests 5/6 cannot run on the existing pending engagements in the
test database, because every current pending engagement is either:

1. a self-engagement (same org on both sides, e.g. `Pending verification
   (legacy)` rows), or
2. an engagement where the counterparty side has **no registered org**
   (so there is no "counterparty-side org admin" to log in as).

You therefore need **one purpose-built test engagement** with a registered
org on both sides. Setup is done once and can be reused indefinitely.

---

## Option B — Step-by-step: create the three test accounts

> We deliberately do **not** publish credentials in this document.
> Each tester sets their own password during signup.

### Accounts to create

| # | Role for the test | Account email (suggested)                       | Organisation to create | Side of the match     |
| - | ----------------- | ----------------------------------------------- | ---------------------- | --------------------- |
| 1 | Platform admin    | *(use your existing Izenzo platform-admin login)* | Izenzo                 | n/a (oversight)       |
| 2 | **Authorised** counterparty-side org admin | `batch-a-counterparty@test.izenzo.co.za` | "Batch A Counterparty Ltd" | Counterparty (seller) |
| 3 | Initiator-side org admin (used for Test 6) | `batch-a-initiator@test.izenzo.co.za`     | "Batch A Initiator Ltd"    | Initiator (buyer)     |
| 4 | **Unauthorised** unrelated org admin       | `batch-a-unrelated@test.izenzo.co.za`     | "Batch A Unrelated Ltd"    | Not on the match      |

Any address ending in `@test.izenzo.co.za` is recognised by the platform
as a test account and is auto-confirmed (no email-verification step).

### Step 1 — Create accounts 2, 3 and 4

For each of the three test accounts:

1. Open the Izenzo sign-in page in a private/incognito window.
2. Choose **Create account**.
3. Enter the email above and set a strong password (the tester chooses
   their own — do not share passwords by email).
4. When asked for the organisation name during onboarding, enter the
   organisation listed in the table above.
5. The new user is automatically the **org admin** of the organisation
   they just created. No further role change is needed.

> If a tester forgets their password, use **Forgot password** to send
> themselves a reset link. Never share a password in plain text.

### Step 2 — Build the test engagement (platform admin)

Sign in as the **platform admin** and:

1. Open **HQ → Engagements** (or the admin pending-engagements panel).
2. Use the existing "Create test engagement" / admin-create flow with:
   - **Initiator org:** *Batch A Initiator Ltd* (buyer side)
   - **Counterparty org:** *Batch A Counterparty Ltd* (seller side)
   - **Counterparty email:** *(leave blank — that is the whole point of
     Test 5; the card only appears when the contact is incomplete)*
   - **Status:** leave at the default `notification_sent` /
     `pending`.
3. Note the resulting **Match ID** — you will share the Match Details
   URL with each tester.

> The test counterparty in production is **Davies Trading ↔ Izenzo**
> (engagement `dc1cb443-…`). Do **not** use it for Tests 5/6 — that is
> live client data.

---

## How to run Test 5 (authorised counterparty-side admin)

**Tester:** sign in as `batch-a-counterparty@test.izenzo.co.za`.

1. Navigate to the Match Details URL provided by the platform admin.
2. **Expected to see:**
   - The match opens normally.
   - The inline card titled **"Complete counterparty contact"** is
     visible above the match hero card.
   - A clear status chip showing **"Contact incomplete"** (or
     **"Email missing"** depending on what was left blank).
   - A working "Add contact" form with the contact-type radio
     (Organisation / Named individual) and the "Save" button enabled
     once the form is valid.
3. **Expected NOT to see:**
   - No platform-admin-only controls (no "Force notify", no internal
     audit IDs).
   - No counterparty-side commercial actions on the other party's tabs.

**PASS criteria:** the card is shown, the form saves, and after saving
the chip changes to **"Organisation-level contact"** or
**"Named individual contact"** as appropriate.

---

## How to run Test 6 (unauthorised viewers)

Repeat the **same Match Details URL** for each of the three viewers
below, in three separate private/incognito windows.

| Tester signs in as                          | Expected outcome on the match page                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `batch-a-initiator@test.izenzo.co.za`       | Match opens. The "Complete counterparty contact" card is **HIDDEN**. No edit affordance.     |
| `batch-a-unrelated@test.izenzo.co.za`       | Match Details should not open at all (RLS denies access). At minimum, the card is hidden.    |
| Any normal (non-admin) member of the counterparty org | Match opens. The card is **HIDDEN** (only org admins on the counterparty side see it). |
| Platform admin                              | Match opens, but the inline card is **HIDDEN** — platform admin manages contact via the admin panel instead. |

**PASS criteria for Test 6:** the inline card is not visible to any of
the four viewer types above. If any of them sees the card, Test 6
**FAILS** and must be reported.

---

## Quick "what should I see" cheat sheet

| Viewer                                   | Card visible? | Can edit contact? |
| ---------------------------------------- | ------------- | ----------------- |
| Counterparty-side **org admin**          | ✅ Yes        | ✅ Yes            |
| Counterparty-side normal member          | ❌ No         | ❌ No             |
| Initiator-side org admin                 | ❌ No         | ❌ No             |
| Unrelated org admin                      | ❌ No         | ❌ No             |
| Platform admin                           | ❌ No (uses admin panel) | ✅ Yes (admin panel) |

---

## Safety reminders

- Use only `@test.izenzo.co.za` accounts and the test orgs listed above.
- Do not reuse the live Davies Trading ↔ Izenzo engagement for these
  tests.
- Each tester sets their own password; passwords are never shared in
  email or chat. If a password is lost, use **Forgot password**.
- The three test accounts can be left in place between test runs — they
  are safe to keep as long-lived UAT fixtures.

---

## If anything blocks the tester

If account creation, the admin "create test engagement" flow, or the
Match Details page does not behave as described above, capture:

1. The signed-in email and the match ID.
2. A screenshot of what is (or isn't) shown.
3. The browser URL.

Send that to the Izenzo build team — it tells us immediately whether the
issue is a UI regression (Tests 5/6 actually failing) or just a setup
question.
