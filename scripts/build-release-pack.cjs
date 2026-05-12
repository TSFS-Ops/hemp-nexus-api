const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, PageOrientation, BorderStyle,
} = require('docx');

const FONT = "Arial";

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text, font: FONT, size: 22, ...opts })],
});

const Bold = (text) => P(text, { bold: true });

const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 280, after: 160 },
  children: [new TextRun({ text, font: FONT, size: 32, bold: true })],
});

const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 240, after: 120 },
  children: [new TextRun({ text, font: FONT, size: 26, bold: true })],
});

const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 180, after: 100 },
  children: [new TextRun({ text, font: FONT, size: 23, bold: true })],
});

const Bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: "bullets", level },
  spacing: { after: 80 },
  children: [new TextRun({ text, font: FONT, size: 22 })],
});

const Num = (text) => new Paragraph({
  numbering: { reference: "numbers", level: 0 },
  spacing: { after: 80 },
  children: [new TextRun({ text, font: FONT, size: 22 })],
});

const Labeled = (label, body) => new Paragraph({
  spacing: { after: 80 },
  children: [
    new TextRun({ text: label + " ", font: FONT, size: 22, bold: true }),
    new TextRun({ text: body, font: FONT, size: 22 }),
  ],
});

const Warn = (text) => new Paragraph({
  spacing: { before: 120, after: 120 },
  border: {
    top: { style: BorderStyle.SINGLE, size: 6, color: "B45309", space: 4 },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: "B45309", space: 4 },
    left: { style: BorderStyle.SINGLE, size: 6, color: "B45309", space: 4 },
    right: { style: BorderStyle.SINGLE, size: 6, color: "B45309", space: 4 },
  },
  children: [new TextRun({ text, font: FONT, size: 22, bold: true, color: "7C2D12" })],
});

const Spacer = () => new Paragraph({ children: [new TextRun({ text: "" })] });

// ---------- Test block helper ----------
const Test = (title, where, action, expected, problemIf) => [
  H3(title),
  Labeled("Where:", where),
  Labeled("What to do:", action),
  Labeled("Expected result:", expected),
  Labeled("Problem if:", problemIf),
];

const children = [];

// ===== Cover =====
children.push(
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 80 },
    children: [new TextRun({ text: "Izenzo", font: FONT, size: 24, bold: true, color: "047857" })],
  }),
  new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: "Batch D, E, F, K, L, M — Client Acceptance Pack", font: FONT, size: 36, bold: true })],
  }),
  Labeled("Prepared by:", "Josh"),
  Labeled("Prepared for:", "Daniel, James, and David — Izenzo"),
  Labeled("Date:", "12 May 2026"),
  Labeled("Status:", "Awaiting client acceptance. No further build batches will start until this pack is signed off."),
);

// ===== Safe to test =====
const SAFE_TO_TEST_INDEX = children.length; // splice point for version/diff section
children.push(H2("Safe to test"));
children.push(P(
  "Every test in this pack is designed to be safe to run on the live platform. None of the actions you are asked to perform should send any new email or SMS to a counterparty, candidate organisation, disputed party, or any third party."
));
children.push(Warn(
  "If you trigger any test in this pack and a counterparty, candidate organisation, or disputed party receives an email or SMS as a result, treat that as a failure and stop. That is a problem we need to know about immediately."
));

// ===== Overview =====
children.push(H2("What this pack covers"));
children.push(P(
  "This release groups together six small, self-contained improvements (Batches D, E, F, K, L and M) that together harden the administrator-side view of outreach blocks and tighten what data is exposed in supporting screens. None of these changes alter how trades, Proofs of Intent, Without a Doubt seals, payments, credits, KYB, sanctions, ratings, or counterparty messaging behave."
));
children.push(P(
  "Each batch is described below in business terms, followed by why it matters, how it maps to the signed Workflow Decision Form, and how to test it."
));

// ===== What this does NOT do =====
children.push(H2("What this release does not do"));
[
  "No new counterparty-facing email is added or sent.",
  "No notification is sent to candidate organisations.",
  "No notification is sent to disputed parties.",
  "No changes to Proof of Intent, Without a Doubt, payments, credits, or invoicing.",
  "No changes to KYB, sanctions screening, ratings, or any public organisation status.",
  "No in-app notification inbox is introduced.",
  "No change to counterparty-facing screens. The only data-exposure change is the safe-field tightening described under Batch E.",
].forEach(t => children.push(Bullet(t)));

