/**
 * Magic-byte validation for uploaded files.
 * Inspects the first N bytes to determine actual MIME type,
 * independent of client-reported Content-Type.
 */

interface MagicSignature {
  mime: string;
  bytes: number[];
  offset?: number;
}

const SIGNATURES: MagicSignature[] = [
  // PDF
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  // PNG
  { mime: "image/png", bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  // JPEG
  { mime: "image/jpeg", bytes: [0xFF, 0xD8, 0xFF] },
  // GIF (blocked - included for detection)
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // ZIP (also DOCX, XLSX, PPTX)
  { mime: "application/zip", bytes: [0x50, 0x4B, 0x03, 0x04] },
  // DOCX/XLSX/PPTX are ZIP-based - detected as zip then refined
  // TIFF (little-endian)
  { mime: "image/tiff", bytes: [0x49, 0x49, 0x2A, 0x00] },
  // TIFF (big-endian)
  { mime: "image/tiff", bytes: [0x4D, 0x4D, 0x00, 0x2A] },
  // BMP
  { mime: "image/bmp", bytes: [0x42, 0x4D] },
  // WebP
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  // XML (for SVG detection - <?xml)
  { mime: "text/xml", bytes: [0x3C, 0x3F, 0x78, 0x6D, 0x6C] },
];

/** MIME types explicitly blocked from upload */
const BLOCKED_MIMES = new Set([
  "image/gif",
  "application/x-msdownload",    // .exe
  "application/x-msdos-program", // .exe variant
  "application/x-sh",            // shell scripts
  "text/html",                   // prevent HTML injection
]);

/** MIME types allowed for document uploads */
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/bmp",
  "image/webp",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",     // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",           // .xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",   // .pptx
  "application/msword",          // .doc
  "application/vnd.ms-excel",    // .xls
  "text/csv",
  "text/plain",
]);

export interface MagicByteResult {
  detectedMime: string | null;
  clientMimeMatch: boolean;
  blocked: boolean;
  blockReason?: string;
  /** Batch L DOC-002: structural readability verdict for known formats. */
  readable?: boolean;
  unreadableReason?: string;
}

/**
 * Batch L DOC-002: lightweight structural readability check on the FULL file
 * bytes. Currently:
 *  - PDF: requires `%PDF-` header AND `%%EOF` somewhere in the last 2 KB.
 *  - PNG/JPEG: requires their canonical end-of-stream marker.
 *  - Other types: returns { readable: true } (no deep parse performed).
 *
 * This is intentionally conservative — it catches truncated/corrupt files
 * that pass the 16-byte header check, without attempting full parsing.
 */
