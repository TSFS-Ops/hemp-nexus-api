# Batch A — Manual Testing Guide for Tests 5 and 6

**Audience:** Daniel Davies, James, David
**Scope:** Tests 5 and 6 only (org-admin contact-card visibility on the
counterparty side). All other Batch A items already pass automatically.
**Environment:** Test environment only. Do **not** use live client or
counterparty data.

> **Verification note (2026-05-07):** This document was re-verified against
> the live codebase before sending. Several details in the earlier draft
> were corrected — see "Important platform behaviour" below.

---

## What Tests 5 and 6 actually check

These two tests verify the **MT-009 visibility rule** on the inline
"Complete counterparty contact" card that appears on a Match Details page
when an engagement is still pending:

- **Test 5 — Authorised case:** an org admin **on the counterparty side**
  of the match SHOULD see the card and be able to fill in the missing
  contact details (`counterparty_email`, `contact_type`, `contact_name`).
- **Test 6 — Unauthorised case:** an org admin **on the initiator side**,
  an **unrelated org admin**, a normal org member, and a platform admin
  should **NOT** see that inline card on the same match.

Backend RLS and the `poi-engagements` edge function already enforce this
(covered by `supabase/functions/poi-engagements/batch-a_test.ts`). Tests
5/6 are the **front-end visual confirmation** that the gate also hides
the UI surface.

---

## Important platform behaviour (verified)

These four points materially affect the steps below:

1. **`@test.izenzo.co.za` accounts are NOT auto-confirmed at sign-up.**
   Standard sign-up sends a verification email. Test accounts must be
   confirmed by the platform admin using the `confirm-test-user` edge
   function (or, equivalently, by clicking the verification link).
   *Source:* `supabase/functions/confirm-test-user/index.ts`.
2. **A new organisation is created automatically for every new sign-up,
   and that user becomes its `org_admin`.** The org's initial name is the
   user's email address. A platform admin can rename it afterwards from
   **HQ → Orgs**. *Source:* `_provision_user` migration
   `20260313203726_…`.
3. **There is no "Create test engagement" button in the UI.** Engagements
   (`poi_engagements` rows) are only created by the `match` edge function
   when one org runs a Trade Request against a counterparty. The
   `AdminPendingEngagementsPanel` lists and edits them — it does not
   create them.
4. **Putting an unregistered counterparty's email into a Trade Request
   binds that engagement to the counterparty's registered org via the
   auto-link trigger** (so a registered counterparty org admin can later
   take over the contact card). This is how we get Test 5's "authorised
   counterparty-side org admin" without writing SQL.

---

## Fixture data — required?

Yes. Tests 5/6 cannot be run on existing pending engagements:

- The only current pending engagement with registered orgs on both sides
  is the live `Izenzo ↔ Davies Trading` row — that is real client data
  and must not be used.
- All other pending engagements are either self-engagements or have an
  unregistered counterparty side (no org admin to log in as).

You therefore need a one-time fixture: **3 test users, 3 test orgs, and
1 test engagement**. The engagement is built using the normal trade
flow — no SQL or seed scripts needed.

---

## Step-by-step setup

### Accounts to create

| # | Purpose                                    | Suggested email                              | Side of the match     |
| - | ------------------------------------------ | -------------------------------------------- | --------------------- |
| 0 | Platform admin                             | *(an existing `@izenzo.co.za` admin login)*  | n/a (oversight)       |
| 1 | Initiator-side org admin                   | `batch-a-initiator@test.izenzo.co.za`        | Initiator (buyer)     |
| 2 | **Authorised** counterparty-side org admin | `batch-a-counterparty@test.izenzo.co.za`     | Counterparty (seller) |
| 3 | Unauthorised unrelated org admin           | `batch-a-unrelated@test.izenzo.co.za`        | Not on the match      |

### Step 1 — Each tester signs themselves up

For each of accounts 1, 2 and 3:

1. Open the Izenzo sign-in page in a private/incognito window.
2. Choose **Create account**, enter the email above, set a strong
   password (the tester picks their own — never share passwords).
3. The platform will send a verification email. **Do not wait for it** —
   instead, see Step 2.

> Account creation automatically creates a brand-new organisation for
> that user, and the user becomes its **org admin**. The org will be
> named after their email (e.g. `batch-a-initiator@test.izenzo.co.za`).

### Step 2 — Platform admin confirms the three test users

The simplest route, because we control the test domain:

1. Sign in as the platform admin.
2. Open **HQ → Users** (`AdminUsersManagement`).
3. Find each of the three test users and use **Confirm email** (this
   calls the `confirm-test-user` edge function under the hood; it only
   accepts `@test.izenzo.co.za` addresses).