// ===== Batch summaries =====
children.push(H1("What changed, batch by batch"));

children.push(H2("Batch D — Pending Engagement notifications and safety logic"));
children.push(Labeled("What it does:", "Consolidates the Pending Engagement event catalogue down to a single approved set, wires the administrator and initiator notification paths for those events, and applies defensive recipient rules and neutral wording across them."));
children.push(Labeled("Why it matters:", "It guarantees that Pending Engagement notifications only ever go to the intended recipients (administrators and the initiator of the engagement), with wording that cannot be misread as a counterparty-facing message."));
children.push(Labeled("Workflow Decision Form mapping:", "Implements the recipient-rule and wording-discipline expectations recorded in the signed form. No counterparty, candidate-organisation, or disputed-party email path is added."));
children.push(Labeled("Notification safety:", "Notifications are limited to administrators and the initiator. No counterparty, candidate organisation, or disputed party is messaged by this path."));

children.push(H2("Batch E — Outreach-blocked audit, in-product visibility, and server response hardening"));
children.push(Labeled("What it does:", "Introduces a canonical set of outreach-blocked audit rows, adds the in-product banner and administrator visibility for those events, and tightens the Pending Engagement server response so only an explicit list of safe fields is returned."));
children.push(Labeled("Why it matters:", "It gives administrators a reliable, named record of why outreach did not happen, surfaces that signal in-product, and removes the risk that a sensitive field (counterparty email, dispute reason, binding candidates, commercial terms) is returned to a screen just because it sits on the underlying record."));
children.push(Labeled("Workflow Decision Form mapping:", "Supports the operational visibility and data-minimisation posture in the signed form. No counterparty-facing email path is added."));
children.push(Labeled("Notification safety:", "Audit-only events plus a server-side response trim. No email, SMS, in-app notification, or admin dispatcher message is sent."));

children.push(H2("Batch F — Production hardening, coverage, and proof consolidation"));
children.push(Labeled("What it does:", "Classifies event coverage, captures live proof of the response-hardening from Batch E, and removes temporary test runners that should not exist in production."));
children.push(Labeled("Why it matters:", "It locks in the prior batches with verifiable evidence and removes scaffolding that could otherwise be mistaken for live behaviour."));
children.push(Labeled("Workflow Decision Form mapping:", "Internal hardening only. No customer-facing behaviour change."));
children.push(Labeled("Notification safety:", "No messaging changes."));

children.push(H2("Batch K — Outreach Blocks admin panel and CSV export"));
children.push(Labeled("What it does:", "Adds a dedicated administrator panel that lists outreach-blocked events with filters (by reason, by surface, by time window) and a CSV export with a fixed set of seven safe columns."));
children.push(Labeled("Why it matters:", "Gives administrators a single place to see and export the operational record introduced in Batch E."));
children.push(Labeled("Workflow Decision Form mapping:", "Administrator visibility only. Does not change any counterparty-facing flow."));
children.push(Labeled("Notification safety:", "Read-only panel. Loading or exporting from this panel does not send any message of any kind."));

children.push(H3("CSV export — exact columns"));
[
  "Created At",
  "Reason",
  "Action",
  "Organisation Name",
  "Organisation ID",
  "Engagement ID",
  "Surface",
].forEach(t => children.push(Bullet(t)));
children.push(P("The CSV always reflects the filters that are currently applied on screen."));

children.push(H3("Fields that the panel and CSV deliberately do not include"));
[
  "Counterparty email",
  "Counterparty name",
  "Dispute reason",
  "Candidate organisations",
  "Binding candidates",
  "Commercial terms",
  "Price",
  "Quantity",
  "Administrator notes",
  "Support notes",
].forEach(t => children.push(Bullet(t)));

children.push(H2("Batch L — Export clarity"));
children.push(Labeled("What it does:", "Adds explainer text on the panel describing what the CSV export contains, a clear empty-state message when no events match, and a visible 500-row cap warning above the export button when the on-screen list reaches that ceiling."));
children.push(Labeled("Why it matters:", "Removes the risk that an administrator exports a partial list, or misreads an empty result, without realising it."));
children.push(Labeled("Workflow Decision Form mapping:", "Administrator usability. No counterparty-facing change."));
children.push(Labeled("Notification safety:", "No messaging changes."));

