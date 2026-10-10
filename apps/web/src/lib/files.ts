// Browser-side helpers for uploading files. The server is the authority on every rule here; these checks only save the user a wasted upload.
export type FileKind = 'document' | 'photo' | 'video';
const MB = 1024 * 1024;
export const LIMITS: Record<FileKind, { maxBytes: number; mimes: string[]; accept: string }> = {
  document: { maxBytes: 10 * MB, mimes: ['application/pdf', 'image/jpeg', 'image/png'], accept: 'application/pdf,image/jpeg,image/png' },
  photo:    { maxBytes: 8 * MB,  mimes: ['image/jpeg', 'image/png', 'image/webp'],       accept: 'image/jpeg,image/png,image/webp' },
  video:    { maxBytes: 45 * MB, mimes: ['video/mp4', 'video/quicktime', 'video/webm'],  accept: 'video/mp4,video/quicktime,video/webm' },
};

/** Largest side becomes `max`; smaller pictures are left alone. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const scale = max / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** Quick checks before uploading. Returns the i18n key of the problem, or null. */
export function preCheck(kind: FileKind, mime: string, size: number): 'err_wrongType' | 'err_tooLarge' | null {
  if (!LIMITS[kind].mimes.includes(mime)) return 'err_wrongType';
  if (size > LIMITS[kind].maxBytes) return 'err_tooLarge';
  return null;
}

/** Maps a server answer to the message the person should see. */
export function requestError(status: number): string {
  switch (status) {
    case 400: return 'err_invalid';
    case 404: return 'err_notFound';
    case 409: return 'err_limit';
    case 502: return 'err_storageDown';
    case 503: return 'err_storageOff';
    default: return 'genericError';
  }
}
export const completeError = (status: number) => (status === 422 ? 'err_rejected' : status === 409 ? 'err_uploadFailed' : status === 503 ? 'err_storageOff' : 'genericError');

/** Photos are shrunk before upload (saves mobile data). Anything that cannot be shrunk is uploaded as it is. */
export async function shrinkPhoto(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const { width, height } = fitWithin(bmp.width, bmp.height, maxSide);
    if (width === bmp.width && height === bmp.height && file.size < 1.5 * MB) { bmp.close?.(); return file; }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height); bmp.close?.();
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}
