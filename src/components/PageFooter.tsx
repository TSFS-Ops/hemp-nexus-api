import { Link } from "react-router-dom";

/**
 * Canonical footer for all public-facing pages.
 * DO NOT duplicate footer markup in page files — import this component.
 */
export function PageFooter() {
  return (
    <footer className="border-t border-border/40 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Starfair162 (Pty) Ltd t/a Izenzo. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/docs" className="hover:text-foreground transition-colors">Documentation</Link>
            <a href="mailto:support@izenzo.co.za" className="hover:text-foreground transition-colors">Support</a>
          </div>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-4">
          No VAT charged — supplier not VAT registered in South Africa.
        </p>
      </div>
    </footer>
  );
}