children.push(H2("Batch M — Precise total count, last-refreshed time, and optional auto-refresh"));
children.push(Labeled("What it does:", "Shows the precise total number of matching outreach-blocked events for the current filters (so the warning can distinguish 'exactly at the ceiling' from 'more than the ceiling'), shows when the panel was last refreshed, and offers an opt-in 30-second auto-refresh toggle."));
children.push(Labeled("Why it matters:", "Administrators can see at a glance whether they are looking at the full set, how fresh the data is, and whether the panel is keeping itself up to date."));
children.push(Labeled("Workflow Decision Form mapping:", "Administrator usability. No counterparty-facing change."));
children.push(Labeled("Notification safety:", "Read-only. Refreshing the panel — manually or automatically — does not send any message."));

// ===== How to test =====
children.push(H1("How to test"));
children.push(P("These tests are written for Daniel, James, and David. They are intended to be run by a platform administrator. Please follow each test in order and note anything that does not match the expected result."));

children.push(...Test(
  "Test 1 — Open the Outreach Blocks panel",
  "Administrator area of the platform.",
  "Sign in as an administrator, navigate to the administrator area, and open the panel labelled Outreach Blocks. Confirm the panel loads and shows either a list of outreach-blocked events or an empty-state message for the selected window.",
  "The panel renders, the list (or empty state) is visible, and a 'Last refreshed' line appears near the controls.",
  "The panel fails to load, shows a generic error, or exposes any field that looks like a counterparty email, dispute reason, commercial term, price, quantity, or administrator/support note. No email or SMS should be triggered by opening this panel."
));

children.push(...Test(
  "Test 2 — Apply filters",
  "Inside the Outreach Blocks panel.",
  "Change the Reason, Surface, and Time Window filters, one at a time. After each change, observe the list and the 'Last refreshed' line.",
  "The list updates to match the chosen filters. The total count near the controls reflects the new filter set. The panel does not show stale data.",
  "Filters appear to be ignored, or the count does not match the visible list. No email or SMS should be triggered by changing filters."
));

children.push(...Test(
  "Test 3 — Empty state",
  "Inside the Outreach Blocks panel.",
  "Choose a filter combination that you expect to return zero results (for example a very narrow time window).",
  "A clear empty-state message is shown. No misleading row is rendered. The CSV export is either disabled or, if used, returns headers only.",
  "An empty filter set still shows rows from outside the filter, or the empty state is missing or confusing."
));

children.push(...Test(
  "Test 4 — Large-export warning",
  "Inside the Outreach Blocks panel.",
  "Apply a filter combination that you expect to produce a large result. If the on-screen list reaches the export ceiling, observe the warning above the export button.",
  "A clearly worded warning appears, telling you that the export will only contain what is currently visible and suggesting you tighten filters. Where the precise total is known, the warning distinguishes 'exactly at the ceiling' from 'more than the ceiling'.",
  "No warning is shown when the list is at the ceiling, or the warning is confusing or implies the export is complete when it is not."
));

children.push(...Test(
  "Test 5 — CSV export",
  "Inside the Outreach Blocks panel.",
  "Apply any filter set and click Export CSV. Open the downloaded file in a spreadsheet application.",
  "The file contains exactly these columns, in this order: Created At, Reason, Action, Organisation Name, Organisation ID, Engagement ID, Surface. The rows match what is currently visible on screen, including the active filters.",
  "The CSV contains any of: counterparty email, counterparty name, dispute reason, candidate organisations, binding candidates, commercial terms, price, quantity, administrator notes, or support notes. The CSV ignores the active filters. No email or SMS should be triggered by exporting."
));

children.push(...Test(
  "Test 6 — Last refreshed and auto-refresh",
  "Inside the Outreach Blocks panel.",
  "Note the 'Last refreshed' time. Wait one minute and confirm the wording updates (for example from 'just now' to 'a minute ago'). Then enable the 'Auto-refresh' toggle and wait long enough for one cycle.",
  "The 'Last refreshed' text updates without you doing anything. With auto-refresh enabled, the panel quietly refreshes on its own and the 'Last refreshed' time resets. With auto-refresh disabled, nothing refreshes until you click Refresh.",
  "Auto-refresh appears to send any kind of message, or the 'Last refreshed' indicator never updates. No email or SMS should be triggered by refreshing."
));

