import { ReactNode } from "react";
import { PublicHeader } from "./PublicHeader";
import { PageFooter } from "./PageFooter";

/**
 * Canonical layout for all public-facing pages (Pricing, Docs, Walkthrough, etc.).
 * Provides consistent header, footer, and vertical spacing.
 * 
 * Pages supply content only — no layout boilerplate.
 */
interface PublicPageLayoutProps {
  children: ReactNode;
  /** Whether to include the footer (default: true) */
  showFooter?: boolean;
}

export function PublicPageLayout({ children, showFooter = true }: PublicPageLayoutProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      {showFooter && <PageFooter />}
    </div>
  );
}
