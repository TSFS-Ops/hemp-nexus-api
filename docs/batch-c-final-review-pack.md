# Batch C — Final Review Pack

Audience: Izenzo commercial and governance stakeholders.
Tone: plain English. No technical knowledge required.

---

## How to use this pack

This is the **first of three documents** to read, in order:

1. `batch-c-final-review-pack.md` (this document) — what Batch C is
   and why it exists.
2. `batch-c-final-walkthrough.md` — exactly what to click in the demo
   environment, and what to notice.
3. `batch-c-reviewer-checklist.md` — the form to mark each item as
   *Looks correct / Needs wording change / Needs workflow change /
   Future scope*.

**Demo environment URL:**
> https://id-preview--95025ceb-b8ab-4906-adee-3188617c0dbc.lovable.app

**Login:** demo account emails are listed in the walkthrough.
Passwords will be shared by the Izenzo operator (James) over your
usual secure channel — they are deliberately not printed in this
pack.

**Two review paths (expected):** the same Challenge can be reviewed
two ways depending on role — trading-party users (buyer or seller
organisation) review it from the ordinary **match page**, and
platform admins review it from **Platform HQ → Disputes → Challenges**
sub-tab. Both views show the same Challenge.

**Out of scope for this review** (please do not flag):
evidence download / delete, comment editing, in-app notifications UI,
rating impact from Challenge outcomes, end-client help guide. All are
deferred to a later batch.

The workflow itself has already been approved. The purpose of this
pack is **confirmation and walkthrough, not redesign.**

---

## 1. What Batch C is

Batch C is the **Challenge Workflow** for live matches on the Izenzo
trade platform. It gives either side of a match — or a platform
administrator — a neutral, recorded way to raise a concern about a
match in progress, pause that match while the concern is reviewed, and
record a clear outcome.

It is not a dispute system. It does not allocate fault. It does not
declare winners or losers. It is a governance and review mechanism.

## 2. The problem it solves

Before Batch C, if either party noticed something wrong on a live
match — a delivery term that did not match the term sheet, a missing
document, an identity concern — there was no structured, audited way
to pause the match and have it reviewed. Conversations happened
off-platform, with no record.

Batch C closes that gap. Concerns are now raised on the platform,
visible to the right people, paused while reviewed, and closed with a
recorded outcome.

## 3. What a "Challenge" means

A **Challenge** is a formal, neutral concern raised against an active
match. It has:

- a subject (e.g. *Terms disagreement*, *Evidence quality concern*);
- a short written summary by the raiser;
- a status (Open → Under review → terminal outcome);
- a chronological comment thread;
- an evidence list (uploaded files with integrity fingerprints).

### Worked example

> BlueRock Commodities is buying 500 MT of copper cathodes from
> CopperLine Trading at USD 8,200 per tonne, CIF Rotterdam.
>
> The buyer admin notices the delivery window on the match shows
> "March" but the agreed term sheet says "April". They raise a
> Challenge with subject *Terms disagreement* and summary
> *"Delivery window on match does not match the agreed term sheet."*

The match is now paused.

## 4. Why progression pauses

Once a Challenge is raised, the match shows a **Progression Paused**
banner. Any attempt to advance the deal is blocked, with a neutral
message indicating an open Challenge exists.

The pause exists for one reason: **no party should be able to push a
match further forward while a live concern about it is unresolved.**

The pause lifts automatically when the Challenge reaches a terminal
state (outcome recorded, withdrawn, closed — no action, or admin
override recorded).

## 5. Who can raise a Challenge

- **Buyer organisation administrator** on a match where their
  organisation is buyer.
- **Seller organisation administrator** on a match where their
  organisation is seller.
- **Platform administrator** on any match.

Ordinary members of either organisation cannot raise Challenges.

## 6. Who can comment

The same three roles above can post comments to the chronological
thread on a Challenge they have access to. Comments are 5–4,000
characters and cannot be edited or deleted.

## 7. Who can upload evidence

The same three roles above can upload evidence files (max 25 MB per
file). Each upload is fingerprinted with a SHA-256 hash so the file's
integrity can be verified later. Evidence cannot be deleted.

## 8. What ordinary organisation members can see

Ordinary members of either organisation see the Challenge as
**read-only**:

- they see the Challenge Status Card;
- they see the chronological comment thread;
- they see the evidence list (with truncated fingerprints);
- they see the Progression Paused banner.

They cannot raise a Challenge, post comments, or upload evidence.

### Worked example

> A junior analyst at BlueRock Commodities opens the copper match. They
> see the open Challenge, the comments so far, and the evidence
> uploaded by the BlueRock admin and the CopperLine admin. They cannot
> add anything themselves.

## 9. What platform admins can do

Platform administrators access the **Admin Challenge Queue** in HQ.
For any Challenge they can:

- move it from Open to Under review;
- record an outcome from a closed list of neutral labels;
- close it with no action required;
- as a last resort, perform an Admin Override Closure (see §11).

## 10. How outcomes are recorded

When a platform admin records an outcome, they pick from a fixed list
of neutral labels:

- No action required
- Corrected — trade may proceed
- Challenge withdrawn
- Superseded by updated terms
- Further evidence required
- Match cannot proceed

They add a short outcome summary. The Challenge becomes terminal and
the match's pause is lifted.

### Worked example

> CopperLine Trading uploads the corrected commercial confirmation
> showing April delivery. The platform admin records the outcome as
> *Corrected — trade may proceed* with the summary *"Updated commercial
> confirmation aligns the match with the agreed term sheet."* The
> Progression Paused banner disappears and BlueRock can advance the
> match.

## 11. How Admin Override Closure works

Admin Override Closure is the **last-resort** governance action. It is
used only when normal closure paths are not available — for example, a
counterparty has gone unresponsive, or there are exceptional
circumstances that require the platform to step in.

It is a closed, audited action. The platform admin must enter:

- **Reason category** — chosen from a closed governance list
  (e.g. *Counterparty unresponsive*, *Regulatory direction*,
  *Exceptional governance event*).
- **Internal approval reference** — an Izenzo internal review or
  approval reference (e.g. `IZENZO-REV-2026-041`).
- **Regulator reference where applicable** — the external authority's
  reference, or *"Not applicable"*.
- **Written reason** — at least 60 characters explaining the decision.

The Challenge then closes with outcome **Admin override recorded** and
a permanent audit record is written. The override is **terminal** —
not a live bypass. It cannot reopen the match or move it forward; it
only closes the Challenge so the audit trail is complete.

## 12. Why the governance fields matter

The four fields exist so that an Admin Override Closure can never be
explained as "the admin clicked a button". Every override carries:

- **a category** that frames the type of decision;
- **an internal reference** that links it to an Izenzo governance review;
- **a regulator reference** when an external authority is involved, or
  an explicit *Not applicable* otherwise;
- **a written reason** that captures the actual rationale in the
  admin's words.

### Worked example

> A South African Reserve Bank exchange-control instruction requires a
> match to be closed pending a regulator review. A platform admin
> performs an Admin Override Closure with:
>
> - Reason category: *Regulatory direction*
> - Internal approval reference: `IZENZO-REV-2026-041`
> - Regulator reference: `SARB-EXCON-2026-117`
> - Written reason: *"Closed under SARB exchange-control instruction
>   pending regulator review. No further action by either party
>   required on this match."*

The same flow with no regulator involved would carry
*Not applicable* in the regulator field, and the rest of the record
would still stand on its own.

---

End of pack.
