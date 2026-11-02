import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../../audit/audit.service';
import { FileRequest, KIND_RULES, storagePath } from './files.rules';
import { sniffMime } from './sniff';
import { STORAGE_PORT, StoragePort } from './storage.port';

const LINK_TTL_SEC = 300;       // a file link works for 5 minutes
const PENDING_GRACE = '3 hours'; // an upload that never completes stops counting after this
const PUBLIC = `id, kind, doc_type AS "docType", unit_id AS "unitId", original_name AS "originalName", mime_type AS "mimeType", size_bytes::int AS "sizeBytes", created_at AS "createdAt"`;

/** Every query is locked to the organisation and property in the URL. Bytes never pass through this service. */
@Injectable()
export class FilesService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService, @Inject(STORAGE_PORT) private storage: StoragePort | null) {}

  private store(): StoragePort {
    if (!this.storage) throw new ServiceUnavailableException('File storage is not configured');
    return this.storage;
  }
  private async assertProperty(orgId: string, propertyId: string) {
    const r = await this.pool.query('SELECT 1 FROM supply.properties WHERE id=$1 AND org_id=$2 AND archived_at IS NULL', [propertyId, orgId]);
    if (!r.rowCount) throw new NotFoundException('Property not found');
  }

  async documentTypes() { return (await this.pool.query('SELECT code, description FROM supply.document_types ORDER BY code')).rows; }

  /** Step 1: check permission and limits, record a pending file, and hand back a one-time upload link. */
  async requestUpload(orgId: string, propertyId: string, actorId: string, req: FileRequest) {
    const store = this.store();
    await this.assertProperty(orgId, propertyId);
    if (req.unitId) {
      const u = await this.pool.query('SELECT 1 FROM supply.units WHERE id=$1 AND property_id=$2 AND archived_at IS NULL', [req.unitId, propertyId]);
      if (!u.rowCount) throw new NotFoundException('Unit not found');
    }
    const id = randomUUID(), path = storagePath(orgId, propertyId, id, req.mimeType);
    const c = await this.pool.connect(); let row: any;
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [propertyId]);   // two uploads at once cannot both slip under the limit
      const n = (await c.query(
        `SELECT count(*)::int n FROM supply.files WHERE property_id=$1 AND kind=$2 AND unit_id IS NOT DISTINCT FROM $3::uuid
            AND (status='ready' OR (status='pending' AND created_at > now() - interval '${PENDING_GRACE}'))
            AND NOT EXISTS (SELECT 1 FROM verification.t2_takes t WHERE t.file_id = supply.files.id)`, [propertyId, req.kind, req.unitId ?? null])).rows[0].n;
      if (n >= KIND_RULES[req.kind].maxPerScope) throw new ConflictException(`The limit of ${KIND_RULES[req.kind].maxPerScope} ${req.kind}s here has been reached`);
      row = (await c.query(
        `INSERT INTO supply.files (id, org_id, property_id, unit_id, kind, doc_type, storage_path, original_name, mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${PUBLIC}`,
        [id, orgId, propertyId, req.unitId ?? null, req.kind, req.docType ?? null, path, req.originalName ?? null, req.mimeType, req.sizeBytes, actorId])).rows[0];
      await c.query('COMMIT');
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      if (e?.code === '23503') throw new BadRequestException('Unknown document type');
      throw e;
    } finally { c.release(); }
    try {
      const upload = await store.createSignedUpload(path, req.mimeType);
      return { file: row, upload };
    } catch {
      await this.pool.query(`UPDATE supply.files SET status='rejected', reject_reason='storage_unavailable' WHERE id=$1`, [id]);
      throw new BadGatewayException('File storage is unavailable. Please try again.');
    }
  }

  private async reject(row: any, reason: string, message: string, actorId: string): Promise<never> {
    await this.storage?.remove(row.storage_path).catch(() => {});
    await this.pool.query(`UPDATE supply.files SET status='rejected', reject_reason=$2 WHERE id=$1`, [row.id, reason]);
    await this.audit.record({ actorId, action: 'file.rejected', subjectType: 'file', subjectId: row.id, metadata: { reason, kind: row.kind } });
    throw new UnprocessableEntityException(message);
  }

  /** Step 2: after the browser uploads, check that what arrived is what was declared; otherwise delete it. */
  async complete(orgId: string, propertyId: string, fileId: string, actorId: string) {
    const store = this.store();
    const row = (await this.pool.query(`SELECT * FROM supply.files WHERE id=$1 AND org_id=$2 AND property_id=$3 AND status='pending'`, [fileId, orgId, propertyId])).rows[0];
    if (!row) throw new NotFoundException('File not found');
    let head; try { head = await store.head(row.storage_path, 32); } catch { throw new BadGatewayException('File storage is unavailable. Please try again.'); }
    if (!head) throw new ConflictException('The upload has not arrived yet');
    if (head.size !== Number(row.size_bytes)) await this.reject(row, 'size_mismatch', 'The uploaded file is not the size that was declared. It has been removed.', actorId);
    if (sniffMime(head.firstBytes) !== row.mime_type) await this.reject(row, 'type_mismatch', 'The file content does not match its declared type. It has been removed.', actorId);
    const ok = await this.pool.query(`UPDATE supply.files SET status='ready', ready_at=now() WHERE id=$1 AND status='pending' RETURNING ${PUBLIC}`, [fileId]);
    await this.audit.record({ actorId, action: 'file.uploaded', subjectType: 'file', subjectId: fileId, metadata: { orgId, propertyId, kind: row.kind, unitId: row.unit_id } });
    return ok.rows[0];
  }

  /** `unitId` may be a unit id, 'none' (property-level only), or omitted (everything for the property). */
  async list(orgId: string, propertyId: string, unitId?: string) {
    await this.assertProperty(orgId, propertyId);
    const where = unitId === 'none' ? 'AND unit_id IS NULL' : unitId ? 'AND unit_id = $3' : '';
    const args: unknown[] = [orgId, propertyId]; if (unitId && unitId !== 'none') args.push(unitId);
    return (await this.pool.query(`SELECT ${PUBLIC} FROM supply.files WHERE org_id=$1 AND property_id=$2 AND status='ready' AND NOT EXISTS (SELECT 1 FROM verification.t2_takes t WHERE t.file_id = supply.files.id) ${where} ORDER BY created_at, id`, args)).rows;
  }

  /** A link that opens the file for 5 minutes. Every link handed out is written to the access log. */
  async link(orgId: string, propertyId: string, fileId: string, actorId: string) {
    const store = this.store();
    const row = (await this.pool.query(`SELECT id, kind, storage_path, original_name FROM supply.files WHERE id=$1 AND org_id=$2 AND property_id=$3 AND status='ready'`, [fileId, orgId, propertyId])).rows[0];
    if (!row) throw new NotFoundException('File not found');
    let url: string; try { url = await store.createSignedDownload(row.storage_path, LINK_TTL_SEC, row.kind === 'document' ? (row.original_name ?? 'document') : undefined); }
    catch { throw new BadGatewayException('File storage is unavailable. Please try again.'); }
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,$2,$3)`, [actorId, `file:${row.kind}`, `property ${propertyId} file ${fileId}`]);
    return { url, expiresInSec: LINK_TTL_SEC };
  }

  /** Marks the file as deleted. The stored object is kept until a retention rule is agreed with counsel. */
  async remove(orgId: string, propertyId: string, fileId: string, actorId: string) {
    const r = await this.pool.query(`UPDATE supply.files SET status='deleted', deleted_at=now() WHERE id=$1 AND org_id=$2 AND property_id=$3 AND status IN ('ready','pending') RETURNING kind`, [fileId, orgId, propertyId]);
    if (!r.rows[0]) throw new NotFoundException('File not found');
    await this.audit.record({ actorId, action: 'file.deleted', subjectType: 'file', subjectId: fileId, metadata: { orgId, propertyId, kind: r.rows[0].kind } });
  }
}
