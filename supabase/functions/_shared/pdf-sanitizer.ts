// Sanitiser for strings that will be drawn into PDF documents using pdf-lib's
// built-in fonts (Helvetica, Courier, Times). These fonts only support the
// WinAnsi (Windows-1252) encoding, so passing characters outside that set
// — smart quotes, em-dashes, ellipsis, warning symbols, emoji — causes
// pdf-lib to throw "WinAnsi cannot encode" mid-render. The error surfaces to
// users as a generic "An internal error occurred" because it happens deep
// inside drawText().
//
// This helper:
//   1. Maps common typographic punctuation to safe ASCII equivalents.
//   2. Maps frequently-used symbol glyphs (warning, check, cross, arrows) to
//      ASCII tokens like [!], [OK], [X], ->.
//   3. Preserves printable ASCII (0x20–0x7E) and the Latin-1 supplement
//      (0xA1–0xFF), which are all covered by WinAnsi.
//   4. Replaces newlines and tabs with spaces (callers wrap text manually).
//   5. Falls back to "?" for any other unsupported codepoint instead of
//      throwing.
//
// Keep this list in sync with renderer expectations in any edge function that
// emits PDFs (currently supabase/functions/wad and supabase/functions/deal-
// certificate). When you add a new symbol to a template, add the mapping
// here and add a row to safePdfText_test.ts.

export const PDF_SAFE_REPLACEMENTS: Record<string, string> = {
  // Dashes
  "\u2013": "-",   // – en dash
  "\u2014": "-",   // — em dash
  "\u2212": "-",   // − minus sign

  // Single quotes
  "\u2018": "'",   // ‘
  "\u2019": "'",   // ’
  "\u201A": "'",   // ‚
  "\u201B": "'",   // ‛

  // Double quotes
  "\u201C": '"',   // “
  "\u201D": '"',   // ”
  "\u201E": '"',   // „
  "\u201F": '"',   // ‟

  // Ellipsis
  "\u2026": "...", // …

  // Bullets
  "\u2022": "*",   // •
  "\u00B7": "*",   // ·

  // Status glyphs
  "\u26A0": "[!]",            // ⚠
  "\u26A0\uFE0F": "[!]",      // ⚠️ (with variation selector)
  "\u2705": "[OK]",            // ✅
  "\u2713": "[OK]",            // ✓
  "\u274C": "[X]",             // ❌
  "\u2717": "[X]",             // ✗

  // Arrows
  "\u2192": "->",              // →
  "\u2190": "<-",              // ←
  "\u2191": "^",               // ↑
  "\u2193": "v",               // ↓

  // Whitespace oddities
  "\u00A0": " ",               // NBSP
  "\u2009": " ",               // thin space
  "\u200A": " ",               // hair space
  "\u202F": " ",               // narrow NBSP
  "\u200B": "",                // zero-width space (drop)
  "\uFEFF": "",                // BOM (drop)
};

/**
 * Sanitise an arbitrary value for safe rendering by pdf-lib's built-in fonts.
 * Always returns a string that drawText/drawWrapped can encode without
 * throwing.
 */
export function safePdfText(input: unknown): string {
  if (input === null || input === undefined) return "";
  const str = String(input);
  let out = "";
  for (const ch of str) {
    if (PDF_SAFE_REPLACEMENTS[ch] !== undefined) {
      out += PDF_SAFE_REPLACEMENTS[ch];
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    // Printable ASCII
    if (code >= 0x20 && code <= 0x7E) { out += ch; continue; }
    // Latin-1 supplement (covered by WinAnsi)
    if (code >= 0xA1 && code <= 0xFF) { out += ch; continue; }
    // Newlines / tabs → spaces; callers wrap text manually
    if (ch === "\n" || ch === "\t" || ch === "\r") { out += " "; continue; }
    // Unknown / unsupported codepoint
    out += "?";
  }
  return out;
}
