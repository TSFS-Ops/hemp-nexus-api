/**
 * File Download Utilities
 * 
 * Centralised helpers for generating and downloading files.
 * Replaces duplicated blob/anchor logic across the codebase.
 */

/**
 * Escape a CSV cell value, handling quotes and special characters
 */
function escapeCSVCell(value: unknown): string {
  const str = String(value ?? '');
  // If contains comma, quote, or newline, wrap in quotes and escape inner quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV content from headers and rows
 */
export function generateCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCSVCell).join(',');
  const dataLines = rows.map(row => row.map(escapeCSVCell).join(','));
  return [headerLine, ...dataLines].join('\n');
}

/**
 * Download content as a file
 */
export function downloadFile(
  content: string | Blob,
  filename: string,
  mimeType: string = 'text/plain'
): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up to prevent memory leaks
  URL.revokeObjectURL(url);
}

/**
 * Download data as CSV file
 */
export function downloadCSV(
  headers: string[],
  rows: (string | number | null | undefined)[][],
  filename: string
): void {
  const csv = generateCSV(headers, rows);
  downloadFile(csv, filename, 'text/csv;charset=utf-8;');
}

/**
 * Download data as JSON file
 */
export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, filename, 'application/json');
}

/**
 * Generate a timestamped filename
 */
export function timestampedFilename(prefix: string, extension: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `${prefix}-${date}.${extension}`;
}
