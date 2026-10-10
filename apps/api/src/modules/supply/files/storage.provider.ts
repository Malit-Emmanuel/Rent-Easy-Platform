import { isProductionEnv } from '../../../config/env';
import { FakeStorage } from './fake.storage';
import { StoragePort } from './storage.port';
import { SupabaseStorage } from './supabase.storage';

/** Chooses the storage backend from the environment. Returns null when nothing is configured: file features then switch off, safely. */
export function buildStorage(env: NodeJS.ProcessEnv = process.env): StoragePort | null {
  if (env.STORAGE_DRIVER === 'fake') {
    if (isProductionEnv(env)) throw new Error('The fake storage driver cannot run in production');
    return new FakeStorage();
  }
  const url = env.SUPABASE_URL, key = env.SUPABASE_SECRET_KEY;
  if (url && key) return new SupabaseStorage({ url, key, bucket: env.SUPABASE_STORAGE_BUCKET || 'property-files' });
  return null;
}
