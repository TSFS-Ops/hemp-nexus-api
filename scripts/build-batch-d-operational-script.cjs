const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
} = require('docx');

const FONT = "Arial";
const TABLE_WIDTH = 9360;
const GREEN = "047857";
const SLATE = "0F172A";
const MUTED = "475569";
const BORDER = "CBD5E1";
const AMBER = "92400E";
const AMBER_FILL = "FEF3C7";
const HEAD_FILL = "F1F5F9";

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text, font: FONT, size: 22, color: SLATE, ...opts })],
});
const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 280, after: 160 },
  children: [new TextRun({ text, font: FONT, size: 32, bold: true, color: SLATE })],
});
const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 240, after: 120 },
  children: [new TextRun({ text, font: FONT, size: 26, bold: true, color: SLATE })],
});
const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 180, after: 100 },
  children: [new TextRun({ text, font: FONT, size: 23, bold: true, color: SLATE })],
});
const Bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: "bullets", level },
  spacing: { after: 80 },
  children: [new TextRun({ text, font: FONT, size: 22, color: SLATE })],
});
const Labeled = (label, body) => new Paragraph({
  spacing: { after: 80 },
  children: [
    new TextRun({ text: `${label} `, font: FONT, size: 22, bold: true, color: SLATE }),
    new TextRun({ text: body, font: FONT, size: 22, color: SLATE }),
  ],
});
const Callout = (text, tone = "amber") => new Paragraph({
  spacing: { before: 120, after: 120 },
  shading: { fill: tone === "green" ? "DCFCE7" : AMBER_FILL, type: ShadingType.CLEAR },
  border: {
    top: { style: BorderStyle.SINGLE, size: 6, color: tone === "green" ? GREEN : AMBER, space: 4 },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: tone === "green" ? GREEN : AMBER, space: 4 },
    left: { style: BorderStyle.SINGLE, size: 6, color: tone === "green" ? GREEN : AMBER, space: 4 },
    right: { style: BorderStyle.SINGLE, size: 6, color: tone === "green" ? GREEN : AMBER, space: 4 },
  },
  children: [new TextRun({ text, font: FONT, size: 22, bold: true, color: tone === "green" ? "14532D" : "7C2D12" })],
});
const Note = (text) => new Paragraph({
  spacing: { before: 100, after: 100 },
  border: {
    top: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0", space: 4 },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0", space: 4 },
    left: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0", space: 4 },
    right: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0", space: 4 },
  },
  children: [new TextRun({ text, font: FONT, size: 22, color: SLATE })],
});

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: BORDER };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const Cell = (text, width, opts = {}) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  borders: cellBorders,
  margins: { top: 80, bottom: 80, left: 100, right: 100 },
  shading: opts.header ? { fill: HEAD_FILL, type: ShadingType.CLEAR } : opts.warning ? { fill: AMBER_FILL, type: ShadingType.CLEAR } : undefined,
  children: [new Paragraph({
    spacing: { after: 0 },
    children: [new TextRun({
      text,
      font: FONT,
      size: opts.small ? 17 : 18,
      bold: !!opts.header || !!opts.bold,
      color: opts.warning ? "7C2D12" : SLATE,
    })],
  })],
});
const Row = (cells, widths, opts = {}) => new TableRow({
  children: cells.map((text, i) => Cell(text, widths[i], opts)),
});
const TableBlock = (headers, rows, widths) => new Table({
  width: { size: TABLE_WIDTH, type: WidthType.DXA },
  columnWidths: widths,
  rows: [
    Row(headers, widths, { header: true }),
    ...rows.map((r) => Row(r.cells, widths, r.warning ? { warning: true, small: true } : { small: true })),
  ],
});

const platformAdminLogin = "daniel@izenzo.co.za";
const adminPage = "https://trade.izenzo.co.za/hq/engagements";
const signInPage = "https://trade.izenzo.co.za/auth";

const readinessRows = [
  { cells: ["1", "Ambiguous counterparty email held for binding review", "No", "Admin/builders must provide a verified ambiguous email first", "Not supplied", platformAdminLogin, "https://trade.izenzo.co.za/desk/new-trade, then https://trade.izenzo.co.za/hq/engagements", "NOT READY — ADMIN SETUP REQUIRED"], warning: true },
  { cells: ["2", "Binding review resolved", "No", "Admin/builders must prepare a row in Binding review required", "Not supplied", platformAdminLogin, adminPage, "NOT READY — ADMIN SETUP REQUIRED"], warning: true },
  { cells: ["3", "Disputed — being named", "No", "Admin/builders must prepare a row that can be marked disputed", "Not supplied", platformAdminLogin, adminPage, "NOT READY — ADMIN SETUP REQUIRED"], warning: true },
  { cells: ["4", "Cancelled for email change", "No", "Admin/builders must prepare a row where outreach has already begun", "Not supplied", platformAdminLogin, adminPage, "NOT READY — ADMIN SETUP REQUIRED"], warning: true },
  { cells: ["5", "Late acceptance after expiry — reconfirm", "No", "Admin/builders must prepare LAT-A first", "LAT-A not supplied", "Initiator login not supplied", "Direct match URL not supplied", "NOT READY — ADMIN SETUP REQUIRED"], warning: true },
  { cells: ["6", "Late acceptance after expiry — decline", "No", "Admin/builders must prepare LAT-B first", "LAT-B not supplied", "Initiator login not supplied", "Direct match URL not supplied", "NOT READY — ADMIN SETUP REQUIRED"], warning: true },
  { cells: ["7", "Notification wording review", "Yes", "No setup required", "Not applicable", "No login required", "This document", "READY"], warning: false },
];

