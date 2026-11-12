import { BadRequestException } from '@nestjs/common';

/** Months are Kenyan calendar months (Africa/Nairobi), written YYYY-MM. No month means the current one. */
export function parseMonth(m: unknown): string {
  const s = m === undefined || m === '' ? new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7) : m;
  if (typeof s !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s) || Number(s.slice(0, 4)) < 2024) throw new BadRequestException('month must look like 2026-11');
  return s;
}

/** SQL for the start and end of the month in $1 (as a timestamptz pair), Nairobi time. */
export const MONTH_BOUNDS = `(SELECT ($1 || '-01')::date::timestamp AT TIME ZONE 'Africa/Nairobi' AS s, (($1 || '-01')::date::timestamp + interval '1 month') AT TIME ZONE 'Africa/Nairobi' AS e)`;