children.push(...Test(
  "Test 7 — Notification safety check",
  "Across all of the above tests.",
  "Keep an eye on the test inbox(es) and any test SMS endpoint you normally use during acceptance. None of the actions in tests 1 to 6 should produce a counterparty-facing message.",
  "No new email or SMS arrives at any counterparty, candidate organisation, or disputed party as a result of these tests.",
  "Any email or SMS arrives at a counterparty, candidate organisation, or disputed party. This is a stop-the-line problem — please flag it immediately."
));

// ===== Mapping to signed form =====
children.push(H1("How this maps to the signed Client Workflow Decision Form"));
children.push(P(
  "The signed Workflow Decision Form sets out which counterparty-facing communications and operational signals are in scope, and which are deferred. This release is deliberately scoped to administrator visibility and data-minimisation only. It does not enact any decision area that requires new counterparty wording or new recipient rules."
));
children.push(Bullet("Pending Engagement notification recipient rules and wording discipline: enacted (Batch D)."));
children.push(Bullet("Outreach-blocked audit, in-product visibility, and safe-field server response: enacted (Batch E)."));
children.push(Bullet("Production hardening, coverage classification, and proof consolidation: enacted (Batch F)."));
children.push(Bullet("Administrator panel, filters, CSV export, export clarity, precise count, and last-refreshed indicator: enacted (Batches K, L, M)."));
children.push(P(
  "Where the form references decisions about late-acceptance counterparty confirmations, minimal withdrawal notices to a previous counterparty, candidate-organisation notifications, or any other counterparty-facing email path, those remain deferred. They are listed in the next section."
));

// ===== Deferred =====
children.push(H1("Deferred items — still awaiting your approval"));
children.push(Bullet("Late-acceptance counterparty-facing confirmation email: not wired. Wording and recipient rules still require sign-off."));
children.push(Bullet("Minimal withdrawal notice to the previous counterparty: not wired. Wording and recipient rules still require sign-off."));
children.push(Bullet("Any other counterparty-facing email path: out of scope until wording and recipient rules are signed off."));
children.push(Bullet("Candidate-organisation notification path: out of scope."));
children.push(Bullet("Disputed-party notification path: out of scope."));
children.push(Bullet("In-app notification inbox: out of scope for this release."));
children.push(P(
  "Decision codes from the signed form (for example references such as the late-acceptance and withdrawal-notice items) are intentionally described by topic above so there is no ambiguity if the code numbering is updated. If you would prefer this pack to cite the exact code numbers from your latest signed copy, please share it and we will reissue with the codes inline."
));

// ===== Evidence =====
children.push(H1("Evidence and regression"));
children.push(P(
  "The full automated regression suite for this area was run before issuing this pack and passed. The suite covers the changes in this release as well as adjacent areas that share code paths, which is why some related work outside Batches D, E, F, K, L and M is exercised by the same tests. Nothing outside this release is being claimed as a deliverable here."
));
children.push(Bullet("Regression scope: the outreach-blocks audit, panel, filters, count, warning, CSV export, and the Pending Engagement safe-field response."));
children.push(Bullet("Result: all tests passed."));
children.push(Bullet("Manual verification: CSV columns confirmed against the codebase to be exactly Created At, Reason, Action, Organisation Name, Organisation ID, Engagement ID, Surface."));

// ===== What counts as a problem =====
children.push(H1("What counts as a problem"));
children.push(Bullet("Any counterparty, candidate organisation, or disputed party receives an email or SMS as a result of any test in this pack."));
children.push(Bullet("The Outreach Blocks panel or its CSV export shows any field listed under 'Fields that the panel and CSV deliberately do not include'."));
children.push(Bullet("The CSV export ignores the filters that are currently applied on screen."));
children.push(Bullet("The large-export warning fails to appear when the on-screen list is at the export ceiling."));
children.push(Bullet("The Pending Engagement screens expose a field that is not on the explicit safe-field list."));
children.push(Bullet("Auto-refresh, manual refresh, or filter changes appear to send any message."));

