import { Activity, ArrowRight, Check, ChevronRight, CircleHelp, ExternalLink, History, LayoutDashboard, Menu, Plus, Radio, RefreshCw, ScanSearch, Settings2, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import AuditLauncher, { initialRequest } from './AuditLauncher';
import Optimizer from './Optimizer';
import { CitationMatrix, Overview } from './Results';
import { api, type AuditRequest, type Health } from './types';
import { useAudit } from './useAudit';

const views = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, title: 'Your AI visibility, in focus.', subtitle: 'Understand where your brand stands in the new search landscape.' },
  { id: 'audit', label: 'Live audit', icon: Radio, title: 'Find your place in the answer.', subtitle: 'Real buyer questions. Search-grounded engines. Evidence you can inspect.' },
  { id: 'citations', label: 'Citation matrix', icon: ScanSearch, title: 'Go beyond the headline number.', subtitle: 'Inspect every recommendation, source, and missed opportunity.' },
  { id: 'optimizer', label: 'GEO optimizer', icon: Sparkles, title: 'Turn insight into better content.', subtitle: 'Create clearer product copy and structured data from your actual source.' },
];
type PastAudit = { id: string; created: number; brand: string; mode: string; status: string };

export default function App() {
  const [view, setView] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState('');
  const [form, setForm] = useState<AuditRequest>(initialRequest);
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<PastAudit[]>([]);
  const [historyError, setHistoryError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const { audit, error, connection, launching, launch, open } = useAudit();
  const busy = launching || audit?.status === 'running';
  const refresh = useCallback(() => {
    api<Health>('/health').then(data => { setHealth(data); setHealthError(''); }).catch(() => setHealthError('Backend unavailable. Start the API service and refresh.'));
  }, []);
  useEffect(refresh, [refresh]);
  const current = views.find(v => v.id === view)!;
  const configured = health?.providers.filter(p => p.configured).length || 0;
  const activeBrand = audit?.request.brand || form.brand || 'Your workspace';
  const activeUrl = audit?.request.target_url || form.target_url;
  let domain = '';
  try { domain = new URL(activeUrl).hostname; } catch { /* URL is still being entered. */ }
  const jump = (id: string) => { setView(id); document.getElementById('main-content')?.focus(); window.scrollTo({ top: 0 }); };
  async function showHistory() {
    setHistoryError(''); dialog.current?.showModal();
    try { setHistory(await api<PastAudit[]>('/audits')); } catch (e) { setHistoryError((e as Error).message); }
  }
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar"><div className="brand-lockup"><span className="brand-mark">A<span /></span><div><strong>AIResults<span className="brand-period">.</span></strong><small>VISIBILITY INTELLIGENCE</small></div></div>
      <div className="workspace-switch"><span className="workspace-avatar">{activeBrand.slice(0, 2).toUpperCase()}</span><div><strong>{activeBrand}</strong><small>Single-user workspace</small></div><ChevronRight size={15} /></div>
      <span className="nav-label">WORKSPACE</span><nav aria-label="Workspace">{views.map(v => <button aria-current={view === v.id ? 'page' : undefined} title={v.label} key={v.id} className={`nav-item ${view === v.id ? 'active' : ''}`} onClick={() => jump(v.id)}><v.icon size={18} /><span>{v.label}</span>{v.id === 'audit' && busy && <span className="nav-live" />}{view === v.id && <ChevronRight size={14} className="nav-arrow" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="signal-card"><div className="signal-icon"><Activity size={20} /></div><strong>From invisible<br />to in the conversation.</strong><p>Measure the signal.<br />Understand the source.<br />Improve what you own.</p><button className="text-button" onClick={() => jump('audit')}>Start measuring <ArrowRight size={13} /></button></div>
        <button className="nav-item" onClick={showHistory} title="Audit history"><History size={17} /><span>Audit history</span></button><button className="nav-item" onClick={() => jump('audit')} title="Engine setup"><Settings2 size={17} /><span>Engine setup</span></button><a className="nav-item" href="https://schema.org/Product" target="_blank" rel="noreferrer" title="Structured data reference"><CircleHelp size={17} /><span>Schema reference</span><ExternalLink size={12} /></a>
        <div className="profile"><span className="profile-avatar">YO</span><div><strong>Your workspace</strong><small>Local development · v0.1</small></div></div>
      </div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button" aria-label="Toggle navigation" onClick={() => setCollapsed(!collapsed)}><Menu size={19} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{current.label}</strong></div><div className="topbar-actions"><span className="api-status"><span className={`status-dot ${configured ? 'ready' : ''}`} />{configured} / 3 engines configured</span><button className="primary small" onClick={() => jump('audit')}><Plus size={15} />New audit</button></div></header>
      <main id="main-content" tabIndex={-1}><div className="page-heading"><div><div className="eyebrow">GENERATIVE ENGINE OPTIMIZATION <span className="eyebrow-divider">/</span> {current.label.toUpperCase()}</div><h1>{current.title}</h1><p>{current.subtitle}</p></div>{domain && <span className="domain-pill"><span className="status-dot" /><span>{domain}</span></span>}</div>
        <div className="workspace-meta"><div><span className="live-indicator" /><span>{audit ? `${audit.request.brand} · ${audit.request.prompts.length} buyer prompts` : 'A clearer view of AI search'} </span>{audit && <span className={`mode-badge ${audit.request.mode === 'demo' ? 'demo' : ''}`}>{audit.request.mode === 'demo' ? 'SYNTHETIC DEMO' : 'LIVE API AUDIT'}</span>}</div><span className="mono">{audit ? new Date(audit.created * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'OPENAI · PERPLEXITY · GEMINI'}</span></div>
        {healthError && <div className="notice" role="alert">{healthError}<button className="text-button" onClick={refresh}><RefreshCw size={14} />Retry</button></div>}
        {error && <div className="notice" role="alert">{error}</div>}
        {connection && <div className="stream-status" role="status"><Activity size={14} /><span>{connection}</span><span>{audit?.results.length || 0} received</span></div>}
        {audit?.request.mode === 'demo' && view !== 'audit' && <div className="demo-banner">Synthetic demo data · no live AI research was performed. <button className="text-button" onClick={() => { setForm({ ...audit.request, mode: 'live' }); jump('audit'); }}>Set up a live audit <ArrowRight size={14} /></button></div>}
        {view === 'overview' && <Overview audit={audit} launch={() => jump('audit')} diagnose={() => jump('citations')} />}
        {view === 'audit' && <AuditLauncher form={form} setForm={setForm} health={health} audit={audit} launch={launch} busy={busy} refresh={refresh} />}
        {view === 'citations' && <CitationMatrix audit={audit} launch={() => jump('audit')} fix={p => { setPrompt(p); jump('optimizer'); }} />}
        {view === 'optimizer' && <Optimizer brand={audit?.request.brand || form.brand} url={activeUrl} prompt={prompt} health={health} />}
        <footer className="page-footer"><span><Check size={12} /> Evidence before assumptions.</span><span>AIResults Assistant <span className="muted">/</span> GEO workspace</span></footer>
      </main>
    </div>
    <dialog ref={dialog} className="history-dialog"><div className="section-line"><div><span className="eyebrow">PERSISTED IN THIS WORKSPACE</span><h2>Recent audits</h2></div><button className="icon-button" aria-label="Close history" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {historyError && <p role="alert" className="notice">{historyError}</p>}{!history.length && <p className="muted">No saved audits yet.</p>}{history.map(h => <button className="history-item" key={h.id} onClick={() => { open(h.id); jump('overview'); dialog.current?.close(); }}><span className="workspace-avatar"><History size={16} /></span><div><strong>{h.brand}</strong><small>{new Date(h.created * 1000).toLocaleString()} · {h.mode} · {h.status}</small></div><ArrowRight size={16} /></button>)}
    </dialog>
  </div>;
}
