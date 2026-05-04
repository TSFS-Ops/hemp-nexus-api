/**
 * SectionLede
 *
 * One-line plain-English description that sits directly below a section
 * title (System Diagnostics, Live Event Stream, Quick reference, etc.).
 * Optional status badge alongside.
 */

import { ReactNode } from "react";

export function SectionLede({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[12.5px] text-slate-400 leading-relaxed mt-1 max-w-3xl"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      {children}
    </p>
  );
}