// ===== Sign-off =====
children.push(H1("Sign-off requested"));
children.push(P(
  "Please walk through tests 1 to 7 and let us know whether this release is accepted. No further build batches will be started until acceptance is received. If anything in this pack is unclear, or if you would like the deferred items prioritised, please reply with the specific item and we will scope it against the signed Workflow Decision Form."
));

// ----- Build helpers -----
const { execFileSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const DOCX_OPTS = {
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        ] },
      { reference: "numbers",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
};
const SECTION_PROPS = {
  page: { size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
};

function buildDoc(allChildren) {
  return new Document({
    ...DOCX_OPTS,
    sections: [{ properties: SECTION_PROPS, children: allChildren }],
  });
}

// Anchors used to slice the rendered plain text into per-section bodies.
// Order is presentation order in the document.
const SECTION_ANCHORS = [
  "Safe to test",
  "What this release covers",
  "What this release does not do",
  "Batch D — Pending Engagement notifications and safety logic",
  "Batch E — Outreach-blocked audit, in-product visibility, and server response hardening",
  "Batch F — Production hardening, coverage, and proof consolidation",
  "Batch K — Outreach Blocks admin panel and CSV export",
  "Batch L — Export clarity",
  "Batch M — Precise total count and last-refreshed indicator",
  "Tests",
  "How this maps to the signed Workflow Decision Form",
  "Verification evidence",
  "What counts as a problem",
  "Sign-off requested",
];
// Anchors whose mapping is contractually load-bearing — flagged separately.
const DE_ANCHORS = [
  "Batch D — Pending Engagement notifications and safety logic",
  "Batch E — Outreach-blocked audit, in-product visibility, and server response hardening",
];

function extractSections(flatText) {
  const map = {};
  const present = SECTION_ANCHORS.map(a => ({ a, idx: flatText.indexOf(a) }))
    .filter(x => x.idx !== -1)
    .sort((x, y) => x.idx - y.idx);
  for (let i = 0; i < present.length; i++) {
    const start = present[i].idx + present[i].a.length;
    const end = i + 1 < present.length ? present[i + 1].idx : flatText.length;
    map[present[i].a] = flatText.slice(start, end).trim();
  }
  for (const a of SECTION_ANCHORS) if (!(a in map)) map[a] = null;
  return map;
}
const sha1 = (s) => crypto.createHash('sha1').update(s || '').digest('hex').slice(0, 10);

function diffSections(prev, curr) {
  const changes = { added: [], removed: [], changed: [], unchanged: 0,
                    deMappingPreserved: true, deNotes: [] };
  for (const a of SECTION_ANCHORS) {
    const p = prev ? prev[a] : null;
    const c = curr[a];
    if (p == null && c != null) changes.added.push(a);
    else if (p != null && c == null) changes.removed.push(a);
    else if (p != null && c != null) {
      if (sha1(p) !== sha1(c)) {
        changes.changed.push({
          anchor: a, prevHash: sha1(p), currHash: sha1(c),
          delta: c.length - p.length,
        });
      } else changes.unchanged++;
    }
  }
  for (const a of DE_ANCHORS) {
    if (curr[a] == null) {
      changes.deMappingPreserved = false;
      changes.deNotes.push(`Anchor missing in current build: "${a}"`);
    }
    if (prev && prev[a] == null && curr[a] != null) {
      changes.deNotes.push(`Anchor restored in this version: "${a}"`);
    }
  }
  return changes;
}

function buildVersionBlock(version, prevVersion, builtAt, diff) {
  const out = [];
  out.push(H1("What changed in this version"));
  out.push(Labeled("Version:", `v${version}` + (prevVersion ? ` (previous: v${prevVersion})` : " (initial versioned release)")));
  out.push(Labeled("Built at:", builtAt));
  out.push(Labeled("Batch D / Batch E mapping:",
    diff.deMappingPreserved
      ? "Preserved. D = Pending Engagement notifications and safety logic. E = Outreach-blocked audit, in-product visibility, and server response hardening."
      : "WARNING — anchor not found. See notes below."));
  if (diff.deNotes.length) {
    for (const n of diff.deNotes) out.push(Bullet(n));
  }
  if (!prevVersion) {
    out.push(P("This is the first versioned build, so there is no prior version to compare against. Subsequent builds will list per-section changes here."));
    return out;
  }
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  if (total === 0) {
    out.push(P(`No content changes detected against v${prevVersion}. ${diff.unchanged} sections unchanged.`));
    return out;
  }
  out.push(P(`Summary: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed, ${diff.unchanged} unchanged (compared to v${prevVersion}).`));
  if (diff.added.length) {
    out.push(H3("Added sections"));
    for (const a of diff.added) out.push(Bullet(a));
  }
  if (diff.removed.length) {
    out.push(H3("Removed sections"));
    for (const a of diff.removed) out.push(Bullet(a));
  }
  if (diff.changed.length) {
    out.push(H3("Changed sections"));
    for (const c of diff.changed) {
      const sign = c.delta > 0 ? `+${c.delta}` : `${c.delta}`;
      out.push(Bullet(`${c.anchor} (${sign} chars; ${c.prevHash} → ${c.currHash})`));
    }
  }
  return out;
}

// ----- Pass 1: render preview to extract per-section text -----
const TMP_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'releasepack-'));
const previewPath = path.join(TMP_DIR, 'preview.docx');
const previewTxt  = path.join(TMP_DIR, 'preview.txt');

