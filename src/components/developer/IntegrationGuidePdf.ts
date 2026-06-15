/**
 * Client-side PDF generator for the Integration Guide.
 *
 * Uses jsPDF directly (no edge function). The output is a clean, brandable,
 * text-based PDF a client team can circulate internally without needing
 * Lovable login. Page format: A4, 1-inch margins, deep slate text on white,
 * institutional emerald accent - to match the Civilisation OS brand.
 */

import { jsPDF } from "jspdf";

const SLATE = "#0F172A";
const SLATE_MUTED = "#475569";
const EMERALD = "#047857";
const RULE = "#E2E8F0";

const PAGE_W = 210; // mm (A4)
const PAGE_H = 297;
const MARGIN_X = 22;
const MARGIN_Y = 22;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

interface Block {
  kind: "h1" | "h2" | "h3" | "p" | "code" | "rule" | "spacer" | "kv";
  text?: string;
  k?: string;
  v?: string;
  size?: number;
}

const BLOCKS: Block[] = [
  { kind: "h1", text: "Izenzo Integration Guide" },
  { kind: "p", text: "A concise, plain-English reference for client teams integrating with the Izenzo trade platform. Intended for circulation inside an approved client organisation. For the live, always-current version, sign in to the Developer Centre at api.trade.izenzo.co.za/developer." },
  { kind: "kv", k: "Document version", v: "1.0" },
  { kind: "kv", k: "Last reviewed", v: new Date().toISOString().slice(0, 10) },
  { kind: "kv", k: "Support contact", v: "api@izenzo.co.za" },
  { kind: "rule" },

  { kind: "h2", text: "1. What this is" },
  { kind: "p", text: "The Izenzo API lets your back-office systems do directly what a human operator would do in the trade desk: register trade requests, generate Proofs of Intent (POIs), exchange evidence, and seal Without-a-Doubt (WaD) bundles. The surface is intentionally small. Any HTTPS client works." },
  { kind: "p", text: "What it is not: a settlement rail, a market-data feed, or a custody system. Money does not move through this API. Credits (priced at one US dollar each) are consumed when a POI is minted." },

  { kind: "h2", text: "2. Authentication" },
  { kind: "p", text: "Every request carries an API key in the X-API-Key header. Keys are issued in the Developer Centre. Live keys are prefixed sk_live_ and sandbox keys sk_test_. The prefix is not sensitive and is safe to share for support." },
  { kind: "p", text: "Secret keys are shown ONCE at creation. We store only a hash. If a key is exposed, rotate it immediately (issues a new key, the old one stops working) or revoke it if the integration is decommissioned." },
  { kind: "code", text: "curl https://api.trade.izenzo.co.za/functions/v1/healthz \\\n  -H \"X-API-Key: sk_live_...\"" },

  { kind: "h2", text: "3. Sandbox vs Live" },
  { kind: "p", text: "Sandbox is a safe playground. Synthetic counterparties, simulated credit burns, suppressed outbound email and webhooks, no audit weight. Use it to wire up your integration end-to-end before pointing at Live." },
  { kind: "p", text: "Live affects real records. POIs are immutable. Email and webhooks reach real counterparties. Credits burn from your actual balance. If you cannot describe in one sentence what a Live call is about to do, switch to Sandbox first." },

  { kind: "h2", text: "4. The core flow" },
  { kind: "p", text: "Most integrations need to do four things, in this order:" },
  { kind: "p", text: "(1) Create a trade request. POST /v1/trade.create with commodity, quantity, side and price. Idempotent on the Idempotency-Key header." },
  { kind: "p", text: "(2) Find or accept a counterparty. Either search the discovery index, accept an inbound engagement, or invite a known partner." },
  { kind: "p", text: "(3) Mint a Proof of Intent. POST /v1/poi.generate. Costs one credit. Requires both parties to have acknowledged the declaration and ATB clauses, and at least one document per side on bilateral matches. The probability of completion must be at least 50.1 percent." },
  { kind: "p", text: "(4) Seal the WaD bundle. Once both parties have attested, the bundle is sealed with a SHA-256 hash chain and becomes the immutable evidence pack." },

  { kind: "h2", text: "5. Webhooks" },
  { kind: "p", text: "Register endpoints in the Developer Centre to receive push events: trade.created, poi.minted, poi.sealed, engagement.accepted, dispute.opened, balance.updated. Each delivery carries a signature header your server should verify. We retry on exponential back-off and auto-disable an endpoint that fails repeatedly. An auto-disabled live endpoint blocks WaD sealing (Gate 10) until restored." },
  { kind: "p", text: "Replay protection: re-delivering an event your server has already processed returns 409 WEBHOOK_REPLAY. This is by design." },

  { kind: "h2", text: "6. Rate limits and idempotency" },
  { kind: "p", text: "Default limit: 1,000 requests per minute per organisation. A 429 response carries a Retry-After header with seconds to wait. Always send an Idempotency-Key on writes so retries cannot create duplicates." },

  { kind: "h2", text: "7. Errors" },
  { kind: "p", text: "Errors return JSON: { code, message, request_id }. Always log the request_id - it is the fastest path to a useful support response. Common codes: VALIDATION_ERROR (400), UNAUTHORIZED (401), FORBIDDEN_SCOPE (403), NOT_FOUND (404), DISPUTE_ACTIVE (409), ENGAGEMENT_PENDING (409), WEBHOOK_REPLAY (409), RATE_LIMITED (429)." },

  { kind: "h2", text: "8. Billing" },
  { kind: "p", text: "Calls made with this key burn credits at the same rate as a manual operator. One credit costs one US dollar. Tiers: pack_10 ($10), pack_50 ($45, ten percent off), pack_200 ($160, twenty percent off). Top up via the billing page. Sandbox calls never burn credits." },

  { kind: "h2", text: "9. Support" },
  { kind: "p", text: "Engineering support: api@izenzo.co.za. Service level: four business hours, twenty-four hours over weekends. Always include the request_id from any failing response and the timestamp in UTC." },

  { kind: "rule" },
  { kind: "p", text: "© Izenzo. Internal distribution only. The Developer Centre at api.trade.izenzo.co.za/developer is the authoritative source - this PDF is a snapshot." },
];

