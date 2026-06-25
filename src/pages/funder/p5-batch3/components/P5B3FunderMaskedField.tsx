/**
 * P-5 Batch 3 — Stage 5 funder-safe masked field.
 *
 * Funder surfaces never reveal raw bank/ID/passport values. Reveal is not
 * offered. The value is shown masked or as "—" when absent.
 */
import { maskBankAccount } from "@/lib/p5-batch3/visibility";

export interface P5B3FunderMaskedFieldProps {
  label: string;
  maskedValue: string | null | undefined;
}

export function P5B3FunderMaskedField({ label, maskedValue }: P5B3FunderMaskedFieldProps) {
  // Server already masks; we mask again defensively in case raw ever leaks.
  const display = maskedValue ? maskBankAccount(maskedValue) : "";
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="p5b3-funder-masked-field">
      <span className="font-medium text-foreground">{label}:</span>
      <span className="font-mono text-foreground">{display || "—"}</span>
    </div>
  );
}
