/**
 * Batch A — UI gate verification tests
 *
 * These tests pin the contract between the UI surfaces and the backend's
 * Batch A contact-completeness gate. They cover:
 *   • The four canonical contact-state labels (signed wording, 06 May 2026).
 *   • Outreach blocking for `email_missing` and `contact_incomplete`.
 *   • Outreach allowed for `organisation_contact` and `named_individual_contact`.
 *   • The AddContactDialog schema enforcing contact_type/contact_name rules
 *     (named individual ⇒ name required; organisation ⇒ org name OR linked
 *     org required; email-only stays Contact incomplete).
 *   • The admin-panel canonical pre-acceptance set (`isEngagementPending`)
 *     does not depend on the legacy "pending" string literal — both
 *     'notification_sent' and 'contacted' surface as pending.
 */

import { describe, it, expect } from "vitest";
import {
  contactBlockCode,
  contactBlockReason,
  contactStateLabel,
  getContactState,
  isOutreachBlocked,
} from "@/lib/contact-completeness";
import { addContactSchema } from "@/components/admin/AddContactDialog";
import {
  ENGAGEMENT_PENDING_STATES,
  isEngagementPending,
} from "@/lib/engagement-state";

describe("Batch A — canonical contact-state labels", () => {
  it("renders the four signed labels", () => {
    expect(contactStateLabel("organisation_contact")).toBe("Organisation-level contact");
    expect(contactStateLabel("named_individual_contact")).toBe("Named individual contact");
    expect(contactStateLabel("email_missing")).toBe("Email missing");
    expect(contactStateLabel("contact_incomplete")).toBe("Contact incomplete");
  });

  it("blocks outreach only for email_missing and contact_incomplete", () => {
    expect(isOutreachBlocked("organisation_contact")).toBe(false);
    expect(isOutreachBlocked("named_individual_contact")).toBe(false);
    expect(isOutreachBlocked("email_missing")).toBe(true);
    expect(isOutreachBlocked("contact_incomplete")).toBe(true);
  });

  it("maps blocked states to the backend error codes", () => {
    expect(contactBlockCode("email_missing")).toBe("CONTACT_EMAIL_MISSING");
    expect(contactBlockCode("contact_incomplete")).toBe("CONTACT_INCOMPLETE");
    expect(contactBlockCode("organisation_contact")).toBeNull();
    expect(contactBlockCode("named_individual_contact")).toBeNull();
  });

  it("returns a non-null block reason for blocked states only", () => {
    expect(contactBlockReason("email_missing")).toMatch(/no usable email/i);
    expect(contactBlockReason("contact_incomplete")).toMatch(/incomplete/i);
    expect(contactBlockReason("organisation_contact")).toBeNull();
    expect(contactBlockReason("named_individual_contact")).toBeNull();
  });
});

describe("Batch A — getContactState classification", () => {
  it("email + linked counterparty org → organisation_contact", () => {
    expect(
      getContactState({
        counterparty_email: "ops@acme.com",
        counterparty_org_id: "org-123",
      }),
    ).toBe("organisation_contact");
  });

  it("email + match-side org name → organisation_contact", () => {
    expect(
      getContactState(
        { counterparty_email: "ops@acme.com", counterparty_org_id: null },
        { buyer_name: "Acme Trading", seller_name: null, buyer_org_id: null, seller_org_id: "seller-org" },
      ),
    ).toBe("organisation_contact");
  });

  it("email + contact_type=named_individual + contact_name → named_individual_contact", () => {
    expect(
      getContactState({
        counterparty_email: "naledi@acme.com",
        counterparty_org_id: null,
        contact_type: "named_individual",
        contact_name: "Naledi Mokoena",
      }),
    ).toBe("named_individual_contact");
  });

  it("name present, no usable email → email_missing", () => {
    expect(
      getContactState({
        counterparty_email: null,
        counterparty_org_id: null,
        contact_name: "Naledi Mokoena",
        contact_type: "named_individual",
      }),
    ).toBe("email_missing");
    // .invalid TLD also counts as no usable email
    expect(
      getContactState({
        counterparty_email: "x@example.invalid",
        counterparty_org_id: "org-123",
      }),
    ).toBe("email_missing");
  });

  it("email-only with no organisation and no individual → contact_incomplete (binding correction)", () => {
    expect(
      getContactState({
        counterparty_email: "stray@nowhere.com",
        counterparty_org_id: null,
      }),
    ).toBe("contact_incomplete");
  });

  it("nothing on file → contact_incomplete", () => {
    expect(
      getContactState({ counterparty_email: null, counterparty_org_id: null }),
    ).toBe("contact_incomplete");
  });
});

describe("Batch A — AddContactDialog schema", () => {
  it("named_individual requires contact_name", () => {
    const r = addContactSchema.safeParse({
      email: "naledi@acme.com",
      contact_type: "named_individual",
      contact_name: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "contact_name")).toBe(true);
    }
  });

  it("named_individual with name passes", () => {
    const r = addContactSchema.safeParse({
      email: "naledi@acme.com",
      contact_type: "named_individual",
      contact_name: "Naledi Mokoena",
    });
    expect(r.success).toBe(true);
  });

  it("organisation requires either an org name OR hasOrganisationName", () => {
    const r = addContactSchema.safeParse({
      email: "ops@acme.com",
      contact_type: "organisation",
      contact_name: "",
      hasOrganisationName: false,
    });
    expect(r.success).toBe(false);
  });

  it("organisation passes when hasOrganisationName=true (linked org)", () => {
    const r = addContactSchema.safeParse({
      email: "ops@acme.com",
      contact_type: "organisation",
      contact_name: "",
      hasOrganisationName: true,
    });
    expect(r.success).toBe(true);
  });

  it("organisation passes when admin types the org name", () => {
    const r = addContactSchema.safeParse({
      email: "ops@acme.com",
      contact_type: "organisation",
      contact_name: "Acme Trading (Pty) Ltd",
      hasOrganisationName: false,
    });
    expect(r.success).toBe(true);
  });

  it("missing contact_type is rejected (no email-only saves)", () => {
    const r = addContactSchema.safeParse({ email: "x@y.com" } as any);
    expect(r.success).toBe(false);
  });

  it(".invalid email is rejected", () => {
    const r = addContactSchema.safeParse({
      email: "auto-link@izenzo-test.invalid",
      contact_type: "organisation",
      contact_name: "Acme",
    });
    expect(r.success).toBe(false);
  });
});

describe("Batch A — admin queue does not rely on legacy 'pending' literal", () => {
  it("canonical pending set covers notification_sent and contacted", () => {
    expect(ENGAGEMENT_PENDING_STATES).toContain("notification_sent");
    expect(ENGAGEMENT_PENDING_STATES).toContain("contacted");
    expect(ENGAGEMENT_PENDING_STATES).not.toContain("pending");
  });

  it("isEngagementPending returns true for canonical states without the legacy literal", () => {
    expect(isEngagementPending("notification_sent")).toBe(true);
    expect(isEngagementPending("contacted")).toBe(true);
    // Legacy 'pending' is still tolerated defensively for historical rows
    expect(isEngagementPending("pending")).toBe(true);
  });

  it("terminal states are not pending", () => {
    expect(isEngagementPending("accepted")).toBe(false);
    expect(isEngagementPending("declined")).toBe(false);
    expect(isEngagementPending("expired")).toBe(false);
  });
});