const missingRows = [
  "Test 1: verified ambiguous email address that is guaranteed to produce Binding review required.",
  "Test 2: exact row name, initiating organisation, and starting status for a binding-review row Daniel can resolve.",
  "Test 3: exact row name, initiating organisation, and starting status for a row Daniel can mark as Disputed — being named.",
  "Test 4: exact row name, initiating organisation, starting status, and replacement email for a row where outreach has already begun.",
  "Test 5: LAT-A direct match URL, initiator login, current status before test, and confirmation that LAT-A is prepared for reconfirmation.",
  "Test 6: LAT-B direct match URL, initiator login, current status before test, and confirmation that LAT-B is prepared for decline.",
];

function TestBlock({ n, title, classification, readiness, purpose, account, page, row, startingStatus, action, expected, mustNot, setup }) {
  return [
    H2(`Test ${n} — ${title}`),
    Labeled("Classification:", classification),
    Labeled("Ready to test:", readiness),
    Labeled("Admin setup required before Daniel starts:", setup),
    Labeled("Purpose:", purpose),
    Labeled("Login account:", account),
    Labeled("Exact page or URL:", page),
    Labeled("Exact demo row:", row),
    Labeled("Status before Daniel starts:", startingStatus),
    Labeled("Exact button or action:", action),
    Labeled("Expected visible result:", expected),
    Labeled("What must not happen:", mustNot),
    Labeled("Pass / fail:", "[ ] PASS    [ ] FAIL    Notes: ____________________________"),
  ];
}

const c = [];

c.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 80 }, children: [new TextRun({ text: "Izenzo", font: FONT, size: 24, bold: true, color: GREEN })] }));
c.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: "Batch D — Operational Test Script", font: FONT, size: 36, bold: true, color: SLATE })] }));
c.push(Labeled("Prepared by:", "Josh"));
c.push(Labeled("Prepared for:", "Daniel Davies — Izenzo"));
c.push(Labeled("Date:", "12 May 2026"));
c.push(Labeled("Verdict:", "NOT READY TO SEND — admin setup still required."));
c.push(Callout("SAFE TO SEND? NOT READY TO SEND — admin setup still required. Do not send Daniel this testing pack until every row, login and link in the readiness table is filled in."));

c.push(H1("Before Daniel starts"));
c.push(P("Some Batch D states cannot be created naturally from the normal user interface. For those tests, the row must be prepared first. Daniel should not try to create those states himself. If the row name, login, or link is missing, the test is not ready to run."));
c.push(Bullet("Daniel must not be asked to guess an email address, create a hidden state, find an unknown row, or act as a counterparty."));
c.push(Bullet("Admin/builders must stage each B or C test row, name it clearly, confirm the starting status, and provide the exact login and link before this pack is sent."));
c.push(Bullet("Only Test 7 is ready without platform access, because it is wording review only."));

c.push(H1("Test readiness table"));
c.push(TableBlock(
  ["Test", "State being tested", "Can Daniel create it himself?", "Who prepares it", "Exact row name", "Exact login", "Exact URL/page", "Ready to test?"],
  readinessRows,
  [560, 1500, 1040, 1500, 1080, 1200, 1580, 900],
));

c.push(H1("Accounts Daniel will use"));
c.push(Bullet(`Platform admin login: ${platformAdminLogin}.`));
c.push(Bullet("Initiator login: not supplied for LAT-A or LAT-B. These tests are not ready until the initiator login is filled in."));
c.push(Bullet("Counterparty: Daniel should not act as the counterparty. There is no normal counterparty dashboard for these late-acceptance tests."));
c.push(Bullet(`Sign-in page: ${signInPage}.`));

c.push(H1("Missing setup before this pack can be sent"));
missingRows.forEach((item) => c.push(Bullet(item)));

c.push(H1("The seven tests"));

