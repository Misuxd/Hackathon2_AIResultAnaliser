import { ArrowDownToLine, Check, CheckCheck, Copy, ExternalLink, FileCode2, FileText, LoaderCircle, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ENGINES, type Assets, type Health } from './types';
import { download } from './Results';

export default function Optimizer({ brand, url, prompt, health }: { brand: string; url: string; prompt: string; health: Health | null }) {
  const [name, setName] = useState(brand);
  const [target, setTarget] = useState(url);
  const [content, setContent] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [fetchPage, setFetchPage] = useState(false);
  const [mode, setMode] = useState('ai');
  const [provider, setProvider] = useState('openai');
  const [assets, setAssets] = useState<Assets | null>(null);
  const [tab, setTab] = useState<'optimized_markdown' | 'json_ld_script' | 'llms_txt'>('optimized_markdown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { setName(brand); setTarget(url); }, [brand, url]);
  useEffect(() => { setAssets(null); setCopied(false); }, [name, target, content, competitors, fetchPage, mode, provider]);
  useEffect(() => { setCopied(false); }, [tab]);

  async function generate(event: React.FormEvent) {
    event.preventDefault(); setError(''); setAssets(null); setBusy(true);
    try {
      const result = await api<Assets>('/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        brand: name, target_url: target, page_content: content, competitor_urls: competitors.split('\n').map(v => v.trim()).filter(Boolean), fetch_page: fetchPage, mode, provider, buyer_question: prompt,
      }) });
      setAssets(result);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!assets) return;
    try { await navigator.clipboard.writeText(assets[tab]); setCopied(true); }
    catch { setError('Clipboard access was denied. Select the output to copy manually or download the file.'); }
  }
  const tabs = [{ key: 'optimized_markdown' as const, label: 'Markdown copy', file: 'product-copy.md', icon: FileText },
    { key: 'json_ld_script' as const, label: 'JSON-LD', file: 'structured-data.html', icon: FileCode2 },
    { key: 'llms_txt' as const, label: '/llms.txt', file: 'llms.txt', icon: FileText }];

  return <div className="optimizer-layout"><div>
    <form className="panel source-form" onSubmit={generate}>
      <div className="panel-heading"><span className="step-dot">01</span><div><h2>Start with the evidence</h2><p>Product facts in. Reviewable content out.</p></div></div>
      {prompt && <div className="context-note"><span className="eyebrow">SELECTED BUYER QUESTION</span><p>{prompt}</p></div>}
      <label>Brand name<input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} disabled={busy} /></label>
      <label>Product page URL<input type="url" required value={target} onChange={e => setTarget(e.target.value)} disabled={busy} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={fetchPage} onChange={e => setFetchPage(e.target.checked)} disabled={busy} />Fetch the public product page</label>
      {fetchPage ? <p className="fine-print">Enabled hosts: {health?.fetch_hosts.join(', ') || 'none'}. Add exact public hostnames to GEO_FETCH_HOSTS. Redirect hosts must also be enabled.</p> : <label>Current product content<textarea rows={9} required minLength={40} maxLength={100000} placeholder="Paste your actual product copy or HTML. Features, pricing, and evidence will only come from this source." value={content} onChange={e => setContent(e.target.value)} disabled={busy} /></label>}
      <details className="advanced"><summary>Compare competitor pages <span>optional</span></summary><label>Up to 3 HTTPS URLs, one per line<textarea rows={3} value={competitors} onChange={e => setCompetitors(e.target.value)} placeholder="https://competitor.com/product" disabled={busy} /></label><p className="fine-print">Requires the same host allowlist. Fetch failures remain visible; unavailable evidence is never inferred.</p></details>
      <label>Generation method<select value={mode} onChange={e => setMode(e.target.value)} disabled={busy}><option value="ai">AI rewrite · real provider API</option><option value="source">Source-only export · no AI call</option></select></label>
      {mode === 'ai' && <label>Rewrite provider<select value={provider} onChange={e => setProvider(e.target.value)} disabled={busy}>{ENGINES.map(e => <option key={e.id} value={e.id}>{e.name}{health?.providers.find(p => p.id === e.id)?.configured ? '' : ' · key required'}</option>)}</select></label>}
      <button className="primary full" disabled={busy} type="submit">{busy ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}{busy ? 'Reading & generating…' : 'Generate GEO assets'}</button>
      <p className="fine-print">{mode === 'ai' ? 'Uses the selected provider account. Review every claim before publishing.' : 'Formats your supplied source. This does not use AI or make research claims.'}</p>
      {error && <div role="alert" className="notice">{error}</div>}
    </form>
    {assets && <section className="panel diagnosis"><span className="eyebrow">SOURCE DIAGNOSIS</span><h2>{assets.source_characters.toLocaleString()} characters inspected</h2>{assets.checks.map(c => <div className="check-row" key={c.label}><span className={c.present ? 'check-icon' : 'missing-icon'}>{c.present ? <Check size={14} /> : '−'}</span><span>{c.label}</span><small>{c.present ? 'Present' : 'Not observed'}</small></div>)}
      {assets.competitor_evidence.map(p => <div className="competitor-evidence" key={p.url}><a href={p.url} target="_blank" rel="noreferrer">{p.url}<ExternalLink size={12} /></a><p>HTML table: {p.has_table ? 'present' : 'not observed'} · {p.schema_blocks} JSON-LD blocks</p></div>)}
    </section>}
  </div><section className="panel output-panel"><div className="section-line"><div><span className="eyebrow">GEO WORKSPACE</span><h2>Content built to be understood.</h2><p>Three portable assets. One factual source.</p></div><span className="pill">{assets ? assets.mode === 'ai' ? 'AI DRAFT' : 'SOURCE EXPORT' : 'AWAITING SOURCE'}</span></div>
    <div className="output-toolbar"><div className="tab-buttons" role="tablist" aria-label="GEO deliverables">{tabs.map(t => <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls="asset-output" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}><t.icon size={14} />{t.label}</button>)}</div>
      <div className="output-actions"><button className="icon-button" aria-label="Download current asset" disabled={!assets} onClick={() => assets && download(tabs.find(t => t.key === tab)!.file, assets[tab])}><ArrowDownToLine size={16} /></button><button className="primary small" disabled={!assets} onClick={copy}>{copied ? <CheckCheck size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy code'}</button></div></div>
    {assets ? <><div className="code-header"><span className="mono">{tabs.find(t => t.key === tab)?.file}</span><span>REVIEW BEFORE PUBLISHING</span></div><pre role="tabpanel" id="asset-output" aria-labelledby={`tab-${tab}`} tabIndex={0}><code>{assets[tab]}</code></pre><div className="asset-warnings">{assets.warnings.map(w => <p key={w}>{w}</p>)}</div></> : <div className="output-empty" id="asset-output" role="tabpanel" aria-labelledby={`tab-${tab}`}><FileCode2 size={40} /><h3>Your next version starts here.</h3><p>Supply product content to generate a rewrite,<br />Product + FAQ structured data, and an llms.txt draft.<br />No invented reviews. No promised ranking gains.</p></div>}
  </section></div>;
}
