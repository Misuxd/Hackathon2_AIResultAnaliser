import { Activity, ArrowRight, Check, ChevronRight, History, LayoutDashboard, Menu, Plus, Radio, RefreshCw, ScanSearch, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import AuditLauncher, { initialRequest } from './AuditLauncher';
import Optimizer from './Optimizer';
import { CitationMatrix, Overview } from './Results';
import { api, ENGINES, type AuditRequest, type Health } from './types';
import { useAudit } from './useAudit';

const views = [
  { id: 'audit', label: 'Live audit', icon: Radio, title: 'Measure your AI visibility', subtitle: 'Run the questions a buyer would ask before they know your brand.' },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, title: 'Review your audit results', subtitle: 'Compare brand mentions and rankings across the questions you tested.' },
  { id: 'citations', label: 'Citation matrix', icon: ScanSearch, title: 'See what the engines answered', subtitle: 'Compare answers and cited pages question by question.' },
  { id: 'optimizer', label: 'GEO optimizer', icon: Sparkles, title: 'Improve your product page', subtitle: 'Get specific changes that help AI search find, interpret, and verify your content.' },
];
type PastAudit = { id: string; created: number; brand: string; mode: string; status: string };

export default function App() {
  const [view, setView] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState('');
  const [form, setForm] = useState<AuditRequest>(initialRequest);
  const [prompt, setPrompt] = useState('');
  const [autoOptimize, setAutoOptimize] = useState(false);
  const consumeAutoOptimize = useCallback(() => setAutoOptimize(false), []);
  const [history, setHistory] = useState<PastAudit[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const { audit, error, connection, launching, launch, open, clear } = useAudit();
  const busy = launching || audit?.status === 'running';
  const refresh = useCallback(() => {
    api<Health>('/health').then(data => { setHealth(data); setHealthError(''); }).catch(() => {
      setHealth(null);
      setHealthError('Backend unavailable. Start the API service and refresh.');
    });
  }, []);
  useEffect(refresh, [refresh]);
  const current = views.find(v => v.id === view)!;
  const configured = ENGINES.filter(e => health?.providers.some(p => p.id === e.id && p.configured)).length;
  const activeUrl = audit?.request.target_url || form.target_url;
  let domain = '';
  try { domain = new URL(activeUrl).hostname; } catch { /* URL is still being entered. */ }
  const jump = (id: string) => {
    if (id !== 'optimizer') setAutoOptimize(false);
    setView(id); document.getElementById('main-content')?.focus(); window.scrollTo({ top: 0 });
  };
  async function showHistory() {
    setHistoryError(''); setConfirmDelete(false); setHistory([]); dialog.current?.showModal();
    try { setHistory(await api<PastAudit[]>('/audits')); } catch (e) { setHistoryError((e as Error).message); }
  }
  async function deleteHistory() {
    setDeleting(true); setHistoryError('');
    try {
      await api('/audits', { method: 'DELETE' });
      clear(); setHistory([]); setConfirmDelete(false); jump('overview');
    } catch (e) { setHistoryError((e as Error).message); }
    finally { setDeleting(false); }
  }
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar"><div className="brand-lockup"><span className="brand-mark">A<span /></span><div><strong>AIResults<span className="brand-period">.</span></strong><small>VISIBILITY INTELLIGENCE</small></div></div>
      <nav aria-label="Audit workflow">{views.map(v => <button aria-current={view === v.id ? 'page' : undefined} title={v.label} key={v.id} className={`nav-item ${view === v.id ? 'active' : ''}`} onClick={() => { if (v.id === 'optimizer' && view !== 'optimizer') setPrompt(''); jump(v.id); }}><v.icon size={20} /><span>{v.label}</span>{v.id === 'audit' && busy && <span className="nav-live" />}{view === v.id && <ChevronRight size={14} className="nav-arrow" />}</button>)}</nav>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={showHistory} title="Audit history"><History size={19} /><span>Audit history</span></button>
      </div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button" aria-label="Toggle navigation" onClick={() => setCollapsed(!collapsed)}><Menu size={19} /></button><strong>{current.label}</strong></div><div className="topbar-actions"><span className="api-status"><span className={`status-dot ${configured ? 'ready' : ''}`} />{configured} / {ENGINES.length} engines configured</span>{view !== 'audit' && <button className="primary small" onClick={() => jump('audit')}><Plus size={15} />New audit</button>}</div></header>
      <main id="main-content" tabIndex={-1}><div className="page-heading"><div><div className="eyebrow">GENERATIVE ENGINE OPTIMIZATION <span className="eyebrow-divider">/</span> {current.label.toUpperCase()}</div><h1>{current.title}</h1><p>{current.subtitle}</p></div>{domain && <span className="domain-pill"><span className="status-dot" /><span>{domain}</span></span>}</div>
        <div className="workspace-meta"><div><span className="live-indicator" /><span>{audit ? `${audit.request.brand} · ${audit.request.prompts.length} buyer prompts` : 'A clearer view of AI search'} </span>{audit && <span className={`mode-badge ${audit.request.mode === 'demo' ? 'demo' : ''}`}>{audit.request.mode === 'demo' ? 'SYNTHETIC DEMO' : 'LIVE API AUDIT'}</span>}</div><span className="mono">{audit ? new Date(audit.created * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'OPENAI · PERPLEXITY'}</span></div>
        {healthError && <div className="notice" role="alert">{healthError}<button className="text-button" onClick={refresh}><RefreshCw size={14} />Retry</button></div>}
        {error && <div className="notice" role="alert">{error}</div>}
        {connection && <div className="stream-status" role="status"><Activity size={14} /><span>{connection}</span><span>{audit?.results.length || 0} received</span></div>}
        {audit?.request.mode === 'demo' && view !== 'audit' && <div className="demo-banner">Synthetic demo data · no live AI research was performed. <button className="text-button" onClick={() => {
          const { brand, target_url, offering, prompts } = audit.request;
          setForm({ ...initialRequest, brand, target_url, offering, prompts }); jump('audit');
        }}>Set up a live audit <ArrowRight size={14} /></button></div>}
        {view === 'overview' && <Overview audit={audit} launch={() => jump('audit')} diagnose={() => jump('citations')} />}
        {view === 'audit' && <AuditLauncher form={form} setForm={setForm} health={health} audit={audit} launch={launch} busy={busy} refresh={refresh} inspect={() => jump('citations')} />}
        {view === 'citations' && <CitationMatrix audit={audit} launch={() => jump('audit')} fix={p => { setPrompt(p); setAutoOptimize(true); jump('optimizer'); }} />}
        {view === 'optimizer' && <Optimizer brand={audit?.request.brand || form.brand} url={activeUrl} prompt={prompt} health={health}
          autoOptimize={autoOptimize} onAutoStart={consumeAutoOptimize} />}
        <footer className="page-footer"><span><Check size={12} /> Evidence before assumptions.</span><span>AIResults Assistant <span className="muted">/</span> GEO workspace</span></footer>
      </main>
    </div>
    <dialog ref={dialog} className="history-dialog" onCancel={event => { if (deleting) event.preventDefault(); }}><div className="section-line"><div><span className="eyebrow">PERSISTED IN THIS WORKSPACE</span><h2>Recent audits</h2></div><button className="icon-button" aria-label="Close history" disabled={deleting} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {historyError && <p role="alert" className="notice">{historyError}</p>}{!history.length && <p className="muted">No saved audits yet.</p>}{history.map(h => <button className="history-item" key={h.id} disabled={deleting} onClick={() => { open(h.id); jump('overview'); dialog.current?.close(); }}><span className="workspace-avatar"><History size={16} /></span><div><strong>{h.brand}</strong><small>{new Date(h.created * 1000).toLocaleString()} · {h.mode} · {h.status}</small></div><ArrowRight size={16} /></button>)}
      {history.length > 0 && <div className="history-actions">
        {confirmDelete ? <><p>Permanently delete all saved audits and their answers? This resets the history used for visibility scores.</p>
          <button className="secondary small" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="secondary small history-delete" disabled={deleting || busy} onClick={deleteHistory}>{deleting ? 'Deleting…' : 'Delete all saved audits'}</button></>
          : <button className="secondary small history-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete history</button>}
      </div>}
    </dialog>
  </div>;
}
