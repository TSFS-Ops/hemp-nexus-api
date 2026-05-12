// Operational, demo-row-based test script for Batch D.
// Honest classification per test (Class A / B / C). No invented steps.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, PageOrientation, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType,
} = require('docx');

const FONT = "Arial";
const P = (text, opts={}) => new Paragraph({ spacing:{after:120},
  children:[new TextRun({ text, font:FONT, size:22, ...opts })] });
const Bold = (t) => P(t, { bold:true });
const H1 = (t) => new Paragraph({ heading:HeadingLevel.HEADING_1, spacing:{before:280,after:160},
  children:[new TextRun({ text:t, font:FONT, size:32, bold:true })] });
const H2 = (t) => new Paragraph({ heading:HeadingLevel.HEADING_2, spacing:{before:240,after:120},
  children:[new TextRun({ text:t, font:FONT, size:26, bold:true })] });
const H3 = (t) => new Paragraph({ heading:HeadingLevel.HEADING_3, spacing:{before:180,after:100},
  children:[new TextRun({ text:t, font:FONT, size:23, bold:true })] });
const Bullet = (t,l=0) => new Paragraph({ numbering:{reference:"bullets",level:l},
  spacing:{after:80}, children:[new TextRun({text:t,font:FONT,size:22})] });
const Labeled = (label, body) => new Paragraph({ spacing:{after:80},
  children:[ new TextRun({text:label+" ",font:FONT,size:22,bold:true}),
             new TextRun({text:body,font:FONT,size:22}) ] });
const Warn = (text) => new Paragraph({ spacing:{before:120,after:120},
  border:{ top:{style:BorderStyle.SINGLE,size:6,color:"B45309",space:4},
           bottom:{style:BorderStyle.SINGLE,size:6,color:"B45309",space:4},
           left:{style:BorderStyle.SINGLE,size:6,color:"B45309",space:4},
           right:{style:BorderStyle.SINGLE,size:6,color:"B45309",space:4} },
  children:[new TextRun({text,font:FONT,size:22,bold:true,color:"7C2D12"})] });
const Note = (text) => new Paragraph({ spacing:{before:100,after:100},
  border:{ top:{style:BorderStyle.SINGLE,size:4,color:"E2E8F0",space:4},
           bottom:{style:BorderStyle.SINGLE,size:4,color:"E2E8F0",space:4},
           left:{style:BorderStyle.SINGLE,size:4,color:"E2E8F0",space:4},
           right:{style:BorderStyle.SINGLE,size:4,color:"E2E8F0",space:4} },
  children:[new TextRun({text,font:FONT,size:22})] });

// One test block — 11 fields exactly as Daniel asked.
function TestBlock({n, title, classLabel, purpose, who, account, page, row, action,
                    expected, nextAccount, mustNot}) {
  return [
    H2(`Test ${n} — ${title}`),
    Labeled("Class:", classLabel),
    Labeled("Purpose:", purpose),
    Labeled("Who starts the test:", who),
    Labeled("Login account:", account),
    Labeled("Exact page:", page),
    Labeled("Exact demo row:", row),
    Labeled("Exact button or action:", action),
    Labeled("Expected result:", expected),
    Labeled("Next account, if the test changes roles:", nextAccount),
    Labeled("What must not happen:", mustNot),
    Labeled("Pass / fail:", "[ ] PASS    [ ] FAIL    Notes: ____________________________"),
  ];
}

const c = [];

// ---------- Cover ----------
c.push(new Paragraph({ alignment:AlignmentType.LEFT, spacing:{after:80},
  children:[new TextRun({text:"Izenzo",font:FONT,size:24,bold:true,color:"047857"})] }));
c.push(new Paragraph({ spacing:{after:240},
  children:[new TextRun({text:"Batch D — Operational Test Script",font:FONT,size:36,bold:true})] }));
c.push(Labeled("Prepared by:", "Josh"));
c.push(Labeled("Prepared for:", "Daniel Davies — Izenzo"));
c.push(Labeled("Date:", "12 May 2026"));
c.push(Labeled("Status:", "This replaces the prior Batch D testing guide. It is written as step-by-step actions, not as workflow descriptions."));

