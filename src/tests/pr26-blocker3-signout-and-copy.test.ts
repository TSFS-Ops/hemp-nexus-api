/**
 * PR #26 pre-walkthrough blocker fixes.
 * Static guard: AdminShell and FunderShell expose a Sign out control that
 * is visible on both desktop and mobile viewports, reuses the existing
 * supabase.auth.signOut() path, and redirects to /auth. Also pins the
 * corrected (non-stale) Reviewer/Approver role-summary copy now that RFIs
 * and decisions are implemented.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ADMIN_SHELL = readFileSync(join(ROOT, "src/components/shells/AdminShell.tsx"), "utf8");
const FUNDER_SHELL = readFileSync(join(ROOT, "src/components/shells/FunderShell.tsx"), "utf8");
const PERSONA_ROUTER = readFileSync(join(ROOT, "src/components/shells/PersonaShellRouter.tsx"), "utf8");
const FUNDER_PERMISSIONS = readFileSync(join(ROOT, "src/lib/funder-workspace/funder-permissions.ts"), "utf8");

describe("PR26 blocker 3 - Sign out reachable on canonical admin and funder workspace pages", () => {
    it("AdminShell exposes a desktop Sign out control wired to the existing sign-out path", () => {
          expect(ADMIN_SHELL).toMatch(/handleSignOut[\s\S]*?supabase\.auth\.signOut\(\)/);
          expect(ADMIN_SHELL).toMatch(/window\.location\.href = "\/auth\?signedOut=1"/);
    });

           it("AdminShell exposes a mobile-visible (lg:hidden) icon-only Sign out control", () => {
                 expect(ADMIN_SHELL).toMatch(/lg:hidden[^"]*"\s+onClick=\{handleSignOut\}\s+aria-label="Sign out"/);
                 expect(ADMIN_SHELL).toMatch(/data-testid="admin-shell-signout-mobile"/);
           });

           it("FunderShell exposes a desktop Sign out control wired to the existing sign-out path", () => {
                 expect(FUNDER_SHELL).toMatch(/handleSignOut[\s\S]*?supabase\.auth\.signOut\(\)/);
                 expect(FUNDER_SHELL).toMatch(/window\.location\.href = "\/auth\?signedOut=1"/);
           });

           it("FunderShell exposes a mobile-visible (lg:hidden) icon-only Sign out control", () => {
                 expect(FUNDER_SHELL).toMatch(/lg:hidden[^"]*"\s+onClick=\{handleSignOut\}\s+aria-label="Sign out"/);
                 expect(FUNDER_SHELL).toMatch(/data-testid="funder-shell-signout-mobile"/);
           });

           it("neither shell duplicates the sign-out call - exactly one supabase.auth.signOut() per shell", () => {
                 const adminCalls = ADMIN_SHELL.match(/supabase\.auth\.signOut\(\)/g) ?? [];
                 const funderCalls = FUNDER_SHELL.match(/supabase\.auth\.signOut\(\)/g) ?? [];
                 expect(adminCalls.length).toBe(1);
                 expect(funderCalls.length).toBe(1);
           });

           it("PersonaShellRouter wraps every /admin and /funder route in the sign-out-capable shells, and leaves /auth bare", () => {
                 expect(PERSONA_ROUTER).toMatch(/ADMIN_PATH_PREFIXES = \["\/hq", "\/admin"\]/);
                 expect(PERSONA_ROUTER).toMatch(/FUNDER_PATH_PREFIXES = \["\/funder"\]/);
                 expect(PERSONA_ROUTER).not.toMatch(/["'`]\/auth["'`]/);
           });
});

describe("PR26 blocker 3 - Reviewer/Approver role copy is no longer stale", () => {
    it("does not claim RFIs or decisions are a future/unavailable capability", () => {
          expect(FUNDER_PERMISSIONS).not.toMatch(/Future:.*RFIs/);
          expect(FUNDER_PERMISSIONS).not.toMatch(/Future:.*funding decisions/);
          expect(FUNDER_PERMISSIONS).not.toMatch(/not in this batch/);
    });

           it("describes the Approver's implemented decision-recording capability", () => {
                 expect(FUNDER_PERMISSIONS).toMatch(/funder_approver:\s*\[[\s\S]*?"Record the formal funding decision for a release"/);
           });

           it("describes the Reviewer's implemented RFI/comment capability", () => {
                 expect(FUNDER_PERMISSIONS).toMatch(/funder_reviewer:\s*\[[\s\S]*?"Create requests for information \(RFIs\) and shared comments"/);
           });

           it("does not claim funder team-management exists (still correctly flagged as unavailable)", () => {
                 expect(FUNDER_PERMISSIONS).toMatch(/Team self-service is not yet available/);
           });
});
});
