// Unit tests for the PDF sanitiser used by certificate-rendering edge
// functions (currently supabase/functions/wad). pdf-lib's StandardFonts only
// support the WinAnsi (CP1252) glyph set; any string containing characters
// outside that set throws "WinAnsi cannot encode" mid-render and surfaces to
// the client as a generic "An internal error occurred". This file pins the
// behaviour of safePdfText so future template changes cannot silently
// reintroduce the crash.
//
// The matrix below is intentionally exhaustive across the categories that
// have caused production incidents: smart quotes, ellipsis, dashes, warning
// symbols, status glyphs, arrows, exotic whitespace, and emoji. When you
// extend the sanitiser, add a row here.
//
// Run: deno test supabase/functions/_shared/pdf-sanitizer_test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { PDF_SAFE_REPLACEMENTS, safePdfText } from "./pdf-sanitizer.ts";

// ─────────────────────────── Basic contract ───────────────────────────

Deno.test("safePdfText returns empty string for null/undefined", () => {
  assertEquals(safePdfText(null), "");
  assertEquals(safePdfText(undefined), "");
});

Deno.test("safePdfText coerces non-string values via String()", () => {
  assertEquals(safePdfText(42), "42");
  assertEquals(safePdfText(true), "true");
  assertEquals(safePdfText({ toString: () => "obj" }), "obj");
});

Deno.test("safePdfText preserves printable ASCII unchanged", () => {
  const input = "Hello, World! 0123456789 (test) [ok] {x} ~`@#$%^&*+=";
  assertEquals(safePdfText(input), input);
});

Deno.test("safePdfText preserves Latin-1 supplement (WinAnsi-covered)", () => {
  // Accented Latin characters used in EU names/addresses.
  const input = "Zoë Müller — café";
  // em dash → "-", everything else untouched
  assertEquals(safePdfText(input), "Zoë Müller - café");
});

Deno.test("safePdfText converts newlines and tabs to spaces", () => {
  assertEquals(safePdfText("line1\nline2\tcol\rend"), "line1 line2 col end");
});

// ─────────────────────────── Unicode matrix ───────────────────────────

const UNICODE_MATRIX: ReadonlyArray<{
  category: string;
  input: string;
  expected: string;
}> = [
  // Smart quotes (commonly inserted by Word, iOS, macOS, mobile keyboards)
  { category: "single quotes", input: "it\u2018s \u2019OK\u201A no\u201B", expected: "it's 'OK' no'" },
  { category: "double quotes", input: "\u201Chello\u201D \u201Ehi\u201F", expected: '"hello" "hi"' },
  { category: "mixed quotes in attestation", input: "I confirm Jane\u2019s \u201Cintent\u201D.", expected: "I confirm Jane's \"intent\"." },

  // Dashes and minus
  { category: "en dash", input: "2024\u20132025", expected: "2024-2025" },
  { category: "em dash", input: "Test \u2014 Demo grade only", expected: "Test - Demo grade only" },
  { category: "minus sign", input: "balance \u22125", expected: "balance -5" },

  // Ellipsis
  { category: "horizontal ellipsis", input: "loading\u2026", expected: "loading..." },

  // Warning / status symbols (banner text, bypass notices)
  { category: "warning sign", input: "\u26A0 TEST MODE", expected: "[!] TEST MODE" },
  { category: "warning sign + variation selector", input: "\u26A0\uFE0F TEST", expected: "[!] TEST" },
  { category: "check mark", input: "\u2713 verified", expected: "[OK] verified" },
  { category: "heavy check (emoji)", input: "\u2705 done", expected: "[OK] done" },
  { category: "ballot X", input: "\u2717 failed", expected: "[X] failed" },
  { category: "cross mark (emoji)", input: "\u274C blocked", expected: "[X] blocked" },

  // Arrows
  { category: "right arrow", input: "buyer \u2192 seller", expected: "buyer -> seller" },
  { category: "left arrow", input: "seller \u2190 buyer", expected: "seller <- buyer" },
  { category: "up arrow", input: "trend \u2191", expected: "trend ^" },
  { category: "down arrow", input: "trend \u2193", expected: "trend v" },

  // Bullets
  { category: "bullet", input: "\u2022 item", expected: "* item" },
  { category: "middle dot", input: "a\u00B7b", expected: "a*b" },

  // Exotic whitespace
  { category: "non-breaking space", input: "Mr.\u00A0Smith", expected: "Mr. Smith" },
  { category: "thin space", input: "1\u2009000", expected: "1 000" },
  { category: "narrow nbsp", input: "1\u202F000", expected: "1 000" },
  { category: "zero-width space", input: "joined\u200Bword", expected: "joinedword" },
  { category: "BOM at start", input: "\uFEFFhello", expected: "hello" },

  // Realistic combined attestation strings (what users actually paste)
  {
    category: "realistic attestation",
    input: "I\u2019m confirming \u201CIzenzo Trade\u201D \u2014 not a contract\u2026 \u26A0 demo only",
    expected: "I'm confirming \"Izenzo Trade\" - not a contract... [!] demo only",
  },
];

