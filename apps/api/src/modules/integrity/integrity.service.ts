import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { RULE_QUERIES, STRONG_FLAGS } from './integrity.rules';

export const ALERT_COOLDOWN_DAYS = 7;
const DEFAULT_WINDOW_DAYS = 30;
const NOT_BUILT = new Set(['second_look_disagree', 'second_look_rate_new', 'second_look_rate_later']);

/**
 * The daily integrity scan and the admin's handling of alerts. Alerts are advisory: nothing here blocks, suspends, reassigns, reprices or ranks anyone,
 * and no case or badge is changed. A person decides what an alert means.
 */
@Injectable()
export class IntegrityService {
  private log = new Logger('Integrity');
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService) {}

  /** Runs every enabled rule once and raises new alerts. Safe to run twice: a live alert is never duplicated. Returns counts only. */
  async scan(): Promise<{ rulesRun: number; raised: number; skipped: number }> {
    const rules = (await this.pool.query(`SELECT code, threshold, min_sample, window_days, window_minutes FROM verification.integrity_rules WHERE enabled ORDER BY code`)).rows;
    let rulesRun = 0, raised = 0, skipped = 0;
    for (const rule of rules) {
      const q = RULE_QUERIES[rule.code];
      if (!q) { skipped++; continue; }   // a rule that is switched on but not built yet is ignored, never guessed
      rulesRun++;
      const windowParam = rule.code === 'burst' ? rule.window_minutes : (rule.window_days ?? DEFAULT_WINDOW_DAYS);
      const params: unknown[] = [windowParam, rule.min_sample, rule.threshold];
      if (rule.code === 'flagged_approved') params.push(STRONG_FLAGS);
      let hits: any[];
      try { hits = (await this.pool.query(q.sql, params)).rows; }
      catch (e) { this.log.error(`rule ${rule.code} failed: ${(e as Error).message}`); skipped++; continue; }
      for (const h of hits) {
        if (q.cooldown) {
          const recent = (await this.pool.query(`SELECT 1 FROM verification.integrity_alerts WHERE rule_code=$1 AND reviewer_id=$2 AND raised_at > now() - make_interval(days => $3::int)`, [rule.code, h.reviewer_id, ALERT_COOLDOWN_DAYS])).rowCount;
          if (recent) continue;
        }
        const ins = await this.pool.query(
          `INSERT INTO verification.integrity_alerts (rule_code, reviewer_id, window_from, window_to, figures, case_ids)
           VALUES ($1,$2, now() - make_interval(days => $3::int), now(), $4, $5)
           ON CONFLICT (rule_code, reviewer_id) WHERE status IN ('open','escalated') DO NOTHING RETURNING id`,
          [rule.code, h.reviewer_id, rule.code === 'burst' ? 30 : (rule.window_days ?? DEFAULT_WINDOW_DAYS), JSON.stringify(h.figures), h.case_ids ?? []]);
        if (ins.rowCount) {
          raised++;
          await this.audit.record({ action: 'integrity.alert_raised', subjectType: 'integrity_alert', subjectId: ins.rows[0].id, metadata: { rule: rule.code } });
        }
      }
    }
    return { rulesRun, raised, skipped };
  }

  private async logView(adminId: string, resource: string, reason: string) {
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,$2,$3)`, [adminId, resource, reason]);
  }

  /** Alerts for an admin: the rule, the figures and the case numbers, never case contents. Viewing is logged. */
  async list(adminId: string, status?: string) {
    if (status !== undefined && !['open', 'live', 'all'].includes(status)) throw new BadRequestException('status must be open, live or all');
    const where = status === 'all' ? 'TRUE' : status === 'live' ? `a.status IN ('open','escalated')` : `a.status = 'open'`;
    const rows = (await this.pool.query(
      `SELECT a.id, a.rule_code, r.description, r.unit, r.threshold, a.reviewer_id, a.raised_at, a.window_from, a.window_to, a.figures, a.case_ids, a.status, a.handled_by, a.handled_at, a.handler_note
         FROM verification.integrity_alerts a JOIN verification.integrity_rules r ON r.code = a.rule_code WHERE ${where} ORDER BY a.raised_at DESC LIMIT 200`)).rows;
    await this.logView(adminId, 'admin_integrity_alerts', `listed ${rows.length}`);
    return rows.map((r) => ({ id: r.id, rule: r.rule_code, description: r.description, unit: r.unit, threshold: Number(r.threshold), reviewerId: r.reviewer_id, raisedAt: r.raised_at, windowFrom: r.window_from, windowTo: r.window_to,
      figures: r.figures, caseIds: r.case_ids, status: r.status, handledAt: r.handled_at, handlerNote: r.handler_note, advisory: true }));
  }

  /** Acknowledge, dismiss or escalate, always with a written note. The database refuses a non-admin, the reviewer concerned and any status change that is not allowed. */
  async handle(alertId: string, adminId: string, body: { status?: unknown; note?: unknown }) {
    if (!['acknowledged', 'dismissed', 'escalated'].includes(body?.status as string)) throw new BadRequestException('status must be acknowledged, dismissed or escalated');
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (note.length < 5 || note.length > 500) throw new BadRequestException('Give a note of 5 to 500 characters.');
    try {
      const r = await this.pool.query(`UPDATE verification.integrity_alerts SET status=$2, handled_by=$3, handled_at=now(), handler_note=$4 WHERE id=$1 RETURNING id, status`, [alertId, body.status, adminId, note]);
      if (!r.rowCount) throw new NotFoundException('Alert not found');
      return { id: r.rows[0].id, status: r.rows[0].status };
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      const msg = String(e?.message);
      if (/cannot go from|about themselves/.test(msg)) throw new ConflictException({ code: 'alert_not_allowed', message: 'This alert cannot be handled that way.' });
      throw e;
    }
  }

  async rules(adminId: string) {
    const rows = (await this.pool.query(`SELECT code, description, threshold, unit, min_sample, window_days, window_minutes, enabled, updated_at FROM verification.integrity_rules ORDER BY code`)).rows;
    await this.logView(adminId, 'admin_integrity_rules', `listed ${rows.length}`);
    return rows.map((r) => ({ code: r.code, description: r.description, threshold: Number(r.threshold), unit: r.unit, minSample: r.min_sample, windowDays: r.window_days, windowMinutes: r.window_minutes, enabled: r.enabled, available: !NOT_BUILT.has(r.code), updatedAt: r.updated_at }));
  }

  /** Adjust a placeholder threshold, minimum or on/off switch. Every change is written to the audit trail by the database. */
  async updateRule(code: string, adminId: string, body: { threshold?: unknown; minSample?: unknown; enabled?: unknown }) {
    const sets: string[] = []; const vals: unknown[] = [code, adminId];
    if (body?.threshold !== undefined) { const n = Number(body.threshold); if (typeof body.threshold !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e6) throw new BadRequestException('threshold must be a number from 0 up'); vals.push(n); sets.push(`threshold=$${vals.length}`); }
    if (body?.minSample !== undefined) { const n = body.minSample; if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000) throw new BadRequestException('minSample must be a whole number from 0 up'); vals.push(n); sets.push(`min_sample=$${vals.length}`); }
    if (body?.enabled !== undefined) { if (typeof body.enabled !== 'boolean') throw new BadRequestException('enabled must be true or false'); vals.push(body.enabled); sets.push(`enabled=$${vals.length}`); }
    if (!sets.length) throw new BadRequestException('Nothing to change.');
    if (NOT_BUILT.has(code) && body.enabled === true) throw new ConflictException({ code: 'rule_not_available', message: 'Second-look sampling is not available yet.' });
    const r = await this.pool.query(`UPDATE verification.integrity_rules SET ${sets.join(', ')}, updated_by=$2 WHERE code=$1 RETURNING code`, vals);
    if (!r.rowCount) throw new NotFoundException('Rule not found');
    return { code, updated: true };
  }
}
