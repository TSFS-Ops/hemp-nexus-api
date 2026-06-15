/**
 * Holding page served on trade.izenzo.co.za.
 *
 * Per client direction (2026-05-05): this domain is reserved. The page must
 * be commercially neutral - no buttons, no hyperlinks, no commodity vertical
 * list, no API references, no live console references, no footer links.
 */
export function MarketplaceHolding() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-white px-6"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      <main className="max-w-xl w-full text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
          Under construction.
        </h1>
      </main>
    </div>
  );
}

export default MarketplaceHolding;
