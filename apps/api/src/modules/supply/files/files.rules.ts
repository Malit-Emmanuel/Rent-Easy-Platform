// Pure rules for uploaded files: what is allowed, how big, how many, and how names and paths are made.
export type FileKind = 'document' | 'photo' | 'video';
export const MB = 1024 * 1024;

export const KIND_RULES: Record<FileKind, { maxBytes: number; mimes: readonly string[]; maxPerScope: number }> = {
  document: { maxBytes: 10 * MB, mimes: ['application/pdf', 'image/jpeg', 'image/png'], maxPerScope: 10 },
  photo:    { maxBytes: 8 * MB,  mimes: ['image/jpeg', 'image/png', 'image/webp'],       maxPerScope: 20 },
  video:    { maxBytes: 45 * MB, mimes: ['video/mp4', 'video/quicktime', 'video/webm'],  maxPerScope: 3 },   // 45 MB: under the 50 MB cap of the free storage plan
};

const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};
export const extensionFor = (mime: string) => EXTENSION[mime];

export interface FileRequest { kind: FileKind; docType?: string; unitId?: string; originalName?: string; mimeType: string; sizeBytes: number }
export interface Checked<T> { value: T; errors: string[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For display only. Never used to build a path. Strips path characters and control characters. */
export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  return n || undefined;
}

export function checkFileRequest(body: any): Checked<FileRequest> {
  const errors: string[] = []; const b = body && typeof body === 'object' ? body : {};
  const kind = b.kind as FileKind;
  if (!(kind in KIND_RULES)) return { value: {} as FileRequest, errors: ['kind must be document, photo or video'] };
  const rule = KIND_RULES[kind];
  if (typeof b.mimeType !== 'string' || !rule.mimes.includes(b.mimeType)) errors.push(`a ${kind} must be one of: ${rule.mimes.join(', ')}`);
  if (!Number.isInteger(b.sizeBytes) || b.sizeBytes <= 0) errors.push('sizeBytes must be a positive whole number');
  else if (b.sizeBytes > rule.maxBytes) errors.push(`a ${kind} can be at most ${Math.round(rule.maxBytes / MB)} MB`);
  if (kind === 'document') {
    if (typeof b.docType !== 'string' || !b.docType) errors.push('docType is required for a document');
    if (b.unitId !== undefined && b.unitId !== null) errors.push('documents belong to the property, not a unit');
  } else if (b.docType !== undefined && b.docType !== null) errors.push('docType is only for documents');
  if (b.unitId !== undefined && b.unitId !== null && (typeof b.unitId !== 'string' || !UUID.test(b.unitId))) errors.push('unitId must be a valid id');
  return { value: { kind, docType: kind === 'document' ? b.docType : undefined, unitId: b.unitId ?? undefined, originalName: cleanName(b.originalName), mimeType: b.mimeType, sizeBytes: b.sizeBytes }, errors };
}

/** The storage path is built only from ids we generated and an extension we chose, never from anything the user typed. */
export function storagePath(orgId: string, propertyId: string, fileId: string, mime: string): string {
  const ext = extensionFor(mime);
  if (!ext) throw new Error('unsupported mime type');
  return `org/${orgId}/property/${propertyId}/${fileId}.${ext}`;
}
