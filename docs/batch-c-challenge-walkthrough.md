# Challenge Workflow — Manual Walkthrough Pack

Audience: Izenzo internal reviewers. Plain English; no developer
knowledge required. Read top-to-bottom or skip to a scenario.

---

## A. Overview

A **Challenge** is a formal, neutral concern raised against an active
match by either party (or by a platform administrator). Raising a
Challenge **pauses the match**: progression actions are blocked until
the Challenge reaches a terminal state.

Challenges are not disputes and do not allocate fault. The outcome
labels are deliberately neutral (e.g. "Corrected — trade may proceed",
"No action required").

A demo example used throughout this pack:

- Buyer: **BlueRock Minerals**
- Seller: **CopperLine Exports**
- Commodity: **Copper cathodes**
- Deal: **500 MT @ USD 8,200 / MT, CIF Rotterdam**
- Example concern: *"The delivery window shown on the match does not
  match the agreed term sheet."*

(In the live demo environment the reviewer will see the existing test
organisations *Batch A Counterparty Ltd* and *New Organisation* —
treat them as BlueRock and CopperLine for the purposes of the
walkthrough.)

---

## B. Demo accounts and roles

| Email                                          | Acts as                          |
|------------------------------------------------|----------------------------------|
| `trade@izenzo.co.za`                           | Buyer organisation administrator |
| `test2@izenzo.co.za`                           | Ordinary buyer-side member       |
| `uat-billing-1777478536038@test.izenzo.co.za`  | Seller organisation administrator|
| `james@izenzo.co.za`                           | Platform administrator           |

Six pre-seeded matches are available, each in a distinct Challenge
state. They are labelled "Demo · …" in the match list:

| Label                       | What it shows                          |
|-----------------------------|----------------------------------------|
| Demo · Open challenge       | An active, unreviewed Challenge        |
| Demo · Under review         | A Challenge a platform admin has picked up |
| Demo · Outcome recorded     | A terminal outcome (corrected and proceed) |
| Demo · Closed no action     | A terminal outcome (no action)         |
| Demo · Withdrawn            | The raiser withdrew the Challenge      |
| Demo · Admin override       | Platform admin closed under override   |

---

## C. Scenario 1 — Raise a Challenge as buyer org admin

1. Sign in as `trade@izenzo.co.za`.
2. Open any non-demo match where you are buyer.
3. Locate the **"Raise Challenge"** button beside the match summary.
4. Pick a subject (e.g. *Terms disagreement*).
5. Type a short, factual summary, for example:
   *"The delivery window shown on the match does not match the agreed
   term sheet."*
6. Submit.

You should now see the **Challenge Status Card** appear on the match,
showing status **Open**, your role, the subject and the summary.

---

## D. Scenario 2 — See the progression pause

Stay on the match from Scenario 1, or open *"Demo · Open challenge"*.

- A **Progression Paused Banner** appears at the top of the match.
- Any progression action (e.g. attempting to advance the deal state)
  is blocked and surfaces a neutral message indicating an open
  Challenge exists.
- The pause lifts automatically when the Challenge reaches a terminal
  state (recorded outcome, withdrawn, or closed-no-action).

---

## E. Scenario 3 — Comment and upload evidence

While signed in as either organisation administrator on a match with
an open or under-review Challenge:

1. Scroll to the Challenge section.
2. Use the comment composer to add a short note (5–4,000 characters).
3. Use the evidence uploader to attach a file (max 25 MB).
   The system records the file's SHA-256 fingerprint so the file's
   integrity can be verified later.

You should see your comment in the chronological thread and your
evidence row appear in the read-only evidence list, with its
fingerprint truncated for display.

---

## F. Scenario 4 — Ordinary member read-only view

1. Sign in as `test2@izenzo.co.za` (ordinary buyer-side member).
2. Open the same match.

Expected:

- The Challenge Status Card is visible.
- The comment thread is visible (read-only).
- The evidence list is visible (read-only).
- No "Raise Challenge" button.
- No comment composer.
- No evidence uploader.

This confirms ordinary members cannot mutate Challenges.

---

## G. Scenario 5 — Platform admin review queue

1. Sign in as `james@izenzo.co.za`.
2. Navigate to the Admin Challenge Queue (HQ).
3. The queue lists every active Challenge with: subject, raising
   organisation, status, age, and a "Review" button.

---

## H. Scenario 6 — Move to under review

In the Admin Challenge Queue, open *"Demo · Open challenge"* and click
**Move to under review**. The status flips to *Under review*; the
match still shows the Progression Paused Banner.

(*"Demo · Under review"* is pre-seeded already in this state.)

---

## I. Scenario 7 — Record outcome

From the Admin review drawer, choose **Record outcome**.

- Select an outcome label from the closed list:
  - No action required
  - Corrected — trade may proceed
  - Challenge withdrawn
  - Superseded by updated terms
  - Further evidence required
  - Match cannot proceed
- Add a short outcome summary.
- Submit.

The Challenge becomes terminal; the Progression Paused Banner
disappears from the match.

---

## J. Scenario 8 — Close with no action

From the same drawer, choose **Close — no action required**. This is
distinct from "Record outcome" and is intended for cases where no
substantive review action is warranted (e.g. raised in error,
duplicate, immaterial).

---

## K. Scenario 9 — Admin override closure

This is a serious, audited action used only when normal closure paths
are not available (e.g. unresponsive counterparty, exceptional
circumstances).

1. From the Admin review drawer, choose **Admin override closure**.
2. The system requires a written justification.
3. Confirm.

The Challenge closes with outcome **Admin override recorded**, the
override flag is set, and a mandatory audit record is written.

(*"Demo · Admin override"* is pre-seeded in this state for inspection
without performing the action.)

---

## L. What to report back during review

Use the companion **Review checklist** document. For each item, mark:

- Accept as-is
- Accept with wording change
- Needs change before sign-off
- Future scope, not required now

Add a free-text note where wording changes are proposed.