// ---------- How to read this pack ----------
c.push(H1("How to read this pack"));
c.push(P("Each test below has the same eleven fields. Read them in order. If a field says \"Admin must prepare this row first\", do not try to create the state yourself — the row will be provided to you by name."));
c.push(Bullet("Class A: you can run this test from the user interface yourself, end to end."));
c.push(Bullet("Class B: a row must be prepared for you in advance. The exact row name is filled in by the platform admin before the pack is sent."));
c.push(Bullet("Class C: this test cannot be run cleanly from the user interface. You are being asked only to review the wording or the resulting screen on a row that is set up for you, not to create the state."));

c.push(Warn("Safety: none of the actions in this pack should send any new email or SMS to a counterparty, candidate organisation, or disputed party. If any test produces such a message, stop and flag it immediately."));

// ---------- Accounts you will use ----------
c.push(H1("Accounts you will use"));
c.push(P("Three roles can appear in this pack. Two of them are real logins. The third is not a person who logs in — it is whatever address the system was asked to contact."));
c.push(Bullet("Platform admin login: this is your existing administrator account. You used it for the earlier Batch D admin-controls review (the @d2a.test.invalid / @d2b.test.invalid rows)."));
c.push(Bullet("Initiator login: this is an organisation administrator account on the test organisation that originated the engagement. The exact email address is filled in by the platform admin in the row table below before this pack is sent to you."));
c.push(Bullet("Counterparty: there is no counterparty user interface on the platform at this time. Where a test refers to \"the counterparty side\", that action is performed by the platform on a fixture row, not by you clicking a button. This is called out in each test that needs it."));

c.push(H2("Demo rows table — to be completed by platform admin before sending"));
c.push(Note("Platform admin: please fill in the row name, organisation, and (where applicable) initiator login for each test below before this pack is sent to Daniel. The placeholders are intentional — do not send this pack until the table is complete."));
c.push(Bullet("Test 1 — Ambiguous counterparty: row to use = (any new draft you create yourself; no pre-seeding required)."));
c.push(Bullet("Test 2 — Binding review resolved: row name = ____________ ; initiating organisation = ____________ ; initiator login = ____________"));
c.push(Bullet("Test 3 — Disputed — being named: row name = ____________ ; initiating organisation = ____________"));
c.push(Bullet("Test 4 — Cancelled for email change: row name = ____________ ; initiating organisation = ____________"));
c.push(Bullet("Test 5 — Late acceptance after expiry, reconfirm: row name = LAT-A (admin-prepared) ; initiator login = ____________"));
c.push(Bullet("Test 6 — Late acceptance after expiry, decline: row name = LAT-B (admin-prepared) ; initiator login = ____________"));
c.push(Bullet("Test 7 — Notification wording: not a row-based test. See the wording samples in Test 7."));

// ---------- The seven tests ----------
c.push(H1("The seven tests"));

c.push(...TestBlock({
  n:1, title:"Ambiguous counterparty email is paused for binding review",
  classLabel:"A — you can run this from the user interface yourself.",
  purpose:"Confirm that when a counterparty email could belong to more than one registered organisation, the platform does not guess. The engagement is paused and held for binding review.",
  who:"Platform admin (you).",
  account:"Your platform admin login.",
  page:"Open Desk → New Trade Request. Fill in the basic trade fields as you would normally.",
  row:"No pre-seeded row needed. You will create a fresh draft and use it as your row.",
  action:"In the counterparty email field, enter a shared mailbox such as info@example-trading.test or sales@example-trading.test. Save and submit the engagement. Then sign out, sign back in as platform admin, open HQ → Engagements (Pending Engagement queue), and locate your draft.",
  expected:"The engagement is shown with status \"Binding review required\". The wording on the row should make clear that the engagement is paused for review, not failed, broken, or rejected. No outreach is sent to the ambiguous email.",
  nextAccount:"None. You stay signed in as platform admin for Test 2.",
  mustNot:"The engagement must not be silently linked to a single organisation. No email or SMS should leave the platform.",
}));

c.push(...TestBlock({
  n:2, title:"Binding review can be resolved",
  classLabel:"B — uses a row prepared in advance, or the row you produced in Test 1.",
  purpose:"Confirm that the platform admin can resolve a binding review and that the engagement state updates accordingly, without exposing internal matching detail to the initiator.",
  who:"Platform admin (you).",
  account:"Your platform admin login.",
  page:"HQ → Engagements (Pending Engagement queue).",
  row:"Either the row you produced in Test 1, or the admin-prepared row noted in the table above.",
  action:"Open the row. Click \"Resolve binding review\". In the dialog, choose \"Confirm a canonical organisation\" and pick one of the candidate organisations offered. Confirm the action.",
  expected:"The dialog closes. The row no longer shows \"Binding review required\". The engagement now reflects the chosen organisation. The initiating organisation receives a neutral \"engagement state updated\" notice in their administrator inbox area on next sign-in (no email is sent for this step).",
  nextAccount:"Optional: sign in as the initiator login from the row table to confirm the in-product state matches what the admin sees. Not required for the test to pass.",
  mustNot:"The initiator-side view must not show candidate organisation names, matching scores, or any technical reason text. The disputed organisation must not be contacted.",
}));

