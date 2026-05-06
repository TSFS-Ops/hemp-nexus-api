/**
 * Batch A — "Is this org the counterparty side of the engagement?"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Single source of truth used by:
 *   • PATCH /poi-engagements/:id   (org_admin contact-edit gate, MT-009)
 *   • POST  /poi-engagements/respond/:matchId (existing respond gate —
 *     pattern lifted verbatim from there).
 *
 * `poi_engagements` stores ONE contact record per engagement and that
 * contact represents the COUNTERPARTY side of the match (the side opposite
 * the initiator `engagement.org_id`). The initiator already has full
 * profile data on the platform, so there is no "initiator-side contact"
 * field to edit on this row.
 *
 * Therefore Daniel's MT-009 Option C — "an org_admin may assign contacts
 * only for their own organisation" — maps to:
 *
 *   org_admin may edit contact_type / contact_name on this engagement
 *   IF AND ONLY IF their org is the counterparty side of the match,
 *   i.e. their org matches `counterparty_org_id` OR their org is the
 *   registered match-side opposite the initiator.
 *
 * The initiator org_admin must NOT be allowed to edit the counterparty
 * contact via this row — that would let them write the other side's
 * contact details, which is exactly what MT-009 Option C forbids.
 */

export interface CounterpartyEngagementInput {
  org_id: string;                    // initiator org
  counterparty_org_id?: string | null;
}

export interface CounterpartyMatchInput {
  org_id?: string | null;            // creator org on the match
  buyer_org_id?: string | null;
  seller_org_id?: string | null;
}

/**
 * Returns true when `actorOrgId` is the counterparty side of the match,
 * i.e. eligible to manage the engagement's counterparty contact record.
 *
 * Mirrors the predicate already in use on POST /respond/:matchId so the
 * platform has a single, consistent definition of "counterparty side".
 */
export function isCounterpartySide(
  actorOrgId: string | null | undefined,
  engagement: CounterpartyEngagementInput,
  match: CounterpartyMatchInput | null | undefined,
): boolean {
  if (!actorOrgId) return false;

  // The actor must NEVER be the initiator — the initiator owns the
  // outreach attempt, not the counterparty contact record.
  if (engagement.org_id === actorOrgId) return false;

  // Direct binding: counterparty_org_id is the explicit FK to the
  // registered counterparty organisation.
  if (engagement.counterparty_org_id && engagement.counterparty_org_id === actorOrgId) {
    return true;
  }

  // Fallback: actor is on the buyer or seller side of the match AND is
  // not the initiator. This covers the case where counterparty_org_id
  // has not yet been bound but the match-side relationship is known.
  if (match) {
    const onMatch = match.buyer_org_id === actorOrgId || match.seller_org_id === actorOrgId;
    if (onMatch && match.org_id !== actorOrgId) return true;
  }

  return false;
}

/**
 * Plain-English label describing which side of the match an org sits on.
 * Used in audit metadata and 403 messages so the rejection is legible
 * without joining tables. Returns null when the actor is on neither side.
 */
export function describeMatchSide(
  actorOrgId: string | null | undefined,
  match: CounterpartyMatchInput | null | undefined,
): "buyer" | "seller" | null {
  if (!actorOrgId || !match) return null;
  if (match.buyer_org_id === actorOrgId) return "buyer";
  if (match.seller_org_id === actorOrgId) return "seller";
  return null;
}
