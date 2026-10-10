'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { completeError, FileKind, formatBytes, LIMITS, preCheck, requestError, shrinkPhoto } from '@/lib/files';
import { useI18n } from './I18n';

interface Props { orgId: string; propertyId: string; unitId?: string; kinds: FileKind[]; canWrite: boolean; canArchive: boolean }

export default function FilePanel({ orgId, propertyId, unitId, kinds, canWrite, canArchive }: Props) {
  const { t } = useI18n();
  const base = `orgs/${orgId}/properties/${propertyId}/files`;
  const [files, setFiles] = useState<any[] | null>(null), [docTypes, setDocTypes] = useState<any[]>([]);
  const [kind, setKind] = useState<FileKind>(kinds[0]), [docType, setDocType] = useState('title_deed');
  const [busy, setBusy] = useState(false), [note, setNote] = useState(''), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await api(`${base}?unitId=${unitId ?? 'none'}`);
    setFiles(r.status === 200 ? r.data : []);
  }, [base, unitId]);
  useEffect(() => { load(); if (kinds.includes('document')) api('document-types').then((r) => setDocTypes(r.data ?? [])); }, [load, kinds]);

  async function upload() {
    setError(''); setNote('');
    const file = input.current?.files?.[0];
    if (!file) { setError(t('chooseFirst')); return; }
    setBusy(true);
    try {
      const body: Blob = kind === 'photo' ? await shrinkPhoto(file) : file;
      const mime = body.type || file.type;
      const bad = preCheck(kind, mime, body.size); if (bad) { setError(t(bad)); return; }
      const req = await api(base, { method: 'POST', body: { kind, docType: kind === 'document' ? docType : undefined, unitId, originalName: file.name, mimeType: mime, sizeBytes: body.size } });
      if (req.status !== 201) { setError(t(requestError(req.status))); return; }
      const { file: rec, upload: up } = req.data;
      let put: Response;
      try { put = await fetch(up.url, { method: up.method, headers: up.headers, body }); } catch { setError(t('err_uploadFailed')); return; }
      if (!put.ok) { setError(t('err_uploadFailed')); return; }
      const done = await api(`${base}/${rec.id}/complete`, { method: 'POST' });
      if (done.status !== 200) { setError(t(completeError(done.status))); return; }
      setNote(t('uploadedOk')); if (input.current) input.current.value = ''; load();
    } finally { setBusy(false); }
  }

  async function open(id: string) {
    const w = window.open('', '_blank');          // opened first so the browser's pop-up blocker allows it
    const r = await api(`${base}/${id}/link`);
    if (r.status === 200 && w) { w.opener = null; w.location.href = r.data.url; } else { w?.close(); setError(t(requestError(r.status))); }
  }
  async function remove(id: string) {
    if (!window.confirm(t('archiveConfirm'))) return;
    const r = await api(`${base}/${id}`, { method: 'DELETE' });
    if (r.status === 204) load(); else setError(t('genericError'));
  }
  const label = (f: any) => f.originalName ?? t('kind_' + f.kind);

  return (
    <div className="card">
      {files === null ? <p className="msg">{t('loading')}</p> : files.length === 0 ? <p className="msg">{t('noFiles')}</p> : files.map((f) => (
        <div className="row" key={f.id} style={{ marginBottom: 6 }}>
          <span><span className="badge">{t('kind_' + f.kind)}{f.docType ? ` · ${t('dt_' + f.docType)}` : ''}</span> {label(f)} <span className="msg">({formatBytes(f.sizeBytes)})</span></span>
          <span className="spacer" />
          <button type="button" className="link" onClick={() => open(f.id)}>{t('open')}</button>
          {canArchive && <button type="button" className="link" onClick={() => remove(f.id)}>{t('deleteFile')}</button>}
        </div>
      ))}
      {canWrite && (
        <div style={{ marginTop: 8 }}>
          {kinds.length > 1 && (
            <>
              <label htmlFor={`k-${unitId ?? 'p'}`}>{t('files')}</label>
              <select id={`k-${unitId ?? 'p'}`} value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>{kinds.map((k) => <option key={k} value={k}>{t('kind_' + k)}</option>)}</select>
            </>
          )}
          {kind === 'document' && (
            <>
              <label htmlFor={`d-${unitId ?? 'p'}`}>{t('documentType')}</label>
              <select id={`d-${unitId ?? 'p'}`} value={docType} onChange={(e) => setDocType(e.target.value)}>
                {docTypes.map((d) => <option key={d.code} value={d.code}>{t('dt_' + d.code) === 'dt_' + d.code ? d.description : t('dt_' + d.code)}</option>)}
              </select>
            </>
          )}
          <label htmlFor={`f-${unitId ?? 'p'}`}>{t('chooseFile')}</label>
          <input id={`f-${unitId ?? 'p'}`} ref={input} type="file" accept={LIMITS[kind].accept} />
          <button type="button" onClick={upload} disabled={busy}>{busy ? t('uploading') : t('uploadFile')}</button>
          <p className="msg">{t('privateNote')}</p>
        </div>
      )}
      {note && <p className="msg" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
