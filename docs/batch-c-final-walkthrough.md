# Batch C — Step-by-Step Walkthrough

Audience: Daniel and the wider Izenzo review team.
Environment: Izenzo demo / staging only. **Not production.**

## Quick start (read this first)

**1. Where do I go?**
Open the demo / staging environment in your browser:

> **https://id-preview--95025ceb-b8ab-4906-adee-3188617c0dbc.lovable.app**

(If your team uses the staging custom domain instead, the Izenzo
operator will send you the alternative URL — the demo content is the
same.)

**2. How do I log in?**
Use the demo accounts listed in the table below.
**Passwords are not printed in this document.** The Izenzo operator
(James) will share the demo passwords with you over your usual secure
channel before the review session. If a password does not work, ping
James and he will reset it on the spot.

**3. What do I click first?**
Log in as the **Buyer organisation administrator**
(`trade@izenzo.co.za`), open the match labelled
**Demo · Open challenge** from the match list, and start at
*Walkthrough 1* below.

**4. What am I meant to notice?**
Each walkthrough section tells you exactly what should appear on
screen and answers one commercial question (e.g. *"Does this pause
feel appropriate when a buyer or seller has raised a genuine
concern?"*). You only need to confirm those points — you do not need
to test edge cases.

**5. Two ways to review the same Challenge — this is expected.**
There are two ways to review the same Challenge depending on role.

- **Trading-party users** (buyer or seller organisation administrators
  and ordinary members) review a Challenge from the **ordinary match
  page**, by opening the match from their match list.
- **Platform admins** review a Challenge from **Platform HQ →
  Disputes → Challenges sub-tab** (the Challenge Queue / review
  drawer), not from the ordinary match page.

Both views show the same Challenge. This is expected.

**6. What is out of scope right now?**
Please **do not** flag the following — they are deliberately deferred
and will be picked up in a later batch:

- Evidence file download from the read-only list
- Evidence delete / replace
- Comment editing or deletion
- In-app notifications UI for new comments / outcomes
- Any rating or scoring impact from a Challenge outcome
- A polished end-client (counterparty) help guide

The purpose of this pack is **confirmation and walkthrough**, not
redesign. Daniel has already approved the workflow.

---

This walkthrough takes a reviewer through all six pre-seeded demo
Challenges. For each one it tells you which account to sign in as,
what to click, what you should see, what it means commercially, and
the one commercial question it is asking you to answer.

The narrative example throughout is:

> BlueRock Commodities (buyer) and CopperLine Trading (seller),
> 500 MT of copper cathodes at USD 8,200 / MT, CIF Rotterdam.

In the demo environment the buyer org is *Batch A Counterparty Ltd*
and the seller org is *New Organisation*. Treat them as BlueRock and
CopperLine for the purposes of the walkthrough.

---

## Demo accounts

| Email                                          | Use as                            |
|------------------------------------------------|-----------------------------------|
| `trade@izenzo.co.za`                           | Buyer organisation administrator  |
| `test2@izenzo.co.za`                           | Ordinary buyer-side member        |
| `uat-billing-1777478536038@test.izenzo.co.za`  | Seller organisation administrator |
| `james@izenzo.co.za`                           | Platform administrator            |

## Demo matches

All six demo matches are listed below using friendly identifiers used
throughout this guide. In the actual environment you'll recognise
each one by its Challenge subject and summary text (the queue does
not display these "Demo ·" titles as a column).

1. Demo · Open challenge
2. Demo · Under review
3. Demo · Outcome recorded
4. Demo · Closed no action
5. Demo · Withdrawn
6. Demo · Admin override recorded — note: the platform records an
   admin override as the *outcome* of a Challenge, not as a separate
   queue category. In Platform HQ → Disputes → Challenges this
   example appears as a **terminal (closed) row**, identifiable by
   the summary *"Counterparty unresponsive for 14 days; requested
   administrative closure."*

---

## Walkthrough 1 — Open Challenge

**Sign in as:** buyer org admin (`trade@izenzo.co.za`).

**Open:** *Demo · Open challenge*.

**Click:** nothing — just scroll the match.

**Expect to see:**
- a **Progression Paused** banner at the top of the match;
- a Challenge Status Card showing status **Open**, the subject, the
  raiser's role, and the short summary;
- the comment thread (may be empty or contain early comments);
- the read-only evidence list.

**What it means commercially:**
A live concern has been raised on the BlueRock × CopperLine copper
match. Until it is resolved, neither side can push the deal forward.
This is the platform behaving exactly as agreed: hold the deal, surface
the concern, keep a record.

**Commercial question to answer:**
*Does this pause feel appropriate when a buyer or seller has raised a
genuine concern about a live match?*

---

## Walkthrough 2 — Under Review

**Sign in as:** platform admin (`james@izenzo.co.za`).

**Open:** HQ → Disputes → **Challenges** sub-tab → *Demo · Under review*
row → click **Review**.

**Expect to see:**
- the review drawer with the Challenge details;
- status shown as **Under review**;
- the comment thread and evidence list visible;
- the match itself still shows the Progression Paused banner.

**What it means commercially:**
The platform has formally picked up the concern. Both parties can see
that it is being looked at. The match is still paused.

**Commercial question to answer:**
*Is it clear to both parties that the platform has taken ownership of
the review and that the match remains paused while that is happening?*

---

## Walkthrough 3 — Outcome Recorded

This Challenge is terminal. There are two ways to confirm it,
depending on role.

### 3a. Party-side view (buyer or seller)

**Sign in as:** buyer org admin (`trade@izenzo.co.za`).

**Open:** *Demo · Outcome recorded* from the match list (the ordinary
match page).

**Expect to see:**
- the Challenge Status Card showing the terminal outcome
  **Corrected — trade may proceed** (or similar);
- the recorded outcome summary, e.g.
  *"Updated commercial confirmation aligns the match with the agreed
  term sheet."*;
- the **Progression Paused** banner is no longer shown — the match is
  free to move forward.

### 3b. Platform-admin view

**Sign in as:** platform admin (`james@izenzo.co.za`).

**Go to:** Platform HQ → **Disputes** → **Challenges** sub-tab.

**Open:** the *Demo · Outcome recorded* row in the queue → click
**Review**.

**Expect to see:**
- the Challenge in the review drawer with the same terminal outcome
  and outcome summary;
- the full Challenge details (subject, raiser, comment thread,
  evidence list).

**What it means commercially:**
CopperLine fixed the underlying issue. The platform recorded the
correction with a neutral outcome. BlueRock and CopperLine can now
move the deal forward, and platform admins can see the closed record
in HQ.

**Commercial question to answer:**
*Are the neutral outcome labels (e.g. "Corrected — trade may proceed")
commercially safe and free of blame language?*

---

## Walkthrough 4 — Closed — No Action

This Challenge is terminal. There are two ways to confirm it,
depending on role.

### 4a. Party-side view (buyer or seller)

**Sign in as:** buyer org admin (`trade@izenzo.co.za`).

**Open:** *Demo · Closed no action* from the match list (the ordinary
match page).

**Expect to see:**
- the Challenge Status Card showing terminal outcome
  **No action required**;
- a short outcome summary explaining why no action was needed
  (e.g. raised in error, immaterial, duplicate);
- the **Progression Paused** banner is no longer shown.

### 4b. Platform-admin view

**Sign in as:** platform admin (`james@izenzo.co.za`).

**Go to:** Platform HQ → **Disputes** → **Challenges** sub-tab.

**Open:** the *Demo · Closed no action* row in the queue → click
**Review**.

**Expect to see:**
- the Challenge in the review drawer with the same terminal outcome
  and outcome summary;
- the full Challenge details visible in HQ.

**What it means commercially:**
The concern was reviewed and did not need any action. The record is
preserved so we know it was looked at, even though nothing changed.

**Commercial question to answer:**
*Is "Closed — no action required" a clear, non-dismissive way to record
a Challenge that did not warrant any change?*

---

## Walkthrough 5 — Withdrawn

**Party-side view — sign in as:** buyer org admin
(`trade@izenzo.co.za`) and open *Demo · Withdrawn* from the match
list.

**Platform-admin view — sign in as:** platform admin
(`james@izenzo.co.za`), go to Platform HQ → **Disputes** →
**Challenges** sub-tab, and open the *Demo · Withdrawn* row → click
**Review**.

**Expect to see (either view):**
- the Challenge in a terminal state of **Withdrawn**;
- the original subject, summary, and any comments preserved;
- the match unpaused.

**What it means commercially:**
The party that raised the concern decided to withdraw it (e.g. they
realised they had read the term sheet incorrectly). The platform keeps
the record. No fault is recorded.

**Commercial question to answer:**
*Does "Withdrawn" feel like a clean, neutral exit when a raiser
realises the concern is no longer valid?*

---

## Walkthrough 6 — Admin Override Recorded

**Sign in as:** platform admin (`james@izenzo.co.za`).

**Go to:** Platform HQ → **Disputes** → **Challenges** sub-tab.

**Important — how to identify this row in the queue:**
The platform records an admin override as the **outcome** of a
Challenge, not as a separate queue category. There is therefore no
row literally labelled "Admin Override" in the Challenges queue.
Instead, look for the **terminal (closed) row** whose summary reads:

> *"Counterparty unresponsive for 14 days; requested administrative
> closure."*

That is the admin override demo example.

**Open:** the row described above (it will appear as a terminal /
outcome-recorded entry in the queue) → click **Review** to open the
review drawer.

**Expect to see (inside the review drawer):**
- the Challenge in a terminal state with outcome
  **Admin override recorded** clearly shown in the drawer header /
  outcome section;
- the four governance fields displayed:
  - Reason category (e.g. *Regulatory direction*)
  - Internal approval reference (e.g. `IZENZO-REV-2026-041`)
  - Regulator reference (e.g. `SARB-EXCON-2026-117`, or
    *Not applicable*)
  - Written reason (≥ 60 characters)
- the match unpaused (override is terminal — it closes the Challenge,
  it does not move the deal forward by itself).

**What it means commercially:**
This is the rare, last-resort governance action. The platform has
recorded *why* the override happened, *who* approved it, and *which
regulator*, if any, was involved. The four fields exist precisely so
this kind of action can never be reduced to "an admin clicked a
button".

**Commercial question to answer:**
*Are the four governance fields (reason category, internal approval
reference, regulator reference, written reason) sufficient to defend
an Admin Override Closure to a regulator or auditor after the fact?*

---

## Optional — read-only member view

**Sign in as:** ordinary buyer-side member (`test2@izenzo.co.za`).

**Open:** any of the six demo matches above.

**Expect to see:**
- the Challenge Status Card;
- the comment thread (read-only);
- the evidence list (read-only);
- **no** Raise Challenge button;
- **no** comment composer;
- **no** evidence uploader.

**What it means commercially:**
Only organisation administrators and the platform can change the state
of a Challenge. Ordinary members are kept informed but cannot mutate
the record.

**Commercial question to answer:**
*Is the read-only experience for ordinary members the right balance
between transparency and control?*

---

End of walkthrough.
