/**
 * Accessibility tests for WizardStepper.
 *
 * These lock down the semantics added to support screen-reader users:
 *   - the steps are exposed as an ordered list (`<ol role="list">`)
 *   - each step is a focusable button with a single consolidated aria-label
 *   - the active step is marked aria-current="step"
 *   - decorative iconography is aria-hidden
 *   - the active-step description below the rail is aria-hidden so it doesn't
 *     double-announce after the active button (which already includes it)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WizardStepper, type WizardStepDef } from "./WizardStepper";

const STEPS: WizardStepDef[] = [
  { id: "search", label: "Search", description: "Find a counterparty.", complete: true, locked: false },
  { id: "match", label: "Match", description: "Confirm match details.", complete: false, locked: false },
  { id: "poi", label: "POI", description: "Issue Proof of Intent.", complete: false, locked: true },
  { id: "wad", label: "WaD", description: "Sign the deal.", complete: false, locked: true },
  { id: "evidence", label: "Evidence", description: "Download pack.", complete: false, locked: true },
];

describe("WizardStepper a11y", () => {
  it("renders the steps inside an ordered list", () => {
    render(<WizardStepper steps={STEPS} activeStep={1} onStepClick={vi.fn()} />);

    // Both desktop and mobile variants are present in the DOM (one is hidden
    // via responsive CSS). Both must use <ol role="list">.
    const lists = screen.getAllByRole("list", { name: /trade workflow steps/i });
    expect(lists.length).toBeGreaterThanOrEqual(1);
    for (const list of lists) {
      expect(list.tagName).toBe("OL");
      expect(within(list).getAllByRole("listitem")).toHaveLength(STEPS.length);
    }
  });

  it("marks only the active step with aria-current=\"step\"", () => {
    render(<WizardStepper steps={STEPS} activeStep={1} onStepClick={vi.fn()} />);

    const list = screen.getAllByRole("list", { name: /trade workflow steps/i })[0];
    const items = within(list).getAllByRole("listitem");
    const current = items.map((li) => li.getAttribute("aria-current"));
    expect(current).toEqual([null, "step", null, null, null]);
  });

  it("gives each step button a position-aware, state-aware aria-label", () => {
    render(<WizardStepper steps={STEPS} activeStep={1} onStepClick={vi.fn()} />);

    // The desktop variant is the first occurrence in DOM order.
    const labels = screen
      .getAllByRole("button")
      .slice(0, STEPS.length)
      .map((btn) => btn.getAttribute("aria-label") || "");

    expect(labels[0]).toBe("Step 1 of 5 Search — completed");
    expect(labels[1]).toBe(
      "Step 2 of 5 Match — current step . Confirm match details.",
    );
    expect(labels[2]).toMatch(/Step 3 of 5 POI — locked$/);
  });

  it("disables locked steps and reflects that via aria-disabled", () => {
    render(<WizardStepper steps={STEPS} activeStep={1} onStepClick={vi.fn()} />);

    const lockedButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.getAttribute("aria-label")?.includes("locked"));

    expect(lockedButtons.length).toBeGreaterThan(0);
    for (const btn of lockedButtons) {
      expect(btn).toBeDisabled();
      expect(btn.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("does not duplicate the active-step description in a separate visible paragraph", () => {
    // After the redesign, the active-step description is no longer rendered
    // beneath the rail (it lives in the focal ActionRequiredBanner instead).
    // The active step's button still carries the description in its aria-label,
    // so screen reader users get the full context exactly once.
    const { container } = render(
      <WizardStepper steps={STEPS} activeStep={1} onStepClick={vi.fn()} />,
    );

    const descParagraphs = Array.from(container.querySelectorAll("p")).filter(
      (p) => p.textContent === "Confirm match details.",
    );
    expect(descParagraphs.length).toBe(0);

    const activeButton = container.querySelector('[aria-current="step"] button');
    expect(activeButton?.getAttribute("aria-label")).toContain("Confirm match details.");
  });
});
