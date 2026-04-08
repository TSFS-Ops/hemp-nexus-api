## Multi-Jurisdiction WaD Path - Implementation Plan

### What we're building
The deterministic three-branch jurisdiction rule that David confirmed, which governs how the platform selects the documentary/WaD path when multiple jurisdiction signals are present.

### Step 1: Jurisdiction Signal Derivation
- Create `src/lib/modules/jurisdiction/` module
- Derive jurisdiction signals from available pre-POI data:
  - Entity `jurisdiction_code` (buyer + seller from `entities` table)
  - Trade order location (from `trade_orders`)
  - Match metadata (origin/destination if present)
- Return a deduplicated list of "surfaced jurisdictions" with signal source labels

### Step 2: Database - Jurisdiction Selection Table
- Add `jurisdiction_selections` table to record the user's choice with:
  - `match_id`, `selected_jurisdiction`, `surfaced_jurisdictions` (JSONB), `selection_method` (auto/user_choice/escalated), `escalation_reason`, `selected_by`
- This provides the audit trail David requires

### Step 3: Three-Branch Logic
- **Branch 1**: If exactly one unique jurisdiction signal → auto-select, record as `auto`
- **Branch 2**: If multiple signals → show chooser UI (user picks from surfaced set only)
- **Branch 3**: If chosen jurisdiction isn't in surfaced set OR no governance rules exist for it → block WaD, flag for manual governance review

### Step 4: WaD Integration
- Wire the jurisdiction selector into the WaD flow (before WaD creation)
- WaD creation checks `jurisdiction_selections` for a valid, non-escalated selection
- Governance doc lookup uses the selected jurisdiction instead of hardcoded ZA

### Step 5: Jurisdiction Chooser UI
- Add a `JurisdictionSelector` component to the WaD tab
- Shows surfaced jurisdictions with source labels
- Validates against governance_doc_registry before accepting
- Escalation state shows "Pending Governance Review" banner

### Files touched
- **New**: `src/lib/modules/jurisdiction/index.ts` (derivation + three-branch logic)
- **New**: `src/components/wad/JurisdictionSelector.tsx` (chooser UI)
- **Modified**: `src/components/wad/WadModule.tsx` (wire jurisdiction gate)
- **Migration**: `jurisdiction_selections` table with RLS