c.push(...TestBlock({
  n:3, title:"Counterparty disputes being named",
  classLabel:"B — uses an admin-prepared row.",
  purpose:"Confirm that when a counterparty disputes being named on an engagement, the engagement is paused for platform review with neutral wording.",
  who:"Platform admin (you).",
  account:"Your platform admin login.",
  page:"HQ → Engagements (Pending Engagement queue).",
  row:"The Test 3 row from the table above.",
  action:"Open the row. Click the \"Mark as disputed — being named\" action. Confirm.",
  expected:"The row status changes to \"Disputed — being named\". The wording on the row and on the related notice is neutral: it does not say or imply that any party is lying, guilty, in breach, fraudulent, or at fault. The engagement does not progress.",
  nextAccount:"None.",
  mustNot:"The disputed counterparty must not be re-contacted. No email or SMS should be sent to the disputed party. The wording must not contain accusatory language.",
}));

c.push(...TestBlock({
  n:4, title:"Cancelled for email change",
  classLabel:"B — uses an admin-prepared row.",
  purpose:"Confirm that when a counterparty email is changed after outreach has started, the original engagement is cancelled for email change rather than silently overwritten.",
  who:"Platform admin (you).",
  account:"Your platform admin login.",
  page:"HQ → Engagements (Pending Engagement queue).",
  row:"The Test 4 row from the table above (this row already has a recorded outreach attempt).",
  action:"Open the row. Click \"Cancel — counterparty email change\". Provide a replacement email when prompted, then confirm.",
  expected:"The original row moves to \"Cancelled — email change\". A new engagement row is created against the replacement email. The wording on the cancelled row makes clear the engagement was cancelled because the email changed, not because the trade itself failed.",
  nextAccount:"None.",
  mustNot:"The original row must not be silently edited in place. The original counterparty email must not be re-contacted. No email or SMS should be sent as part of this admin action.",
}));

c.push(...TestBlock({
  n:5, title:"Late acceptance after expiry — reconfirm",
  classLabel:"C — review-only. The state is created for you in advance because there is no counterparty user interface to perform a late acceptance from.",
  purpose:"Confirm that when a counterparty acceptance is recorded after the engagement has expired, the initiator sees a \"Late acceptance — reconfirmation required\" state with Reconfirm and Decline as the only two actions, and that Reconfirm produces a renewed engagement.",
  who:"Initiator (an org admin on the initiating organisation). The platform admin will hand the row over to you in a state where late acceptance has already been recorded.",
  account:"Initiator login from the table above (row LAT-A).",
  page:"Open the engagement at /match/<row LAT-A id> (the platform admin will provide the direct link).",
  row:"LAT-A — admin-prepared.",
  action:"On the engagement page, locate the \"Late acceptance — reconfirmation required\" card. Click \"Reconfirm and create a renewed engagement\". Confirm in the dialog.",
  expected:"The card closes. A renewed engagement is created. The original row is shown as resolved via reconfirmation. Wording must not claim the late acceptance has bound the deal — only that the initiator has reconfirmed.",
  nextAccount:"Sign back in as platform admin to spot-check that the renewed engagement is visible in the Pending Engagement queue with a \"Reconfirmed\" provenance line.",
  mustNot:"Late acceptance must not auto-progress without the initiator's reconfirmation. Decline must remain available right up until Reconfirm is clicked. No email or SMS should be sent to the counterparty as part of clicking Reconfirm.",
}));

c.push(...TestBlock({
  n:6, title:"Late acceptance after expiry — decline",
  classLabel:"C — review-only. Same reason as Test 5.",
  purpose:"Confirm that the initiator can decline a late acceptance, that the original engagement remains expired, and that the late acceptance is recorded but not honoured.",
  who:"Initiator.",
  account:"Initiator login from the table above (row LAT-B).",
  page:"Open the engagement at /match/<row LAT-B id> (link provided by platform admin).",
  row:"LAT-B — admin-prepared.",
  action:"On the engagement page, locate the \"Late acceptance — reconfirmation required\" card. Click \"Decline late acceptance\". Confirm in the dialog.",
  expected:"The card closes. The row records that the late acceptance was declined. The original engagement remains in its expired state. No renewed engagement is created.",
  nextAccount:"None.",
  mustNot:"Declining must not delete or hide the audit record of the late acceptance. The counterparty must not be contacted with a decline notice as part of this release.",
}));

