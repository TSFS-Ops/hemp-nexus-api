import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { PublicHeader } from "@/components/PublicHeader";

type DocLink = { to: string; label: string };
type DocSection = { title: string; links: DocLink[] };

/**
 * Sidebar reflects ONLY routes that actually exist in App.tsx.
 * Every link below resolves to a real page - no dead ends.
 */
const SECTIONS: DocSection[] = [
  {
    title: "Get started",
    links: [
      { to: "/docs", label: "Introduction" },
      { to: "/docs/quickstart", label: "Quickstart" },
      { to: "/docs/authentication", label: "Authentication" },
    ],
  },
  {
    title: "Core resources",
    links: [
      { to: "/docs/matches", label: "Matches" },
      { to: "/docs/counterparties", label: "Counterparties" },
      { to: "/docs/evidence", label: "Evidence Packs" },
      { to: "/docs/webhooks", label: "Webhooks" },
    ],
  },
  {
    title: "Reference",
    links: [
      { to: "/docs/api", label: "API Reference" },
      { to: "/docs/api-pricing", label: "Endpoint pricing" },
      { to: "/docs/errors", label: "Errors" },
    ],
  },
];

export function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-card">
      <PublicHeader />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 flex">
        <aside className="hidden md:block w-64 shrink-0 border-r border-border py-12 pr-8">
          <div className="sticky top-28 space-y-8">
            {SECTIONS.map((section) => (
              <div key={section.title}>
                <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 mb-3">
                  {section.title}
                </h4>
                <ul className="space-y-1">
                  {section.links.map((link) => (
                    <li key={link.to}>
                      <NavLink
                        to={link.to}
                        end
                        className={({ isActive }) =>
                          `block px-3 py-1.5 text-[13.5px] rounded-md transition-colors ${
                            isActive
                              ? "text-[hsl(var(--emerald))] bg-[hsl(var(--emerald-muted))]/60 font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`
                        }
                      >
                        {link.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex-1 min-w-0 py-12 md:pl-12">{children}</main>
      </div>
    </div>
  );
}

export default DocsLayout;
