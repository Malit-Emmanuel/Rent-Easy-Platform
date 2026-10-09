import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { PropertyInput, UnitInput } from './supply.validation';

const PROPERTY_SELECT = `
  SELECT p.id, p.name, p.address_text AS "addressText", p.node_id AS "nodeId", n.name AS "nodeName",
         CASE WHEN p.location IS NULL THEN NULL ELSE extensions.st_y(p.location::extensions.geometry) END AS latitude,
         CASE WHEN p.location IS NULL THEN NULL ELSE extensions.st_x(p.location::extensions.geometry) END AS longitude,
         (SELECT count(*) FROM supply.units u WHERE u.property_id = p.id AND u.archived_at IS NULL)::int AS "unitCount",
         p.created_at AS "createdAt"
    FROM supply.properties p LEFT JOIN supply.nodes n ON n.id = p.node_id`;

/** Every query below is locked to the organisation in the URL, so one organisation can never reach another's records by guessing ids. */
@Injectable()
export class SupplyService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService) {}

  private translate(e: any): never {
    if (e?.code === '23505') throw new ConflictException(e.constraint?.includes('units') ? 'A unit with this label already exists in this property' : 'This property is already recorded for your organisation');
    if (e?.code === '23514') throw new BadRequestException('The position must be inside Kenya');
    if (e?.code === '23503') throw new BadRequestException('Unknown node');
    throw e;
  }

  async nodes() { return (await this.pool.query('SELECT id, name FROM supply.nodes ORDER BY name')).rows; }

  // ---------- properties ----------
  async listProperties(orgId: string, limit: number) {
    return (await this.pool.query(`${PROPERTY_SELECT} WHERE p.org_id=$1 AND p.archived_at IS NULL ORDER BY lower(p.name), p.id LIMIT $2`, [orgId, limit])).rows;
  }

  async getProperty(orgId: string, propertyId: string) {
    const r = await this.pool.query(`${PROPERTY_SELECT} WHERE p.id=$1 AND p.org_id=$2 AND p.archived_at IS NULL`, [propertyId, orgId]);
    if (!r.rows[0]) throw new NotFoundException('Property not found');
    return r.rows[0];
  }

  async createProperty(orgId: string, actorId: string, v: PropertyInput) {
    const hasPos = typeof v.latitude === 'number' && typeof v.longitude === 'number';
    let id: string;
    try {
      const r = await this.pool.query(
        `INSERT INTO supply.properties (org_id, node_id, name, address_text, location)
         VALUES ($1,$2,$3,$4, CASE WHEN $5::float8 IS NULL THEN NULL ELSE extensions.st_point($5::float8, $6::float8)::extensions.geography END)
         RETURNING id`, [orgId, v.nodeId ?? null, v.name, v.addressText, hasPos ? v.longitude : null, hasPos ? v.latitude : null]);
      id = r.rows[0].id;
    } catch (e) { this.translate(e); }
    await this.audit.record({ actorId, action: 'property.created', subjectType: 'property', subjectId: id!, metadata: { orgId } });
    return this.getProperty(orgId, id!);
  }

  async updateProperty(orgId: string, propertyId: string, actorId: string, v: PropertyInput) {
    const sets: string[] = []; const vals: unknown[] = [propertyId, orgId]; let i = 3;
    if ('name' in v) { sets.push(`name=$${i++}`); vals.push(v.name); }
    if ('addressText' in v) { sets.push(`address_text=$${i++}`); vals.push(v.addressText); }
    if ('nodeId' in v) { sets.push(`node_id=$${i++}`); vals.push(v.nodeId); }
    if ('latitude' in v) {
      if (v.latitude === null) sets.push('location=NULL');
      else { sets.push(`location=extensions.st_point($${i++}::float8, $${i++}::float8)::extensions.geography`); vals.push(v.longitude, v.latitude); }
    }
    sets.push('updated_at=now()');
    try {
      const r = await this.pool.query(`UPDATE supply.properties SET ${sets.join(', ')} WHERE id=$1 AND org_id=$2 AND archived_at IS NULL RETURNING id`, vals);
      if (!r.rows[0]) throw new NotFoundException('Property not found');
    } catch (e) { if (e instanceof NotFoundException) throw e; this.translate(e); }
    await this.audit.record({ actorId, action: 'property.updated', subjectType: 'property', subjectId: propertyId, metadata: { orgId, fields: Object.keys(v) } });
    return this.getProperty(orgId, propertyId);
  }

  /** Archives the property and all its units together. Nothing is deleted. */
  async archiveProperty(orgId: string, propertyId: string, actorId: string) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(`UPDATE supply.properties SET archived_at=now(), updated_at=now() WHERE id=$1 AND org_id=$2 AND archived_at IS NULL RETURNING id`, [propertyId, orgId]);
      if (!r.rows[0]) { await c.query('ROLLBACK'); throw new NotFoundException('Property not found'); }
      await c.query(`UPDATE supply.units SET archived_at=now(), updated_at=now() WHERE property_id=$1 AND archived_at IS NULL`, [propertyId]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    await this.audit.record({ actorId, action: 'property.archived', subjectType: 'property', subjectId: propertyId, metadata: { orgId } });
  }

  // ---------- units ----------
  private async assertProperty(orgId: string, propertyId: string) {
    const r = await this.pool.query('SELECT 1 FROM supply.properties WHERE id=$1 AND org_id=$2 AND archived_at IS NULL', [propertyId, orgId]);
    if (!r.rowCount) throw new NotFoundException('Property not found');
  }

  async listUnits(orgId: string, propertyId: string, limit: number) {
    await this.assertProperty(orgId, propertyId);
    return (await this.pool.query(
      `SELECT id, label, bedrooms, created_at AS "createdAt" FROM supply.units WHERE property_id=$1 AND archived_at IS NULL ORDER BY lower(label), id LIMIT $2`, [propertyId, limit])).rows;
  }

  async createUnit(orgId: string, propertyId: string, actorId: string, v: UnitInput) {
    await this.assertProperty(orgId, propertyId);
    let row: any;
    try {
      row = (await this.pool.query(`INSERT INTO supply.units (property_id, label, bedrooms) VALUES ($1,$2,$3) RETURNING id, label, bedrooms, created_at AS "createdAt"`, [propertyId, v.label, v.bedrooms])).rows[0];
    } catch (e) { this.translate(e); }
    await this.audit.record({ actorId, action: 'unit.created', subjectType: 'unit', subjectId: row.id, metadata: { orgId, propertyId } });
    return row;
  }

  async updateUnit(orgId: string, propertyId: string, unitId: string, actorId: string, v: UnitInput) {
    await this.assertProperty(orgId, propertyId);
    const sets: string[] = []; const vals: unknown[] = [unitId, propertyId]; let i = 3;
    if ('label' in v) { sets.push(`label=$${i++}`); vals.push(v.label); }
    if ('bedrooms' in v) { sets.push(`bedrooms=$${i++}`); vals.push(v.bedrooms); }
    sets.push('updated_at=now()');
    let row: any;
    try {
      row = (await this.pool.query(`UPDATE supply.units SET ${sets.join(', ')} WHERE id=$1 AND property_id=$2 AND archived_at IS NULL RETURNING id, label, bedrooms, created_at AS "createdAt"`, vals)).rows[0];
    } catch (e) { this.translate(e); }
    if (!row) throw new NotFoundException('Unit not found');
    await this.audit.record({ actorId, action: 'unit.updated', subjectType: 'unit', subjectId: unitId, metadata: { orgId, propertyId, fields: Object.keys(v) } });
    return row;
  }

  async archiveUnit(orgId: string, propertyId: string, unitId: string, actorId: string) {
    await this.assertProperty(orgId, propertyId);
    const r = await this.pool.query(`UPDATE supply.units SET archived_at=now(), updated_at=now() WHERE id=$1 AND property_id=$2 AND archived_at IS NULL RETURNING id`, [unitId, propertyId]);
    if (!r.rows[0]) throw new NotFoundException('Unit not found');
    await this.audit.record({ actorId, action: 'unit.archived', subjectType: 'unit', subjectId: unitId, metadata: { orgId, propertyId } });
  }
}
