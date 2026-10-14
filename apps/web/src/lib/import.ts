export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Quick check before reading a file in the browser. The server checks again. Returns an i18n key or null. */
export function fileProblem(name: string, size: number): 'err_notCsv' | 'err_fileTooBig' | null {
  if (!/\.(csv|txt)$/i.test(name)) return 'err_notCsv';
  if (size > MAX_IMPORT_BYTES) return 'err_fileTooBig';
  return null;
}

export interface Issue { row: number; column?: string; severity: 'error' | 'warning'; code: string; message: string }

/** Errors first, then warnings, each in row order. */
export function orderIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => (a.severity === b.severity ? a.row - b.row : a.severity === 'error' ? -1 : 1));
}

/** Maps a server answer for the confirm step to a message key. */
export function commitError(status: number): string {
  return status === 409 ? 'err_importState' : status === 429 ? 'tooMany' : status === 403 ? 'noAccess' : 'importFailed';
}
