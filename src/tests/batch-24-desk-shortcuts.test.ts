/**
 * Batch 24 — Trade Desk sidebar quick-navigation shortcut pins.
 *
 * Pins the shortcut wiring so future refactors cannot silently drop the
 * keyboard navigation or its cheatsheet from the Trade Desk shell.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sidebar = readFileSync("src/components/desk/DeskSidebar.tsx", "utf8");
const hook = readFileSync("src/components/desk/useDeskShortcuts.ts", "utf8");
const dialog = readFileSync(
  "src/components/desk/DeskShortcutsDialog.tsx",
  "utf8",
);

describe("Batch 24 — Trade Desk sidebar shortcuts", () => {
  it("wires useDeskShortcuts into the sidebar", () => {
    expect(sidebar).toMatch(/useDeskShortcuts\(SHORTCUTS\)/);
  });

  it("renders a cheatsheet trigger labelled 'Keyboard shortcuts'", () => {
    expect(sidebar).toMatch(/Keyboard shortcuts/);
    expect(sidebar).toMatch(/aria-haspopup="dialog"/);
  });

  it("declares one shortcut per top-level nav destination", () => {
    const destinations = [
      "/desk",
      "/desk/discover",
      "/desk/registry",
      "/desk/deals",
      "/desk/compliance",
      "/desk/billing",
      "/desk/settings",
    ];
    for (const to of destinations) {
      expect(sidebar).toMatch(new RegExp(`to:\\s*"${to.replace(/\//g, "\\/")}"`));
    }
    // All shortcut keys are single lowercase characters and unique.
    const keys = [...sidebar.matchAll(/shortcut:\s*"([a-z])"/g)].map((m) => m[1]);
    expect(keys.length).toBe(destinations.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("hook ignores shortcuts while the user is typing", () => {
    expect(hook).toMatch(/isTypingTarget/);
    expect(hook).toMatch(/INPUT/);
    expect(hook).toMatch(/TEXTAREA/);
    expect(hook).toMatch(/isContentEditable/);
  });

  it("hook ignores shortcuts when a modifier key is held", () => {
    expect(hook).toMatch(/metaKey \|\| e\.ctrlKey \|\| e\.altKey/);
  });

  it('hook opens the cheatsheet on "?"', () => {
    expect(hook).toMatch(/e\.key === "\?"/);
  });

  it("hook implements a two-key 'g' then destination sequence", () => {
    expect(hook).toMatch(/armedRef/);
    expect(hook).toMatch(/"g"/);
  });

  it("cheatsheet dialog renders a kbd legend per shortcut", () => {
    expect(dialog).toMatch(/DialogTitle/);
    expect(dialog).toMatch(/<Kbd>g<\/Kbd>/);
    expect(dialog).toMatch(/shortcuts\.map/);
  });
});
