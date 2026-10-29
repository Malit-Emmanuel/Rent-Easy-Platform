'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import { api } from '@/lib/client';
import { commitError, fileProblem, Issue, orderIssues } from '@/lib/import';

export default function ImportPage() {
  const { t } = useI18n();
  const { orgId } = useParams<{ orgId: string }>();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [run, setRun] = useState<any>(null), [done, setDone] = useState<any>(null), [showAll, setShowAll] = useState(false);

  async function check() {
    setError(''); setRun(null); setDone(null); setShowAll(false);
    const file = input.current?.files?.[0];
    if (!file) { setError(t('chooseFirst')); return; }
    const bad = fileProblem(file.name, file.size); if (bad) { setError(t(bad)); return; }
    setBusy(true);
    try {
      const text = await file.text();
      const r = await api(`orgs/${orgId}/imports/preview`, { method: 'POST', body: { fileName: file.name, csv: text } });
      if (r.status === 200) setRun(r.data); else setError(r.status === 429 ? t('tooMany') : r.status === 403 ? t('noAccess') : r.status === 413 ? t('err_fileTooBig') : t('genericError'));
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!window.confirm(t('confirmImportAsk'))) return;
    setBusy(true); setError('');
    try {
      const r = await api(`orgs/${orgId}/imports/${run.runId}/commit`, { method: 'POST' });
      if (r.status === 200) { setDone(r.data); setRun(null); if (input.current) input.current.value = ''; } else setError(t(commitError(r.status)));
    } finally { setBusy(false); }
  }

  const issues: Issue[] = run ? orderIssues(run.issues) : [];
  const shown = showAll ? issues : issues.slice(0, 50);
  return (
    <>
      <PageHead back={{ href: `/orgs/${orgId}/properties`, label: t('properties') }} eyebrow={t('importLink')} title={t('importTitle')}><a className="btn ghost" href="/unit_import_template.csv" download>{t('downloadTemplate')}</a></PageHead>
      <p className="msg">{t('importIntro')}</p>
      <div className="steps">
        {[t('importStep1'), t('importStep2'), t('importStep3')].map((x, i) => <div className="step" key={i}><span className="n">{i + 1}</span><p>{x.replace(/^\d\.\s*/, '')}</p></div>)}
      </div>

      {!done && (
        <div className="panel">
          <label htmlFor="csv" style={{ marginTop: 0 }}>{t('chooseFile')}</label>
          <input id="csv" ref={input} type="file" accept=".csv,.txt,text/csv,text/plain" />
          <button type="button" onClick={check} disabled={busy}>{busy && !run ? t('checking') : t('checkFile')}</button>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}

      {run && (
        <>
          <h2>{t('importSummary')}</h2>
          <div className="panel">
            <p>{t('rowsRead')}: <strong>{run.counts.rows}</strong></p>
            <p>{t('newProperties')}: <strong>{run.counts.newProperties}</strong> · {t('existingProps')}: <strong>{run.counts.existingProperties}</strong></p>
            <p>{t('newUnits')}: <strong>{run.counts.newUnits}</strong> · {t('skippedUnits')}: <strong>{run.counts.skippedUnits}</strong></p>
            <p><span className={run.counts.errors ? 'error' : ''}>{t('errorsLabel')}: <strong>{run.counts.errors}</strong></span> · {t('warningsLabel')}: <strong>{run.counts.warnings}</strong></p>
            {Object.keys(run.headerMap ?? {}).length > 0 && <p className="msg">{t('recognisedColumns')}: {Object.entries(run.headerMap).map(([h, f]) => `${h} → ${f}`).join(', ')}</p>}
            {(run.unmappedHeaders ?? []).length > 0 && <p className="msg">{t('ignoredColumns')}: {run.unmappedHeaders.join(', ')}</p>}
          </div>

          {issues.length > 0 && (
            <div className="panel">
              {shown.map((i, n) => (
                <div key={n} className="issue">
                  <span className={i.severity === 'error' ? 'dot err' : 'dot'} aria-hidden />
                  <span><span className="msg">{i.severity === 'error' ? t('errorsLabel') : t('warningsLabel')}{i.row > 0 ? ` · ${t('rowLabel')} ${i.row}` : ''}</span><br />{i.message}</span>
                </div>
              ))}
              {issues.length > 50 && <button type="button" className="link" onClick={() => setShowAll(!showAll)}>{showAll ? t('showFewer') : `${t('showAll')} (${issues.length})`}</button>}
              {run.issuesTotal > issues.length && <p className="msg">{t('issuesCapped')}</p>}
            </div>
          )}

          {run.counts.errors > 0 && <p className="error" role="alert">{t('fixErrors')}</p>}
          {run.nothingToImport && <p className="msg">{t('nothingNew')}</p>}
          {run.canCommit && <button type="button" onClick={confirm} disabled={busy}>{busy ? t('importing') : t('confirmImport')}</button>}
          {error && <p className="error" role="alert">{error}</p>}
        </>
      )}

      {done && (
        <div className="card">
          <h2>{t('importDone')}</h2>
          <p>{t('createdLabel')}: <strong>{done.propertiesCreated}</strong> {t('properties').toLowerCase()}, <strong>{done.unitsCreated}</strong> {t('units').toLowerCase()}</p>
          <p className="msg">{t('reusedLabel')}: {done.propertiesReused} {t('properties').toLowerCase()}, {done.unitsSkipped} {t('units').toLowerCase()}</p>
          <div className="row"><Link href={`/orgs/${orgId}/properties`}>{t('viewProperties')}</Link>
            <button type="button" className="link" onClick={() => setDone(null)}>{t('checkAnother')}</button></div>
        </div>
      )}
    </>
  );
}
