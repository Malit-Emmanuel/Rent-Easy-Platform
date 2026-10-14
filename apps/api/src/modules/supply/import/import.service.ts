import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../../audit/audit.service';
import { cleanName } from '../files/files.rules';
import { PlannedProperty, RowIssue, planImport } from './importer';

const MAX_STORED_ISSUES = 1000, SHOWN_ISSUES = 200, RUN_TTL_HOURS = 24, MAX_RUNS_PER_HOUR = 30;

/**
 * Dry run, then confirm. The dry run stores the checked plan on the server; confirming applies THAT plan, never data from the browser.
 * Every query is locked to the organisation in the URL.
 */
@Injectable()
export class ImportService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService) {}

  private summary(r: any) {
    const plan: PlannedProperty[] = r.plan?.properties ?? [];
    const skipped = plan.reduce((n, p) => n + p.units.filter((u) => u.exists).length, 0);
    const units = plan.reduce((n, p) => n + p.units.length, 0);
    return {
      runId: r.id, fileName: r.file_name, status: r.status, createdAt: r.created_at, committedAt: r.committed_at ?? null, result: r.result ?? null,
      counts: { rows: r.row_count, errors: r.error_count, warnings: r.warning_count, newProperties: r.new_properties, existingProperties: plan.length - r.new_properties, newUnits: r.new_units, skippedUnits: skipped, totalUnits: units },
      canCommit: r.status === 'planned' && r.error_count === 0 && r.new_units + r.new_properties > 0,
      nothingToImport: r.error_count === 0 && r.new_units + r.new_properties === 0,
    };
  }

  /** Step 1: read and check the spreadsheet, compare it with what already exists, and save the plan. Nothing is created yet. */
  async preview(orgId: string, actorId: string, fileName: unknown, csv: unknown) {
    if (typeof csv !== 'string' || !csv.trim()) throw new BadRequestException('csv is required');
    const recent = (await this.pool.query(`SELECT count(*)::int n FROM supply.import_runs WHERE org_id=$1 AND created_at > now() - interval '1 hour'`, [orgId])).rows[0].n;
    if (recent >= MAX_RUNS_PER_HOUR) throw new HttpException('Too many import previews this hour. Please wait a while.', 429);

    const nodes = (await this.pool.query('SELECT id, name FROM supply.nodes')).rows;
    const plan = planImport(csv, nodes);
    const issues: RowIssue[] = [...plan.issues];

    if (plan.properties.length) {
      const ex = await this.pool.query(`SELECT id, lower(name) n, lower(address_text) a FROM supply.properties WHERE org_id=$1 AND archived_at IS NULL`, [orgId]);
      const idByKey = new Map<string, string>(ex.rows.map((r: any) => [`${r.n}|${r.a}`, r.id]));
      const existingId = new Map<string, string>();
      for (const p of plan.properties) { const id = idByKey.get(p.key); if (id) { p.exists = true; existingId.set(p.key, id); } }
      if (existingId.size) {
        const u = await this.pool.query(`SELECT property_id, lower(label) l FROM supply.units WHERE property_id = ANY($1::uuid[]) AND archived_at IS NULL`, [[...existingId.values()]]);
        const have = new Set(u.rows.map((r: any) => `${r.property_id}|${r.l}`));
        for (const p of plan.properties) if (p.exists) for (const un of p.units)
          if (have.has(`${existingId.get(p.key)}|${un.label.toLowerCase()}`)) {
            un.exists = true;
            issues.push({ row: un.row, severity: 'warning', code: 'unit_exists', column: 'unit', message: `Unit "${un.label}" already exists in "${p.name}", so it is skipped.` });
          }
      }
    }
    issues.sort((a, b) => (a.severity === b.severity ? a.row - b.row : a.severity === 'error' ? -1 : 1));
    const errors = issues.filter((i) => i.severity === 'error').length;
    const newProperties = plan.properties.filter((p) => !p.exists).length;
    const newUnits = plan.properties.reduce((n, p) => n + p.units.filter((u) => !u.exists).length, 0);

    const row = (await this.pool.query(
      `INSERT INTO supply.import_runs (org_id, created_by, file_name, content_sha256, row_count, error_count, warning_count, new_properties, new_units, plan, issues)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [orgId, actorId, cleanName(fileName) ?? null, createHash('sha256').update(csv).digest('hex'), plan.counts.rows, errors, issues.length - errors, newProperties, newUnits,
       JSON.stringify({ properties: plan.properties }), JSON.stringify(issues.slice(0, MAX_STORED_ISSUES))])).rows[0];
    await this.audit.record({ actorId, action: 'import.previewed', subjectType: 'import_run', subjectId: row.id, metadata: { orgId, rows: plan.counts.rows, errors } });
    return { ...this.summary(row), issues: issues.slice(0, SHOWN_ISSUES), issuesTotal: issues.length, headerMap: plan.headerMap, unmappedHeaders: plan.unmappedHeaders };
  }

  async get(orgId: string, runId: string) {
    const r = (await this.pool.query('SELECT * FROM supply.import_runs WHERE id=$1 AND org_id=$2', [runId, orgId])).rows[0];
    if (!r) throw new NotFoundException('Import not found');
    return { ...this.summary(r), issues: (r.issues as RowIssue[]).slice(0, SHOWN_ISSUES), issuesTotal: r.error_count + r.warning_count };
  }

  async list(orgId: string) {
    return (await this.pool.query('SELECT * FROM supply.import_runs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20', [orgId])).rows.map((r) => this.summary(r));
  }

  /** Step 2: apply the saved plan in one transaction, in bulk. All of it is saved, or none of it. */
  async commit(orgId: string, runId: string, actorId: string) {
    const c = await this.pool.connect(); let result: any;
    try {
      await c.query('BEGIN');
      const run = (await c.query('SELECT * FROM supply.import_runs WHERE id=$1 AND org_id=$2 FOR UPDATE', [runId, orgId])).rows[0];
      if (!run) throw new NotFoundException('Import not found');
      if (run.status === 'committed') throw new ConflictException('This import has already been confirmed');
      if (Date.now() - new Date(run.created_at).getTime() > RUN_TTL_HOURS * 3600_000) throw new ConflictException('This preview has expired. Upload the file again.');
      if (run.error_count > 0) throw new ConflictException('This import has errors. Fix the spreadsheet and upload it again.');
      if (run.new_units + run.new_properties === 0) throw new ConflictException('Nothing new to import');

      const props: PlannedProperty[] = run.plan.properties;
      const inserted = await c.query(
        `INSERT INTO supply.properties (org_id, node_id, name, address_text, location, import_run_id)
         SELECT $1, x.node, x.name, x.addr, CASE WHEN x.lon IS NULL THEN NULL ELSE extensions.st_point(x.lon, x.lat)::extensions.geography END, $2
           FROM unnest($3::text[], $4::text[], $5::int[], $6::float8[], $7::float8[]) AS x(name, addr, node, lat, lon)
         ON CONFLICT (org_id, lower(name), lower(address_text)) WHERE archived_at IS NULL DO NOTHING RETURNING id`,
        [orgId, runId, props.map((p) => p.name), props.map((p) => p.addressText), props.map((p) => p.nodeId ?? null), props.map((p) => p.latitude ?? null), props.map((p) => p.longitude ?? null)]);

      const found = await c.query(`SELECT id, lower(name) n, lower(address_text) a FROM supply.properties WHERE org_id=$1 AND archived_at IS NULL AND lower(name) = ANY($2::text[])`, [orgId, props.map((p) => p.name.toLowerCase())]);
      const idByKey = new Map<string, string>(found.rows.map((r: any) => [`${r.n}|${r.a}`, r.id]));
      const pid: string[] = [], label: string[] = [], bed: number[] = [];
      for (const p of props) {
        const id = idByKey.get(p.key); if (!id) throw new Error('planned property missing after insert');
        for (const u of p.units) { pid.push(id); label.push(u.label); bed.push(u.bedrooms); }
      }
      const units = await c.query(
        `INSERT INTO supply.units (property_id, label, bedrooms, import_run_id)
         SELECT x.pid, x.label, x.bed, $4 FROM unnest($1::uuid[], $2::text[], $3::int[]) AS x(pid, label, bed)
         ON CONFLICT (property_id, lower(label)) WHERE archived_at IS NULL DO NOTHING RETURNING id`, [pid, label, bed, runId]);

      result = { propertiesCreated: inserted.rowCount ?? 0, propertiesReused: props.length - (inserted.rowCount ?? 0), unitsCreated: units.rowCount ?? 0, unitsSkipped: label.length - (units.rowCount ?? 0) };
      await c.query(`UPDATE supply.import_runs SET status='committed', committed_at=now(), committed_by=$2, result=$3 WHERE id=$1`, [runId, actorId, JSON.stringify(result)]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    await this.audit.record({ actorId, action: 'import.committed', subjectType: 'import_run', subjectId: runId, metadata: { orgId, ...result } });
    return { runId, ...result };
  }
}