export function inspectStructuralReadability(
  fullBytes: Uint8Array,
  detectedOrClientMime: string,
): { readable: boolean; reason?: string } {
  const mime = (detectedOrClientMime || "").toLowerCase();

  if (mime === "application/pdf") {
    // %PDF- header
    if (
      fullBytes.length < 5 ||
      fullBytes[0] !== 0x25 || fullBytes[1] !== 0x50 ||
      fullBytes[2] !== 0x44 || fullBytes[3] !== 0x46 ||
      fullBytes[4] !== 0x2D
    ) {
      return { readable: false, reason: "PDF header missing or corrupt" };
    }
    // %%EOF in last 2 KB
    const tailSize = Math.min(2048, fullBytes.length);
    const tail = fullBytes.subarray(fullBytes.length - tailSize);
    // Scan for %%EOF (0x25 0x25 0x45 0x4F 0x46)
    let found = false;
    for (let i = 0; i <= tail.length - 5; i++) {
      if (
        tail[i] === 0x25 && tail[i + 1] === 0x25 &&
        tail[i + 2] === 0x45 && tail[i + 3] === 0x4F && tail[i + 4] === 0x46
      ) { found = true; break; }
    }
    if (!found) {
      return { readable: false, reason: "PDF trailer (%%EOF) missing — file is truncated or corrupt" };
    }
    return { readable: true };
  }

  if (mime === "image/png") {
    // PNG ends with IEND chunk: 0x49 0x45 0x4E 0x44 0xAE 0x42 0x60 0x82
    if (fullBytes.length < 12) return { readable: false, reason: "PNG too small to be valid" };
    const tail = fullBytes.subarray(fullBytes.length - 8);
    const iendOk =
      tail[0] === 0x49 && tail[1] === 0x45 && tail[2] === 0x4E && tail[3] === 0x44 &&
      tail[4] === 0xAE && tail[5] === 0x42 && tail[6] === 0x60 && tail[7] === 0x82;
    if (!iendOk) return { readable: false, reason: "PNG IEND marker missing — file is truncated" };
    return { readable: true };
  }

  if (mime === "image/jpeg") {
    // JPEG ends with FFD9 (EOI marker)
    if (fullBytes.length < 4) return { readable: false, reason: "JPEG too small to be valid" };
    const last = fullBytes.length - 1;
    if (!(fullBytes[last - 1] === 0xFF && fullBytes[last] === 0xD9)) {
      return { readable: false, reason: "JPEG EOI (FFD9) marker missing — file is truncated" };
    }
    return { readable: true };
  }

  // Office / ZIP / text / other: no deep structural validation
  return { readable: true };
}

/**
 * Detect MIME type from raw file bytes (first 16 bytes minimum).
 * Returns null if no signature matches - falls back to client MIME.
 */
export function detectMimeFromBytes(headerBytes: Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (headerBytes.length < offset + sig.bytes.length) continue;

    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (headerBytes[offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return sig.mime;
  }

  // Check for ZIP-based Office formats by looking deeper
  // (ZIP signature already detected - refinement happens via client MIME)
  return null;
}

/**
 * Validate uploaded file content against client-reported MIME.
 */
export function validateMagicBytes(
  headerBytes: Uint8Array,
  clientMime: string,
  fileSize: number,
): MagicByteResult {
  const MAX_SIZE = 20 * 1024 * 1024; // 20MB hard limit

  // Size check
  if (fileSize > MAX_SIZE) {
    return {
      detectedMime: null,
      clientMimeMatch: false,
      blocked: true,
      blockReason: `File exceeds maximum size of 20MB (${(fileSize / 1024 / 1024).toFixed(1)}MB)`,
    };
  }

  const detectedMime = detectMimeFromBytes(headerBytes);

  // If detected MIME is blocked, reject
  if (detectedMime && BLOCKED_MIMES.has(detectedMime)) {
    return {
      detectedMime,
      clientMimeMatch: false,
      blocked: true,
      blockReason: `File type ${detectedMime} is not allowed`,
    };
  }

  // If client-reported MIME is blocked, reject
  if (BLOCKED_MIMES.has(clientMime)) {
    return {
      detectedMime,
      clientMimeMatch: false,
      blocked: true,
      blockReason: `File type ${clientMime} is not allowed`,
    };
  }

  // Check if detected MIME matches client MIME (or is compatible)
  let clientMimeMatch = true;
  if (detectedMime) {
    // ZIP-based formats: client says docx/xlsx but magic says zip - that's fine
    if (detectedMime === "application/zip" && clientMime.includes("openxmlformats")) {
      clientMimeMatch = true;
    } else if (detectedMime !== clientMime) {
      clientMimeMatch = false;
    }
  }

  // If detected MIME is not in allowed list, flag but don't block
  // (text files and CSVs won't have magic bytes)
  const isAllowed = !detectedMime || ALLOWED_MIMES.has(detectedMime) || ALLOWED_MIMES.has(clientMime);

  return {
    detectedMime,
    clientMimeMatch,
    blocked: !isAllowed,
    blockReason: !isAllowed ? `File type ${detectedMime || clientMime} is not in the allowed list` : undefined,
  };
}
