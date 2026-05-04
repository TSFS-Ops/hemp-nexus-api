const URL_PATH_UNSAFE_CHARS = /[/\\:*?"<>|\x00-\x1f#%&=+;@[\]{}^`]/g;

/**
 * Keep browser storage object paths URL-safe.
 *
 * Supabase storage uploads are sent through a URL path, so characters such as
 * `#` are interpreted as URL fragments before they reach storage. That creates
 * a blob at a truncated path and the follow-up validation / DB insert then
 * fails. Preserve readable filenames while removing URL-control characters.
 */
export function sanitizeStorageFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(URL_PATH_UNSAFE_CHARS, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255)
    .replace(/^\.+$/, "_");

  return cleaned || "document";
}