/**
 * Holding page served on izenzo.co.za and www.izenzo.co.za.
 *
 * Per client direction (2026-05-05): the public Mother Ship website is not
 * yet ready. Until it is, this domain must show a neutral
 * under-construction page only - no buttons, no hyperlinks, no product or
 * platform references.
 */
export function PublicHolding() {
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

export default PublicHolding;
