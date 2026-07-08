/**
 * Batch V -- VerifyNow contract alignment. Source-level guard tests
 * (matching this repo's existing convention for cross-cutting checks
 * that cannot run without a live Supabase instance).
 *
 * These tests prove the UI-side half of the 2026-07-08 contract
 * alignment: structured fields for the three confirmed live routes,
 * free-text kept for manual-review/unconfirmed routes, and the correct
 * request body shape sent to idv-person-verify.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function read(rel: string): string {
    return readFileSync(rel, "utf8");
}

describe("Batch V -- VerifyNow contract alignment (IdvStart.tsx)", () => {
    const src = read("src/pages/desk/idv/IdvStart.tsx");

           it("defines structured fields for the three confirmed live routes", () => {
                 expect(src.includes("CONFIRMED_STRUCTURED_FIELDS")).toBe(true);
                 expect(src.includes("za_said_basic")).toBe(true);
                 expect(src.includes("za_home_affairs_enhanced")).toBe(true);
                 expect(src.includes("ng_nin")).toBe(true);
                 expect(src.includes("South African ID number")).toBe(true);
                 expect(src.includes("Nigerian NIN")).toBe(true);
           });

           it("does not define structured fields for unconfirmed Nigeria routes", () => {
                 expect(src.includes("ng_virtual_nin")).toBe(false);
                 expect(src.includes("ng_nin_slip")).toBe(false);
                 expect(src.includes("ng_bvn")).toBe(false);
                 expect(src.includes("ng_voter_id")).toBe(false);
                 expect(src.includes("ng_phone_lookup")).toBe(false);
                 expect(src.includes("ng_bank_account_check")).toBe(false);
           });

           it("renders structured fields via an Input component", () => {
                 expect(src.includes('from "@/components/ui/input"')).toBe(true);
                 expect(src.includes("idv-structured-fields")).toBe(true);
           });

           it("keeps the free-text textarea path for manual-review / unconfirmed routes", () => {
                 expect(src.includes("idv-details")).toBe(true);
                 expect(src.includes("Enter the details for this document")).toBe(true);
           });

           it("submits a structured payload for confirmed routes and details_text otherwise", () => {
                 expect(src.includes("payload: structuredFields")).toBe(true);
                 expect(src.includes("details_text: details.slice(0, 1024)")).toBe(true);
           });

           it("validates structured fields before submission", () => {
                 expect(src.includes("f.pattern.test(v)")).toBe(true);
           });

           it("clears structured field values when the document type changes", () => {
                 expect(src.includes("setStructuredFields({})")).toBe(true);
           });

           it("still calls idv-person-verify for the live route path, never idv-verify", () => {
                 expect(src.includes('"idv-person-verify"')).toBe(true);
                 expect(/["']idv-verify["']/.test(src)).toBe(false);
           });
});