export function generateIntegrationGuidePdf(): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Cursor in mm from top-left.
  let y = MARGIN_Y;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN_Y) {
      addFooter(doc);
      doc.addPage();
      y = MARGIN_Y;
    }
  };

  // Brand mark on first page.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(EMERALD);
  doc.text("IZENZO", MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(SLATE_MUTED);
  doc.text("· trade infrastructure", MARGIN_X + 17, y);
  y += 8;

  for (const block of BLOCKS) {
    switch (block.kind) {
      case "h1": {
        ensureSpace(14);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(SLATE);
        doc.text(block.text!, MARGIN_X, y);
        y += 9;
        // Emerald rule under H1.
        doc.setDrawColor(EMERALD);
        doc.setLineWidth(0.6);
        doc.line(MARGIN_X, y, MARGIN_X + 30, y);
        y += 6;
        break;
      }
      case "h2": {
        ensureSpace(12);
        y += 3;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(SLATE);
        doc.text(block.text!, MARGIN_X, y);
        y += 6;
        break;
      }
      case "h3": {
        ensureSpace(10);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(SLATE);
        doc.text(block.text!, MARGIN_X, y);
        y += 5;
        break;
      }
      case "p": {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(SLATE);
        const lines = doc.splitTextToSize(block.text!, CONTENT_W) as string[];
        for (const line of lines) {
          ensureSpace(5);
          doc.text(line, MARGIN_X, y);
          y += 4.6;
        }
        y += 1.2;
        break;
      }
      case "kv": {
        ensureSpace(5);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(SLATE_MUTED);
        doc.text(block.k!, MARGIN_X, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(SLATE);
        doc.text(block.v!, MARGIN_X + 38, y);
        y += 4.4;
        break;
      }
      case "code": {
        const lines = block.text!.split("\n");
        const boxH = lines.length * 4.4 + 5;
        ensureSpace(boxH + 3);
        doc.setFillColor("#F8FAFC");
        doc.setDrawColor(RULE);
        doc.setLineWidth(0.2);
        doc.roundedRect(MARGIN_X, y, CONTENT_W, boxH, 1.5, 1.5, "FD");
        doc.setFont("courier", "normal");
        doc.setFontSize(9);
        doc.setTextColor(SLATE);
        let cy = y + 5;
        for (const line of lines) {
          doc.text(line, MARGIN_X + 3, cy);
          cy += 4.4;
        }
        y += boxH + 3;
        break;
      }
      case "rule": {
        ensureSpace(4);
        doc.setDrawColor(RULE);
        doc.setLineWidth(0.2);
        doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
        y += 5;
        break;
      }
      case "spacer": {
        y += block.size ?? 4;
        break;
      }
    }
  }

  addFooter(doc);

  // Add page numbers across all pages.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(SLATE_MUTED);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN_X, PAGE_H - 10, { align: "right" });
  }

  return doc;
}

function addFooter(doc: jsPDF) {
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, PAGE_H - 14, PAGE_W - MARGIN_X, PAGE_H - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(SLATE_MUTED);
  doc.text("Izenzo · Integration Guide · api@izenzo.co.za", MARGIN_X, PAGE_H - 10);
}

export function downloadIntegrationGuidePdf() {
  const doc = generateIntegrationGuidePdf();
  doc.save(`izenzo-integration-guide-${new Date().toISOString().slice(0, 10)}.pdf`);
}