c.push(...TestBlock({
  n: 1,
  title: "Ambiguous counterparty email is held for binding review",
  classification: "B — admin/builders must first provide a verified ambiguous email. Daniel should not guess one.",
  readiness: "NOT READY — ADMIN SETUP REQUIRED.",
  setup: "Provide the exact ambiguous email address that is guaranteed to trigger Binding review required in this environment.",
  purpose: "Confirm that when the platform cannot safely tell which registered organisation the counterparty belongs to, it does not guess. The engagement is paused for binding review.",
  account: platformAdminLogin,
  page: "Start at https://trade.izenzo.co.za/desk/new-trade. After submission, use https://trade.izenzo.co.za/hq/engagements to locate the new row.",
  row: "Not supplied. Daniel creates the row only after admin/builders provide the exact ambiguous email.",
  startingStatus: "No row exists yet. The test is not ready until the ambiguous email is supplied.",
  action: "Admin must provide the ambiguous email to use before this test can be run. Once supplied, Daniel enters that exact email in the counterparty email field and submits the trade request.",
  expected: "The row appears in Engagements with Binding review required. The wording says the engagement is paused for review, not failed, rejected, broken, or completed.",
  mustNot: "The engagement must not silently link to one organisation. No email or SMS should be sent to the ambiguous email.",
}));

c.push(...TestBlock({
  n: 2,
  title: "Binding review can be resolved",
  classification: "B — admin/builders must prepare a row first, then Daniel can test it as platform admin.",
  readiness: "NOT READY — ADMIN SETUP REQUIRED.",
  setup: "Provide an exact row name, initiating organisation, and starting status of Binding review required.",
  purpose: "Confirm that the platform admin can resolve a binding review and that the row moves out of review without exposing candidate organisation details to the initiator.",
  account: platformAdminLogin,
  page: adminPage,
  row: "Not supplied.",
  startingStatus: "Binding review required.",
  action: "Open the supplied row. Click Resolve binding. In the dialog, choose the approved canonical organisation and confirm.",
  expected: "The dialog closes. The row no longer shows Binding review required. The engagement reflects the chosen organisation and can continue from the normal queue.",
  mustNot: "The initiator-side view must not show candidate organisation names, matching scores, internal matching reasons, counterparty emails, or dispute details. No candidate organisation or disputed party should be contacted.",
}));

c.push(...TestBlock({
  n: 3,
  title: "Counterparty disputes being named",
  classification: "B — admin/builders must prepare a row first, then Daniel can test it as platform admin.",
  readiness: "NOT READY — ADMIN SETUP REQUIRED.",
  setup: "Provide an exact row name, initiating organisation, and starting status for a row that can safely be marked disputed.",
  purpose: "Confirm that when a counterparty disputes being named on an engagement, the engagement is paused for platform review with neutral wording.",
  account: platformAdminLogin,
  page: adminPage,
  row: "Not supplied.",
  startingStatus: "Prepared by admin/builders; must not already be terminal unless the intended check is wording-only.",
  action: "Open the supplied row. Click Dispute. Confirm the dispute in the dialog.",
  expected: "The row status changes to Disputed — being named. The row wording is neutral and says the engagement is paused for platform review.",
  mustNot: "The disputed counterparty must not be re-contacted. No email or SMS should be sent to the disputed party. The wording must not accuse anyone of lying, guilt, breach, fraud, fault, or liability.",
}));

c.push(...TestBlock({
  n: 4,
  title: "Cancelled for email change",
  classification: "B — admin/builders must prepare a row first, then Daniel can test it as platform admin.",
  readiness: "NOT READY — ADMIN SETUP REQUIRED.",
  setup: "Provide an exact row name, initiating organisation, starting status, and replacement email for a row where outreach has already begun.",
  purpose: "Confirm that when a counterparty email is changed after outreach has started, the original engagement is cancelled for email change rather than silently overwritten.",
  account: platformAdminLogin,
  page: adminPage,
  row: "Not supplied.",
  startingStatus: "Outreach already begun, with the original email recorded on the row.",
  action: "Open the supplied row. Click Cancel for email change. Enter the admin-supplied replacement email. Click Cancel engagement.",
  expected: "The original row changes to Cancelled for email change. The wording makes clear that the engagement was cancelled because the email changed, not because the trade itself failed. If a replacement row is expected, admin/builders must identify it separately.",
  mustNot: "The original row must not be silently edited in place. The original counterparty email must not be re-contacted. No email or SMS should be sent as part of this admin action.",
}));

