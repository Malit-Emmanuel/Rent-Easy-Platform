import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../audit/audit.service';
import { PublicQuery } from './public.rules';

const COLS = `id, property_name AS "propertyName", node_id AS "nodeId", area, bedrooms, floor,
  rent::float8 AS rent, deposit::float8 AS deposit, utility_deposit::float8 AS "utilityDeposit", service_charge::float8 AS "serviceCharge", agent_fee::float8 AS "agentFee",
  total_move_in::float8 AS "totalMoveIn", last_confirmed_at AS "confirmedAt", verified_until AS "verifiedUntil"`;

function shape(r: any) {
  const { rent, deposit, utilityDeposit, serviceCharge, agentFee, ...rest } = r;
  return { ...rest, costs: { rent, deposit, utilityDeposit, serviceCharge, agentFee } };
}

/** Reads only supply.public_listings (see migration 0024). It cannot reach private tables by design. */
@Injectable()
export class PublicListingsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async areas() {
    return (await this.pool.query(`SELECT node_id AS id, area AS name, count(*)::int AS listings FROM supply.public_listings WHERE node_id IS NOT NULL GROUP BY node_id, area ORDER BY area`)).rows;
  }

  async search(q: PublicQuery) {
    const vals: unknown[] = []; const where: string[] = ['true'];
    const add = (sql: string, v: unknown) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
    if (q.nodeId !== undefined) add('node_id = ?', q.nodeId);
    if (q.bedrooms !== undefined) add('bedrooms = ?', q.bedrooms);
    if (q.minRent !== undefined) add('rent >= ?', q.minRent);
    if (q.maxRent !== undefined) add('rent <= ?', q.maxRent);
    if (q.verified) where.push('verified_until IS NOT NULL');
    const order = q.sort === 'cost' ? 'total_move_in ASC, last_confirmed_at DESC, id' : 'last_confirmed_at DESC, id';
    vals.push(q.limit + 1, q.offset);
    const rows = (await this.pool.query(`SELECT ${COLS} FROM supply.public_listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals)).rows;
    return { items: rows.slice(0, q.limit).map(shape), hasMore: rows.length > q.limit };
  }

  async one(id: string) {
    const r = await this.pool.query(`SELECT ${COLS} FROM supply.public_listings WHERE id = $1`, [id]);
    if (!r.rows[0]) throw new NotFoundException('Not found');
    return shape(r.rows[0]);
  }
}
