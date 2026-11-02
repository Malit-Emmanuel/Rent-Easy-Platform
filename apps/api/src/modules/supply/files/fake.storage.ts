import { createHash } from 'crypto';
import { SignedUpload, StoragePort, StoredHead } from './storage.port';

/** In-memory storage for development and tests. `put` plays the part of the browser uploading to the signed link. */
export class FakeStorage implements StoragePort {
  readonly name = 'fake';
  readonly objects = new Map<string, Uint8Array>();
  put(path: string, bytes: Uint8Array) { this.objects.set(path, bytes); }
  async createSignedUpload(path: string, mimeType: string): Promise<SignedUpload> {
    return { url: `https://fake-storage.invalid/upload/${path}`, method: 'PUT', headers: { 'content-type': mimeType }, expiresInSec: 7200 };
  }
  async head(path: string, bytes: number): Promise<StoredHead | null> {
    const o = this.objects.get(path); return o ? { size: o.length, firstBytes: o.slice(0, bytes) } : null;
  }
  async createSignedDownload(path: string, ttlSec: number, downloadName?: string) {
    return `https://fake-storage.invalid/download/${path}?ttl=${ttlSec}${downloadName ? `&name=${encodeURIComponent(downloadName)}` : ''}`;
  }
  async sha256(path: string) { const o = this.objects.get(path); return o ? createHash('sha256').update(o).digest() : null; }
  async remove(path: string) { this.objects.delete(path); }
}
