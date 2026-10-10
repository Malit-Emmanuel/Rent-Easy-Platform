export const STORAGE_PORT = Symbol('STORAGE_PORT');

export interface SignedUpload { url: string; method: 'PUT'; headers: Record<string, string>; expiresInSec: number }
export interface StoredHead { size: number; firstBytes: Uint8Array }

/** Where file bytes live. Our API only ever hands out time-limited links and inspects the first bytes; it never proxies files. */
export interface StoragePort {
  readonly name: string;
  createSignedUpload(path: string, mimeType: string): Promise<SignedUpload>;
  /** Total size and the first `bytes` bytes, or null if the object does not exist (yet). */
  head(path: string, bytes: number): Promise<StoredHead | null>;
  createSignedDownload(path: string, ttlSec: number, downloadName?: string): Promise<string>;
  remove(path: string): Promise<void>;
}
