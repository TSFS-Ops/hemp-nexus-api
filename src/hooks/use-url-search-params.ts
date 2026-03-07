import { useSearchParams } from "react-router-dom";
import { useCallback, useMemo } from "react";

/**
 * Manages multiple search/filter/sort/page URL params in one hook.
 *
 * Usage:
 *   const { params, setParam, setParams, resetParams } = useUrlListParams({
 *     q: "",
 *     status: "all",
 *     sort: "created_at",
 *     page: "0",
 *   });
 */
export function useUrlListParams<T extends Record<string, string>>(
  defaults: T,
): {
  params: T;
  setParam: (key: keyof T, value: string) => void;
  setParams: (updates: Partial<T>) => void;
  resetParams: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const urlVal = searchParams.get(key as string);
      if (urlVal != null) {
        (result as any)[key] = urlVal;
      }
    }
    return result;
  }, [searchParams, defaults]);

  const setParam = useCallback(
    (key: keyof T, value: string) => {
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (value === defaults[key]) {
            updated.delete(key as string);
          } else {
            updated.set(key as string, value);
          }
          // Reset page when changing filters
          if (key !== "page" && updated.has("page")) {
            updated.delete("page");
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaults],
  );

  const setParams = useCallback(
    (updates: Partial<T>) => {
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === defaults[key as keyof T]) {
              updated.delete(key);
            } else {
              updated.set(key, value as string);
            }
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaults],
  );

  const resetParams = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return { params, setParam, setParams, resetParams };
}
