import { useSearchParams } from "react-router-dom";
import { useCallback } from "react";

/**
 * Syncs Radix Tabs state to a URL query parameter.
 *
 * Usage:
 *   const [tab, setTab] = useUrlTab("tab", "details");
 *   <Tabs value={tab} onValueChange={setTab}>
 *
 * - Updates `?tab=value` on change (replaces history entry, no back-spam)
 * - Falls back to `defaultValue` when param is missing or not in `allowedValues`
 */
export function useUrlTab(
  paramName: string = "tab",
  defaultValue: string,
  allowedValues?: string[],
): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawValue = searchParams.get(paramName);
  const isValid = rawValue != null && (!allowedValues || allowedValues.includes(rawValue));
  const value = isValid ? rawValue! : defaultValue;

  const setValue = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next === defaultValue) {
            updated.delete(paramName);
          } else {
            updated.set(paramName, next);
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams, paramName, defaultValue],
  );

  return [value, setValue];
}
