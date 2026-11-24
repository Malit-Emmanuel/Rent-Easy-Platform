import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { addDays, ALLOWED, COST_KEYS, CostKey, CostsInput, HIDE_AFTER_DAYS, ListingStatus, missingCosts, OPEN, REMIND_AFTER_DAYS, totalMoveIn } from './listings.rules';

// One row per listing, with the five costs folded in (whole shillings; null until entered).
const LISTING_SELECT = `
  SELECT l.id, l.status, l.unit_id AS "unitId", u.label AS "unitLabel", u.bedrooms, u.floor,
         p.id AS "propertyId", p.name AS "propertyName", n.name AS "nodeName",
         l.published_at AS "publishedAt", l.last_confirmed_at AS "lastConfirmedAt", l.created_at AS "createdAt",
         (SELECT (c.amount_minor / 100)::float8 FROM supply.listing_costs c WHERE c.listing_id = l.id AND c.cost_type = 'rent') AS "rent",
         (SELECT (c.amount_minor / 100)::float8 FROM supply.listing_costs c WHERE c.listing_id = l.id AND c.cost_type = 'deposit') AS "deposit",
         (SELECT (c.amount_minor / 100)::float8 FROM supply.listing_costs c WHERE c.listing_id = l.id AND c.cost_type = 'utility_deposit') AS "utilityDeposit",
         (SELECT (c.amount_minor / 100)::float8 FROM supply.listing_costs c WHERE c.listing_id = l.id AND c.cost_type = 'service_charge') AS "serviceCharge",
         (SELECT (c.amount_minor / 100)::float8 FROM supply.listing_costs c WHERE c.listing_id = l.id AND c.cost_type = 'agent_fee') AS "agentFee"
    FROM supply.listings l
    JOIN supply.units u ON u.id = l.unit_id AND u.archived_at IS NULL
    JOIN supply.properties p ON p.id = u.property_id AND p.archived_at IS NULL
    LEFT JOIN supply.nodes n ON n.id = p.node_id`;

function shape(r: any) {
  const costs = { rent: r.rent, deposit: r.deposit, utilityDeposit: r.utilityDeposit, serviceCharge: r.serviceCharge, agentFee: r.agentFee };
  const { rent, deposit, utilityDeposit, serviceCharge, agentFee, ...rest } = r;
  const live = r.status === 'published' || r.status === 'stale';
  return {
    ...rest, costs, totalMoveIn: totalMoveIn(costs),
    remindAt: live && r.lastConfirmedAt ? addDays(new Date(r.lastConfirmedAt), REMIND_AFTER_DAYS) : null,
    hideAt: live && r.lastConfirmedAt ? addDays(new Date(r.lastConfirmedAt), HIDE_AFTER_DAYS) : null,
  };
}