for (const row of UNICODE_MATRIX) {
  Deno.test(`safePdfText handles ${row.category}: ${JSON.stringify(row.input)}`, () => {
    assertEquals(safePdfText(row.input), row.expected);
  });
}

// ─────────────────────────── Fallback for unsupported codepoints ───────────────────────────

Deno.test("safePdfText replaces unmapped emoji with '?' (does not throw)", () => {
  // 🚀 (rocket), 🤝 (handshake), 💼 (briefcase) — none in WinAnsi, none mapped.
  const out = safePdfText("Launch 🚀 with 🤝 and 💼");
  assertEquals(out, "Launch ? with ? and ?");
});

Deno.test("safePdfText replaces CJK characters with '?' (does not throw)", () => {
  assertEquals(safePdfText("公司 договор"), "?? ???????");
});

Deno.test("safePdfText drops zero-width joiners (emoji modifier, no textual value)", () => {
  // U+200D (ZWJ) is used to combine emoji (e.g. 👨‍💻 = man + ZWJ + computer).
  // It carries no standalone meaning when stripped, so we drop it rather
  // than emit '?'.
  assertEquals(safePdfText("a\u200Db"), "ab");
});

// ─────────────────────────── Replacement table integrity ───────────────────────────

Deno.test("PDF_SAFE_REPLACEMENTS contains only ASCII targets", () => {
  for (const [from, to] of Object.entries(PDF_SAFE_REPLACEMENTS)) {
    for (const ch of to) {
      const code = ch.codePointAt(0)!;
      assert(
        code <= 0x7E,
        `Replacement for ${JSON.stringify(from)} contains non-ASCII char ${JSON.stringify(ch)} (U+${code.toString(16)})`,
      );
    }
  }
});

// ─────────────────────────── End-to-end: pdf-lib accepts every output ───────────────────────────
//
// This is the regression test that matters most: take every entry from the
// matrix, sanitise it, and feed the result to a real pdf-lib drawText call.
// If any output still contains a non-WinAnsi character, pdf-lib will throw
// here, exactly as it does in production.

Deno.test("pdf-lib StandardFonts can encode every sanitised matrix output", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);

  let y = 780;
  for (const row of UNICODE_MATRIX) {
    const safe = safePdfText(row.input);
    // This is the call that throws "WinAnsi cannot encode" if sanitisation
    // is incomplete. We let it surface so the test fails with a clear cause.
    page.drawText(safe, { x: 40, y, size: 10, font });
    y -= 14;
  }

  // Also exercise the unmapped-emoji path through a real draw.
  page.drawText(safePdfText("🚀 公司 договор 🤝"), { x: 40, y, size: 10, font });

  const bytes = await doc.save();
  assert(bytes.byteLength > 0, "Sanitised PDF should produce non-empty bytes");
});

Deno.test("pdf-lib Courier (monospace banner font) can encode warning banners", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([600, 100]);

  // The exact banner that originally crashed the WaD certificate route.
  const banner = safePdfText("\u26A0 TEST MODE \u2014 DEMO GRADE ONLY");
  page.drawText(banner, { x: 20, y: 60, size: 12, font });
  assertStringIncludes(banner, "[!]");
  assertStringIncludes(banner, " - ");

  const bytes = await doc.save();
  assert(bytes.byteLength > 0);
});
