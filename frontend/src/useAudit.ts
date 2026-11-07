import { useEffect, useRef, useState } from 'react';
import { api, type Audit, type AuditRequest, type QueryResult, type Summary } from './types';

export function useAudit() {
  const [id, setId] = useState<string | null>(() => localStorage.getItem('geo-audit'));
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('');
  const [launching, setLaunching] = useState(false);
  const launchLock = useRef(false);

  useEffect(() => {
    if (!id) return;
    localStorage.setItem('geo-audit', id);
    const abort = new AbortController();
    let events: EventSource | null = null;
    setError('');
    setConnection('Loading audit…');
    api<Audit>(`/audits/${id}`, { signal: abort.signal }).then(data => {
      if (abort.signal.aborted) return;
      setAudit(data);
      setConnection('');
      if (data.status !== 'running') return;
      events = new EventSource(`/api/v1/audits/${id}/stream`);
      events.onopen = () => setConnection('Streaming results');
      events.addEventListener('result', event => {
        const result: QueryResult = JSON.parse((event as MessageEvent).data);
        setAudit(current => current?.id === id ? {
          ...current, results: [...current.results.filter(r => r.query_id !== result.query_id), result],
        } : current);
      });
      events.addEventListener('complete', event => {
        const summary: Summary = JSON.parse((event as MessageEvent).data);
        setAudit(current => current?.id === id ? { ...current, status: 'complete', summary } : current);
        setConnection('');
        events?.close();
      });
      events.addEventListener('failed', event => {
        setError(JSON.parse((event as MessageEvent).data).error);
        setAudit(current => current?.id === id ? { ...current, status: 'failed' } : current);
        setConnection('');
        events?.close();
      });
      events.onerror = () => setConnection('Connection interrupted. Reconnecting automatically…');
    }).catch(e => {
      if (!abort.signal.aborted) { setError(e.message); setConnection(''); }
    });
    return () => { abort.abort(); events?.close(); };
  }, [id]);

  async function launch(request: AuditRequest) {
    if (launchLock.current) return;
    launchLock.current = true;
    setLaunching(true); setError('');
    try {
      const data = await api<{ audit_id: string }>('/audits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      setAudit({ id: data.audit_id, request, created: Date.now() / 1000, status: 'running', results: [], summary: null });
      setId(data.audit_id);
    } catch (e) { setError((e as Error).message); }
    finally { launchLock.current = false; setLaunching(false); }
  }
  return { audit, error, connection, launching, launch, open: (auditId: string) => { setAudit(null); setId(auditId); } };
}