/** Every query is locked to the organisation in the URL (through the property), as in the property service. */
@Injectable()
export class ListingsService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService) {}

  async list(orgId: string, opts: { status?: string; propertyId?: string; limit: number }) {
    const vals: unknown[] = [orgId]; let where = 'p.org_id = $1';
    if (opts.status) { vals.push(opts.status); where += ` AND l.status = $${vals.length}`; }
    if (opts.propertyId) { vals.push(opts.propertyId); where += ` AND p.id = $${vals.length}`; }
    vals.push(opts.limit);
    return (await this.pool.query(`${LISTING_SELECT} WHERE ${where} ORDER BY l.created_at DESC, l.id LIMIT $${vals.length}`, vals)).rows.map(shape);
  }

  async get(orgId: string, listingId: string) {
    const r = await this.pool.query(`${LISTING_SELECT} WHERE l.id = $1 AND p.org_id = $2`, [listingId, orgId]);
    if (!r.rows[0]) throw new NotFoundException('Listing not found');
    return shape(r.rows[0]);
  }

  async create(orgId: string, propertyId: string, unitId: string, actorId: string, costs: CostsInput | null) {
    const u = await this.pool.query(
      `SELECT 1 FROM supply.units u JOIN supply.properties p ON p.id = u.property_id
        WHERE u.id = $1 AND p.id = $2 AND p.org_id = $3 AND u.archived_at IS NULL AND p.archived_at IS NULL`, [unitId, propertyId, orgId]);
    if (!u.rowCount) throw new NotFoundException('Unit not found');
    const c = await this.pool.connect(); let id: string;
    try {
      await c.query('BEGIN');
      id = (await c.query(`INSERT INTO supply.listings (unit_id) VALUES ($1) RETURNING id`, [unitId])).rows[0].id;
      if (costs) await this.writeCosts(c, id, costs);
      await c.query('COMMIT');
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      if (e?.code === '23505') throw new ConflictException('This unit already has an open listing. Change or withdraw it first');
      throw e;
    } finally { c.release(); }
    await this.audit.record({ actorId, action: 'listing.created', subjectType: 'listing', subjectId: id, metadata: { orgId, propertyId, unitId } });
    return this.get(orgId, id);
  }

  private async writeCosts(c: { query: Pool['query'] }, listingId: string, v: CostsInput) {
    for (const k of Object.keys(v) as CostKey[]) {
      await c.query(
        `INSERT INTO supply.listing_costs (listing_id, cost_type, amount_minor) VALUES ($1,$2,$3)
         ON CONFLICT (listing_id, cost_type) DO UPDATE SET amount_minor = EXCLUDED.amount_minor`, [listingId, COST_KEYS[k], (v[k] as number) * 100]);
    }
  }

  private async state(orgId: string, listingId: string): Promise<ListingStatus> {
    const r = await this.pool.query(`SELECT l.status FROM supply.listings l JOIN supply.units u ON u.id = l.unit_id JOIN supply.properties p ON p.id = u.property_id WHERE l.id = $1 AND p.org_id = $2`, [listingId, orgId]);
    if (!r.rows[0]) throw new NotFoundException('Listing not found');
    return r.rows[0].status;
  }

  private need(action: keyof typeof ALLOWED, status: ListingStatus) {
    if (!ALLOWED[action].includes(status)) throw new ConflictException(`This listing is ${status}; that action is not available`);
  }

  /** Setting any cost on a live listing counts as confirming it: the manager has just looked at the figures. */
  async setCosts(orgId: string, listingId: string, actorId: string, v: CostsInput) {
    const status = await this.state(orgId, listingId); this.need('costs', status);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await this.writeCosts(c, listingId, v);
      if (status !== 'draft') await c.query(`UPDATE supply.listings SET status='published', last_confirmed_at=now(), updated_at=now() WHERE id=$1`, [listingId]);
      else await c.query(`UPDATE supply.listings SET updated_at=now() WHERE id=$1`, [listingId]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    const out = await this.get(orgId, listingId);
    await this.audit.record({ actorId, action: 'listing.costs_set', subjectType: 'listing', subjectId: listingId, metadata: { orgId, fields: Object.keys(v), totalMoveIn: out.totalMoveIn } });
    return out;
  }

  async publish(orgId: string, listingId: string, actorId: string) {
    this.need('publish', await this.state(orgId, listingId));
    const cur = await this.get(orgId, listingId);
    const missing = missingCosts(cur.costs);
    if (missing.length) throw new BadRequestException(`Cannot publish yet. Enter every cost (0 if there is none). Missing: ${missing.join(', ')}`);
    await this.pool.query(`UPDATE supply.listings SET status='published', published_at=now(), last_confirmed_at=now(), updated_at=now() WHERE id=$1 AND status='draft'`, [listingId]);
    await this.audit.record({ actorId, action: 'listing.published', subjectType: 'listing', subjectId: listingId, metadata: { orgId, totalMoveIn: cur.totalMoveIn } });
    return this.get(orgId, listingId);
  }

  async confirm(orgId: string, listingId: string, actorId: string) {
    this.need('confirm', await this.state(orgId, listingId));
    await this.pool.query(`UPDATE supply.listings SET status='published', last_confirmed_at=now(), updated_at=now() WHERE id=$1`, [listingId]);
    await this.audit.record({ actorId, action: 'listing.confirmed', subjectType: 'listing', subjectId: listingId, metadata: { orgId } });
    return this.get(orgId, listingId);
  }

  async close(orgId: string, listingId: string, actorId: string, to: 'let' | 'withdrawn') {
    this.need(to === 'let' ? 'let' : 'withdraw', await this.state(orgId, listingId));
    await this.pool.query(`UPDATE supply.listings SET status=$2, updated_at=now() WHERE id=$1`, [listingId, to]);
    await this.audit.record({ actorId, action: `listing.${to}`, subjectType: 'listing', subjectId: listingId, metadata: { orgId } });
    return this.get(orgId, listingId);
  }
}

export const OPEN_STATUSES = OPEN;
