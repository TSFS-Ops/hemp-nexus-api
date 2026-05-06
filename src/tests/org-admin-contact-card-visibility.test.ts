/**
 * OrgAdminContactCompletionCard — visibility matrix
 *
 * Pure-logic tests for the MT-009 Option B visibility predicate. These
 * mirror the backend gate in supabase/functions/poi-engagements/index.ts
 * (counterparty-side org_admin only) and protect the riskiest UI surface
 * in Batch A: the inline contact-completion card on Match Details.
 *
 * Visibility rules under test:
 *   • counterparty-side org_admin     → SHOWN
 *   • initiator-side org_admin        → HIDDEN
 *   • unrelated org_admin             → HIDDEN
 *   • normal org member (no admin)    → HIDDEN
 *   • platform_admin                  → HIDDEN (uses admin panel instead)
 *   • terminal engagement             → HIDDEN regardless of role
 */

import { describe, it, expect } from "vitest";
import {
  shouldShowOrgAdminContactCard,
  isCounterpartySide,
} from "@/components/match/OrgAdminContactCompletionCard";

const INITIATOR_ORG = "org-initiator";
const COUNTERPARTY_ORG = "org-counterparty";
const UNRELATED_ORG = "org-unrelated";

const baseEngagement = {
  org_id: INITIATOR_ORG,
  counterparty_org_id: COUNTERPARTY_ORG,
  engagement_status: "notification_sent",
};

const baseMatch = {
  org_id: INITIATOR_ORG,
  buyer_org_id: INITIATOR_ORG,
  seller_org_id: COUNTERPARTY_ORG,
};

describe("shouldShowOrgAdminContactCard — visibility matrix", () => {
  it("SHOWS the card to a counterparty-side org_admin", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: baseEngagement,
        match: baseMatch,
        viewerOrgId: COUNTERPARTY_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(true);
  });

  it("HIDES the card from the initiator-side org_admin", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: baseEngagement,
        match: baseMatch,
        viewerOrgId: INITIATOR_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it("HIDES the card from an unrelated org_admin", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: baseEngagement,
        match: baseMatch,
        viewerOrgId: UNRELATED_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it("HIDES the card from a normal org member (no org_admin role)", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: baseEngagement,
        match: baseMatch,
        viewerOrgId: COUNTERPARTY_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: false,
      }),
    ).toBe(false);
  });

  it("HIDES the card from a platform_admin (admin panel handles those)", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: baseEngagement,
        match: baseMatch,
        viewerOrgId: COUNTERPARTY_ORG,
        isPlatformAdmin: true,
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it("HIDES the card when the engagement is terminal (accepted)", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: { ...baseEngagement, engagement_status: "accepted" },
        match: baseMatch,
        viewerOrgId: COUNTERPARTY_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it("HIDES the card when the engagement is terminal (declined)", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: { ...baseEngagement, engagement_status: "declined" },
        match: baseMatch,
        viewerOrgId: COUNTERPARTY_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it("HIDES the card when the engagement is terminal (expired)", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: { ...baseEngagement, engagement_status: "expired" },
        match: baseMatch,
        viewerOrgId: COUNTERPARTY_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it("HIDES when viewerOrgId is null", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: baseEngagement,
        match: baseMatch,
        viewerOrgId: null,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it("HIDES when engagement or match is missing", () => {
    expect(
      shouldShowOrgAdminContactCard({
        engagement: null,
        match: baseMatch,
        viewerOrgId: COUNTERPARTY_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(false);
    expect(
      shouldShowOrgAdminContactCard({
        engagement: baseEngagement,
        match: null,
        viewerOrgId: COUNTERPARTY_ORG,
        isPlatformAdmin: false,
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });
});

describe("isCounterpartySide — fallback to match buyer/seller slot", () => {
  it("recognises counterparty side when counterparty_org_id is null but buyer/seller slot opposite initiator matches", () => {
    expect(
      isCounterpartySide(
        COUNTERPARTY_ORG,
        { org_id: INITIATOR_ORG, counterparty_org_id: null },
        { org_id: INITIATOR_ORG, buyer_org_id: INITIATOR_ORG, seller_org_id: COUNTERPARTY_ORG },
      ),
    ).toBe(true);
  });

  it("does not treat the initiator as counterparty even if it appears on both slots", () => {
    expect(
      isCounterpartySide(
        INITIATOR_ORG,
        { org_id: INITIATOR_ORG, counterparty_org_id: COUNTERPARTY_ORG },
        { org_id: INITIATOR_ORG, buyer_org_id: INITIATOR_ORG, seller_org_id: COUNTERPARTY_ORG },
      ),
    ).toBe(false);
  });
});