4. Each user can now sign in.

> If the **Confirm email** action is not visible in the Users panel, ask
> the build team to run `confirm-test-user` once with the user's ID, or
> click the verification link in the inbox of the test mailbox.

### Step 3 — Platform admin renames the three test orgs

Cosmetic only, but it makes the test results easy to read:

1. Sign in as the platform admin.
2. Open **HQ → Orgs** (`OrgsManagement`).
3. Rename each of the three new organisations:
   - The org owned by `batch-a-initiator@…` → **Batch A Initiator Ltd**
   - The org owned by `batch-a-counterparty@…` → **Batch A Counterparty Ltd**
   - The org owned by `batch-a-unrelated@…` → **Batch A Unrelated Ltd**

### Step 4 — Build the test engagement (no admin "create" button — use the normal trade flow)

There is no admin-side "Create engagement" button. Engagements are
created when a real Trade Request is run. Do this:

1. Sign in as the **initiator-side** test user
   (`batch-a-initiator@test.izenzo.co.za`).
2. Go to **Desk → New Trade Request**.
3. Fill in any plausible test commodity / quantity / terms.
4. In the counterparty section, **enter the counterparty test user's
   email** — `batch-a-counterparty@test.izenzo.co.za` — and submit.
5. The platform's auto-link trigger will:
   - create a `poi_engagements` row in `notification_sent` /
     `pending`,
   - bind the counterparty side to *Batch A Counterparty Ltd* (because
     that email is now registered).
6. Note the resulting **Match ID** from the URL — share it with each
   tester.

If the platform admin would prefer to leave the contact deliberately
incomplete (so the Test 5 card definitely renders), they can also:

- Sign in as **platform admin**, open **HQ → Engagements**, find the
  new engagement, and use **Edit contact** to clear `counterparty_email`
  / `contact_type` / `contact_name` so the engagement is in
  `email_missing` or `contact_incomplete` state.

> **Do not** reuse the live `Izenzo ↔ Davies Trading` engagement
> (`dc1cb443-…`) for Tests 5/6 — it is real client data.

---

## How to run Test 5 (authorised counterparty-side admin)

**Tester:** sign in as `batch-a-counterparty@test.izenzo.co.za`.

1. Navigate to the Match Details URL provided by the platform admin.
2. **Expected to see:**
   - The match opens normally.
   - The inline card **"Complete counterparty contact"** is visible
     above the match hero card.
   - A status chip showing **"Contact incomplete"** or **"Email
     missing"** (depending on which fields were left blank).
   - A working form with the contact-type radio (Organisation / Named
     individual) and a Save button that becomes enabled once the form
     is valid.
3. **Expected NOT to see:**
   - No platform-admin-only controls (no "Force notify", no internal
     audit IDs, no support notes textarea).
   - No status-transition controls (no Accept / Decline buttons on
     behalf of the other side).

**PASS criteria:** the card is shown, the form saves, and after saving
the chip changes to **"Organisation-level contact"** or **"Named
individual contact"** as appropriate.

---

## How to run Test 6 (unauthorised viewers)

Open the **same Match Details URL** in a fresh private window for each
viewer below.

| Tester signs in as                             | Expected outcome                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `batch-a-initiator@test.izenzo.co.za`          | Match opens. The "Complete counterparty contact" card is **HIDDEN**. No edit affordance.      |
| `batch-a-unrelated@test.izenzo.co.za`          | Match Details should not open at all (RLS denies access). At minimum, the card is hidden.     |
| Any normal (non-admin) member of the counterparty org | Match opens. Card is **HIDDEN** (only org admins on the counterparty side see it).      |
| Platform admin                                 | Match opens, but the inline card is **HIDDEN** — admin uses the **HQ → Engagements** panel.   |

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
| Platform admin                           | ❌ No (uses HQ → Engagements) | ✅ Yes (admin panel) |

---

## Safety reminders

- Use only `@test.izenzo.co.za` accounts and the test orgs above.
- Do **not** reuse the live `Izenzo ↔ Davies Trading` engagement.
- Each tester sets their own password; no plaintext credentials are
  shared by email or chat. If lost, use **Forgot password**.
- The three test accounts can be left in place between test runs —
  they are safe long-lived UAT fixtures.

---

## If anything blocks the tester

Capture and send to the Izenzo build team:

1. The signed-in email and the Match ID.
2. A screenshot of what is (or isn't) shown.
3. The browser URL.

That immediately tells us whether it's a real Test 5/6 regression or a
setup question.