c.push(...TestBlock({
  n:7, title:"Notification wording — review only",
  classLabel:"C — wording review. There are no buttons to click. Read the samples below and mark any wording you would like changed.",
  purpose:"Confirm that the wording shown to administrators and initiators around the five Batch D events is neutral, operational, and easy to understand. The wording must not sound legalistic, accusatory, dramatic, or final.",
  who:"You — read the samples.",
  account:"No login required for this test.",
  page:"This pack only. No platform action is required.",
  row:"Not applicable.",
  action:"Read the wording samples in the next section and mark any line you would like reworded.",
  expected:"You are comfortable that none of the wording implies blame, liability, wrongdoing, breach, fraud, guilt, or a completed trade.",
  nextAccount:"None.",
  mustNot:"You should not need to log in to anything to complete this test.",
}));

// ---------- Wording samples for Test 7 ----------
c.push(H2("Wording samples for Test 7"));
c.push(P("These are the lines the platform shows to administrators and initiators in the five Batch D situations. Mark any line you would like reworded."));

c.push(H3("Binding review required"));
c.push(Note("Engagement paused for review. We could not safely tell which registered organisation this counterparty belongs to. A platform administrator will review and confirm before this engagement progresses."));

c.push(H3("Binding review resolved"));
c.push(Note("The engagement state has been updated by the platform. You can continue from your usual queue."));

c.push(H3("Disputed — being named"));
c.push(Note("Engagement paused for platform review. The counterparty has indicated they may not be the correct party for this engagement. A platform administrator is reviewing."));

c.push(H3("Cancelled for email change"));
c.push(Note("Original engagement cancelled because the counterparty email changed after outreach had started. A new engagement has been created against the replacement email. No further action is required on the cancelled row."));

c.push(H3("Late acceptance pending initiator reconfirmation"));
c.push(Note("This engagement was accepted after its expiry point. It will not proceed automatically. Please reconfirm to create a renewed engagement, or decline to leave the original engagement expired."));

// ---------- What this pack does not cover ----------
c.push(H1("What this pack does not cover"));
c.push(Bullet("Counterparty-facing email or SMS wording. No new counterparty-facing message is added or changed by Batch D."));
c.push(Bullet("Anything outside Batch D — Pending Engagement / Counterparty Control. Ratings, payments, sanctions screening, KYB, the Without a Doubt seal, public organisation status, and the in-app notification inbox are all out of scope here."));
c.push(Bullet("Tests that would require you to create an expired engagement or to act as the counterparty user. Where those situations matter, the row is prepared for you and you are asked only to review the resulting state, as set out in Tests 5 and 6."));

// ---------- Sign-off ----------
c.push(H1("Sign-off"));
c.push(P("Please tick PASS or FAIL on each test above and reply with any wording you would like changed in Test 7. Once all seven tests are marked, Batch D can be treated as accepted."));
c.push(Labeled("Reviewer:", "Daniel Davies — Izenzo"));
c.push(Labeled("Date completed:", "____________________"));
c.push(Labeled("Overall decision:", "[ ] Accept Batch D    [ ] Accept with wording changes    [ ] Hold for further work"));

// ---------- Build ----------
const doc = new Document({
  styles:{ default:{ document:{ run:{ font:FONT, size:22 } } } },
  numbering:{ config:[
    { reference:"bullets",
      levels:[
        { level:0, format:LevelFormat.BULLET, text:"•", alignment:AlignmentType.LEFT,
          style:{paragraph:{indent:{left:720,hanging:360}}} },
        { level:1, format:LevelFormat.BULLET, text:"◦", alignment:AlignmentType.LEFT,
          style:{paragraph:{indent:{left:1440,hanging:360}}} },
      ] },
  ]},
  sections:[{
    properties:{ page:{ size:{width:12240,height:15840},
      margin:{top:1440,right:1440,bottom:1440,left:1440} } },
    children: c,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = "/mnt/documents/Izenzo_Batch_D_Operational_Test_Script_v1.docx";
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, buf.length, "bytes");
});