c.push(...TestBlock({
  n: 5,
  title: "Late acceptance after expiry — reconfirm",
  classification: "C — Daniel cannot create this state from the normal user interface. He can only review and act on a prepared screen/state.",
  readiness: "NOT READY — ADMIN SETUP REQUIRED.",
  setup: "This is not a self-created test. Admin/builders must prepare LAT-A first. Daniel’s job is only to open the prepared row and confirm what the initiator sees.",
  purpose: "Confirm that when a counterparty acceptance is recorded after the engagement has expired, the initiator sees a late-acceptance state and can choose Reconfirm and renew engagement.",
  account: "Initiator login not supplied.",
  page: "Direct match URL not supplied.",
  row: "LAT-A not supplied.",
  startingStatus: "Late acceptance — awaiting initiator reconfirmation.",
  action: "Open LAT-A using the supplied direct match URL. Find the Late acceptance card. Click Reconfirm and renew engagement. Confirm by clicking Reconfirm in the dialog.",
  expected: "A renewed engagement is created. The original late acceptance is recorded as resolved by reconfirmation. The wording must not say that the late acceptance automatically bound the deal.",
  mustNot: "Late acceptance must not auto-progress without the initiator’s reconfirmation. Decline must remain available until Reconfirm is clicked. No email or SMS should be sent to the counterparty as part of clicking Reconfirm.",
}));

c.push(...TestBlock({
  n: 6,
  title: "Late acceptance after expiry — decline",
  classification: "C — Daniel cannot create this state from the normal user interface. He can only review and act on a prepared screen/state.",
  readiness: "NOT READY — ADMIN SETUP REQUIRED.",
  setup: "This is not a self-created test. Admin/builders must prepare LAT-B first. Daniel’s job is only to open the prepared row and confirm what the initiator sees.",
  purpose: "Confirm that the initiator can decline a late acceptance, leaving the original engagement expired while retaining the audit record.",
  account: "Initiator login not supplied.",
  page: "Direct match URL not supplied.",
  row: "LAT-B not supplied.",
  startingStatus: "Late acceptance — awaiting initiator reconfirmation.",
  action: "Open LAT-B using the supplied direct match URL. Find the Late acceptance card. Click Decline late acceptance. Confirm by clicking Decline late acceptance in the dialog.",
  expected: "The late acceptance is recorded as declined. The original engagement remains expired. No renewed engagement is created.",
  mustNot: "Declining must not delete or hide the audit record of the late acceptance. The counterparty must not be contacted with a decline notice as part of this release.",
}));

c.push(...TestBlock({
  n: 7,
  title: "Notification wording — review only",
  classification: "C — wording review only.",
  readiness: "READY — no login required.",
  setup: "None.",
  purpose: "Confirm that the wording shown around the Batch D events is neutral, operational, and easy to understand.",
  account: "No login required. Daniel is reviewing the words only.",
  page: "This document only.",
  row: "Not applicable.",
  startingStatus: "Not applicable.",
  action: "Read the wording samples below and mark any wording you would like changed.",
  expected: "The wording does not imply blame, liability, wrongdoing, breach, fraud, guilt, a completed trade, or a final legal outcome.",
  mustNot: "Daniel should not need to log in to anything to complete Test 7.",
}));

c.push(H1("Wording samples for Test 7"));
c.push(P("No login required. Daniel is reviewing the words only."));
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

c.push(H1("What Daniel should not test"));
c.push(Bullet("Do not try to create late acceptance manually."));
c.push(Bullet("Do not try to act as the counterparty."));
c.push(Bullet("Do not expect a counterparty dashboard."));
c.push(Bullet("Do not expect a new counterparty email."));
c.push(Bullet("Do not test payments, POI, WaD, ratings, KYB, sanctions, or public status here."));
c.push(Bullet("Do not use real counterparty emails unless explicitly instructed."));

c.push(H1("What this pack does not cover"));
c.push(Bullet("Counterparty-facing email or SMS wording. No new counterparty-facing message is added or changed by Batch D."));
c.push(Bullet("Anything outside Batch D — Pending Engagement / Counterparty Control. Ratings, payments, sanctions screening, KYB, the Without a Doubt seal, public organisation status, and the in-app notification inbox are all out of scope here."));
c.push(Bullet("Tests that require Daniel to create an expired engagement or act as the counterparty. Where those situations matter, the row must be prepared for him first."));

c.push(H1("Final send gate"));
c.push(Callout("NOT READY TO SEND — admin setup still required. This document should not be sent to Daniel until Test 1 has a verified ambiguous email and Tests 2–6 have real row names, logins where required, and direct links."));
c.push(Labeled("Reviewer:", "Daniel Davies — Izenzo"));
c.push(Labeled("Date completed:", "____________________"));
c.push(Labeled("Overall decision:", "[ ] Accept Batch D    [ ] Accept with wording changes    [ ] Hold for further work"));

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, font: FONT, color: SLATE }, paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, font: FONT, color: SLATE }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 23, bold: true, font: FONT, color: SLATE }, paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [
    { reference: "bullets", levels: [
      { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
    ] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children: c,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = "/mnt/documents/Izenzo_Batch_D_Operational_Test_Script_v2.docx";
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, buf.length, "bytes");
});
