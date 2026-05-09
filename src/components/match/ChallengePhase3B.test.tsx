import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChallengeStatusCard } from "./ChallengeStatusCard";
import { ProgressionPausedBanner } from "./ProgressionPausedBanner";
import type { ChallengeRow } from "@/hooks/useMatchChallenge";

const base: ChallengeRow = {
  id: "11111111-2222-3333-4444-555555555555",
  match_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  org_id: null,
  raised_by_org_id: null,
  raised_by_user_id: null,
  raised_by_role: "buyer_org_admin",
  subject_code: "terms_disagreement",
  summary: "x".repeat(80),
  status: "open",
  outcome_code: null,
  outcome_summary: null,
  closed_at: null,
  closed_by_user_id: null,
  break_glass_override_used: null,
  created_at: new Date().toISOString(),
  updated_at: null,
};

describe("ChallengeStatusCard (Phase 3B)", () => {
  it("R2: renders for status=open with neutral status badge", () => {
    render(<ChallengeStatusCard challenge={{ ...base, status: "open" }} />);
    expect(screen.getByTestId("challenge-status-card")).toBeInTheDocument();
    expect(screen.getByTestId("challenge-status-badge").textContent).toMatch(/Open/);
  });

  it("R4: renders for terminal outcome_recorded with outcome label", () => {
    render(
      <ChallengeStatusCard
        challenge={{
          ...base,
          status: "outcome_recorded",
          outcome_code: "admin_override_recorded",
          closed_at: new Date().toISOString(),
        }}
      />,
    );
    expect(screen.getByTestId("challenge-status-card")).toBeInTheDocument();
    expect(screen.getByText(/Administrator override recorded/i)).toBeInTheDocument();
  });

  it("renders for closed_no_action terminal status", () => {
    render(
      <ChallengeStatusCard
        challenge={{ ...base, status: "closed_no_action", closed_at: new Date().toISOString() }}
      />,
    );
    expect(screen.getByTestId("challenge-status-card")).toBeInTheDocument();
  });

  it("R1: renders nothing when no challenge", () => {
    const { container } = render(<ChallengeStatusCard challenge={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ProgressionPausedBanner (Phase 3B)", () => {
  it("R2/R3: renders for open and under_review", () => {
    const { rerender } = render(<ProgressionPausedBanner challenge={{ ...base, status: "open" }} />);
    expect(screen.getByTestId("progression-paused-banner")).toBeInTheDocument();
    rerender(<ProgressionPausedBanner challenge={{ ...base, status: "under_review" }} />);
    expect(screen.getByTestId("progression-paused-banner")).toBeInTheDocument();
  });

  it("R4: hidden when challenge is terminal", () => {
    const { container } = render(
      <ProgressionPausedBanner challenge={{ ...base, status: "outcome_recorded" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("R1: hidden when no challenge", () => {
    const { container } = render(<ProgressionPausedBanner challenge={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("S1: copy contains no forbidden 'dispute/accusation/guilt' wording", () => {
    render(<ProgressionPausedBanner challenge={{ ...base, status: "open" }} />);
    const banner = screen.getByTestId("progression-paused-banner");
    const text = banner.textContent ?? "";
    expect(text).not.toMatch(/dispute raised/i);
    expect(text).not.toMatch(/accusation/i);
    expect(text).not.toMatch(/guilty/i);
    expect(text).not.toMatch(/wrongdoing/i);
  });
});