(async () => {
  const previewBuf = await Packer.toBuffer(buildDoc(children));
  fs.writeFileSync(previewPath, previewBuf);
  execFileSync('pandoc', [previewPath, '-t', 'plain', '-o', previewTxt]);
  const flat = fs.readFileSync(previewTxt, 'utf8').replace(/\s+/g, ' ');
  const currSections = extractSections(flat);

  // ----- Manifest / versioning -----
  const MANIFEST = "/mnt/documents/release-pack-manifest.json";
  let manifest = { versions: [] };
  if (fs.existsSync(MANIFEST)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch {}
    if (!Array.isArray(manifest.versions)) manifest.versions = [];
  }
  const last = manifest.versions[manifest.versions.length - 1] || null;
  const prevSections = last ? last.sections : null;
  const diff = diffSections(prevSections, currSections);
  const newVersion = (last ? last.version : 0) + 1;
  const prevVersion = last ? last.version : null;
  const builtAt = new Date().toISOString();

  // ----- Pass 2: splice version block into final children -----
  const versionBlock = buildVersionBlock(newVersion, prevVersion, builtAt, diff);
  const finalChildren = [
    ...children.slice(0, SAFE_TO_TEST_INDEX),
    ...versionBlock,
    ...children.slice(SAFE_TO_TEST_INDEX),
  ];
  const finalBuf = await Packer.toBuffer(buildDoc(finalChildren));

  const canonical = "/mnt/documents/Izenzo_Release_Checkpoint_Client_Acceptance_Pack_REVISED.docx";
  const versioned = `/mnt/documents/Izenzo_Release_Checkpoint_Client_Acceptance_Pack_v${newVersion}.docx`;
  fs.writeFileSync(canonical, finalBuf);
  fs.writeFileSync(versioned, finalBuf);
  const fileHash = crypto.createHash('sha256').update(finalBuf).digest('hex').slice(0, 16);

  manifest.versions.push({
    version: newVersion,
    builtAt,
    file: path.basename(versioned),
    canonical: path.basename(canonical),
    bytes: finalBuf.length,
    sha256_16: fileHash,
    deMappingPreserved: diff.deMappingPreserved,
    diffSummary: {
      added: diff.added, removed: diff.removed,
      changed: diff.changed.map(c => ({ anchor: c.anchor, delta: c.delta,
                                       prevHash: c.prevHash, currHash: c.currHash })),
      unchanged: diff.unchanged,
    },
    sections: currSections, // stored for next-version diff
  });
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  console.log(`Wrote ${canonical} (${finalBuf.length} bytes)`);
  console.log(`Wrote ${versioned}`);
  console.log(`Version v${newVersion}` + (prevVersion ? ` (prev v${prevVersion})` : ' [initial]'));
  console.log(`Diff: +${diff.added.length} -${diff.removed.length} ~${diff.changed.length} =${diff.unchanged}; D/E mapping preserved: ${diff.deMappingPreserved}`);
})().catch(e => { console.error(e); process.exit(1); });

