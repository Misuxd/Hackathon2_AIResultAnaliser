import { ArrowDownToLine, Check, CheckCheck, Copy, FileCode2, FileText, LoaderCircle, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ENGINES, type Assets, type Health, type Provider } from './types';
import { download } from './Results';

export default function Optimizer({ brand, url, prompt, health }: { brand: string; url: string; prompt: string; health: Health | null }) {
  const [name, setName] = useState(brand);
  const [target, setTarget] = useState(url);
  const [content, setContent] = useState('');
  const [redirectHosts, setRedirectHosts] = useState('');
  const [fetchPage, setFetchPage] = useState(false);
  const [mode, setMode] = useState('ai');
  const [provider, setProvider] = useState<Provider>('openai');
  const [assets, setAssets] = useState<Assets | null>(null);
  const [tab, setTab] = useState<'optimized_markdown' | 'json_ld_script' | 'llms_txt'>('optimized_markdown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const available = ENGINES.filter(e => health?.providers.some(p => p.id === e.id && p.configured));
  const selectedProvider = available.some(e => e.id === provider) ? provider : available[0]?.id;
  useEffect(() => { setName(brand); setTarget(url); }, [brand, url]);
  useEffect(() => { setAssets(null); setCopied(false); }, [name, target, content, redirectHosts, fetchPage, mode, selectedProvider, prompt]);
  useEffect(() => { setCopied(false); }, [tab]);

  async function generate(event: React.FormEvent) {
    event.preventDefault(); setError(''); setAssets(null); setBusy(true);
    try {
      const result = await api<Assets>('/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        brand: name, target_url: target, page_content: content, fetch_page: fetchPage, mode, provider: selectedProvider, buyer_question: prompt,
        redirect_hosts: fetchPage ? redirectHosts.split(',').map(host => host.trim()).filter(Boolean) : [],
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
      <div className="panel-heading"><span className="step-dot">01</span><div><h2>Supply the page you want to improve</h2><p>Paste your page content or fetch it, then review changes for buyer intent, retrieval, authority, and structure.</p></div></div>
      {prompt && <div className="context-note"><span className="eyebrow">SELECTED BUYER QUESTION</span><p>{prompt}</p></div>}
      <label>Brand name<input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} disabled={busy} /></label>
      <label>Product page URL<input type="url" required value={target} onChange={e => setTarget(e.target.value)} disabled={busy} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={fetchPage} onChange={e => setFetchPage(e.target.checked)} disabled={busy} />Fetch the public product page</label>
      {fetchPage ? <><p className="fine-print">Use a public HTTPS page. If it redirects to another domain, allow that hostname for this fetch.</p>
        <label>Allowed redirect hostnames <span className="muted">optional</span><input value={redirectHosts} onChange={e => setRedirectHosts(e.target.value)} placeholder="shop.example.com, pages.example.com" disabled={busy} /></label>
        {!!health?.fetch_hosts.length && <p className="fine-print">This server restricts fetching to {health.fetch_hosts.join(', ')}.</p>}
      </> : <label>Current product content<textarea rows={9} required minLength={40} maxLength={100000} placeholder="Paste your actual product copy or HTML. Features, pricing, and evidence will only come from this source." value={content} onChange={e => setContent(e.target.value)} disabled={busy} /></label>}
      <label>Generation method<select value={mode} onChange={e => setMode(e.target.value)} disabled={busy}><option value="ai">AI rewrite · real provider API</option><option value="source">Source-only export · no AI call</option></select></label>
      {mode === 'ai' && <label>Rewrite provider<select value={selectedProvider ?? ''} onChange={e => setProvider(e.target.value as Provider)} disabled={busy || !selectedProvider}>{selectedProvider ? available.map(e => <option key={e.id} value={e.id}>{e.name}</option>) : <option value="">No configured engine</option>}</select></label>}
      <button className="primary full" disabled={busy || (mode === 'ai' && !selectedProvider)} type="submit">{busy ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}{busy ? 'Reading & generating…' : 'Generate GEO assets'}</button>
      {mode === 'ai' && !selectedProvider && <p className="fine-print">Configure an API key for a rewrite, or choose Source-only export for page checks and recommendations.</p>}
      <p className="fine-print">{mode === 'ai' ? 'Uses the selected provider account. Review every claim before publishing.' : 'Formats your supplied source. This does not use AI or make research claims.'}</p>
      {error && <div role="alert" className="notice">{error}</div>}
    </form>
    {assets && <section className="panel diagnosis"><span className="eyebrow">02 · PAGE CHANGES</span><h2>What to change and why</h2><p>Start with the buyer’s question and the facts your page can support.</p>
      <ol className="recommendations">{assets.recommendations.map(item => <li key={item.title}><h3>{item.title}</h3>
        <p><strong>Evidence.</strong> {item.evidence}</p><p><strong>Change.</strong> {item.change}</p><p><strong>Why.</strong> {item.why}</p>
      </li>)}</ol>
    </section>}
    {assets && <section className="panel diagnosis"><span className="eyebrow">SOURCE DIAGNOSIS</span><h2>{assets.source_characters.toLocaleString()} characters inspected</h2>{assets.checks.map(c => <div className="check-row" key={c.label}><span className={c.present ? 'check-icon' : 'missing-icon'}>{c.present ? <Check size={14} /> : '−'}</span><span>{c.label}</span><small>{c.present ? 'Present' : 'Not observed'}</small></div>)}
    </section>}
  </div><section className="panel output-panel"><div className="section-line"><div><span className="eyebrow">03 · REVIEW AND EXPORT</span><h2>Drafts for your product page</h2><p>Review the copy and structured data before applying the changes to your site.</p></div><span className="pill">{assets ? assets.mode === 'ai' ? 'AI DRAFT' : 'SOURCE EXPORT' : 'AWAITING SOURCE'}</span></div>
    <div className="output-toolbar"><div className="tab-buttons" role="tablist" aria-label="GEO deliverables">{tabs.map(t => <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls="asset-output" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}><t.icon size={14} />{t.label}</button>)}</div>
      <div className="output-actions"><button className="icon-button" aria-label="Download current asset" disabled={!assets} onClick={() => assets && download(tabs.find(t => t.key === tab)!.file, assets[tab])}><ArrowDownToLine size={16} /></button><button className="primary small" disabled={!assets} onClick={copy}>{copied ? <CheckCheck size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy code'}</button></div></div>
    {assets ? <><div className="code-header"><span className="mono">{tabs.find(t => t.key === tab)?.file}</span><span>REVIEW BEFORE PUBLISHING</span></div><pre role="tabpanel" id="asset-output" aria-labelledby={`tab-${tab}`} tabIndex={0}><code>{assets[tab]}</code></pre><div className="asset-warnings">{assets.warnings.map(w => <p key={w}>{w}</p>)}</div></> : <div className="output-empty" id="asset-output" role="tabpanel" aria-labelledby={`tab-${tab}`}><FileCode2 size={40} /><h3>Your next version starts here.</h3><p>Supply product content to generate a rewrite,<br />Product + FAQ structured data, and an llms.txt draft.<br />No invented reviews. No promised ranking gains.</p></div>}
  </section></div>;
}
