import { ArrowRight, Check, LoaderCircle, Plus, Radio, RefreshCw, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import { clientMention, ENGINES, type Audit, type AuditRequest, type Health, type QueryResult } from './types';

export const defaultPrompts = [
  'What are the best CRM platforms for a growing B2B sales team?',
  'Which enterprise CRM is easiest to implement?',
  'What CRM offers the most transparent pricing for midmarket businesses?',
  'Compare CRM tools for sales pipeline reporting.',
  'Which CRM is best for a remote sales team?',
  'What are the best alternatives to Salesforce for small companies?',
  'Which CRM integrates well with existing marketing tools?',
  'What should I look for in an enterprise CRM?',
  'Which CRM platforms support complex B2B sales workflows?',
  'What CRM offers the best balance of usability and customization?',
];
export const initialRequest: AuditRequest = {
  brand: '', target_url: '', competitors: [], prompts: defaultPrompts, mode: 'live',
  providers: ['openai', 'perplexity', 'gemini'], monthly_organic_revenue: null, displacement_assumption: 0.2,
};

export function Rank({ result, brand }: { result?: QueryResult; brand: string }) {
  if (!result) return <span className="rank pending">—</span>;
  if (result.status === 'error') return <span className="rank warning" title={result.error || ''}>Failed</span>;
  const mention = clientMention(result, brand);
  return <span className={`rank ${mention?.rank_position === 1 ? 'first' : ''}`}>
    {mention ? mention.rank_position ? `#${mention.rank_position}` : 'Mentioned' : 'Not named'}
  </span>;
}

export default function AuditLauncher({ form, setForm, health, audit, launch, busy, refresh }: {
  form: AuditRequest; setForm: (v: AuditRequest) => void; health: Health | null; audit: Audit | null;
  launch: (v: AuditRequest) => void; busy: boolean; refresh: () => void;
}) {
  const [competitor, setCompetitor] = useState('');
  const update = <K extends keyof AuditRequest>(key: K, value: AuditRequest[K]) => setForm({ ...form, [key]: value });
  const total = form.prompts.filter(p => p.trim()).length * form.providers.length;
  const addCompetitor = () => {
    const value = competitor.trim();
    if (value && form.competitors.length < 8 && !form.competitors.some(v => v.toLowerCase() === value.toLowerCase())) {
      update('competitors', [...form.competitors, value]); setCompetitor('');
    }
  };
  return <div className="launch-layout">
    <form className="panel launch-form" onSubmit={event => { event.preventDefault(); launch({ ...form, prompts: form.prompts.filter(p => p.trim()) }); }}>
      <div className="panel-heading"><span className="step-dot">01</span><div><h2>Set your signal</h2><p>Where should AI answers be finding you?</p></div></div>
      <div className="field-row"><label>Brand name<input required minLength={2} maxLength={80} placeholder="e.g. CloudScale CRM" value={form.brand} onChange={e => update('brand', e.target.value)} /></label>
        <label>Product page URL<input type="url" required placeholder="https://yourbrand.com/product" value={form.target_url} onChange={e => update('target_url', e.target.value)} /></label></div>
      <label>Competitor brands <span className="muted">optional · up to 8</span></label>
      <div className="chip-input"><div className="chips">{form.competitors.map(c => <button type="button" key={c} className="chip" aria-label={`Remove ${c}`} onClick={() => update('competitors', form.competitors.filter(v => v !== c))}>{c} ×</button>)}</div>
        <input aria-label="Competitor brand" placeholder="Type a brand and press Enter" value={competitor} onChange={e => setCompetitor(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCompetitor(); } }} />
        <button className="icon-button" type="button" aria-label="Add competitor" onClick={addCompetitor}><Plus size={17} /></button></div>
      <div className="section-line"><label htmlFor="prompts">Buyer prompts <span className="muted">one per line · 1–10</span></label>
        <button className="text-button" type="button" onClick={() => {
          const topic = form.brand.trim() || 'this product';
          update('prompts', [`What are the best alternatives to ${topic}?`, `How does ${topic} compare with other options?`, `Is ${topic} a good fit for a growing business?`, `What should buyers consider before choosing ${topic}?`, `Which products compete with ${topic} on price?`, `What do independent reviews say about ${topic}?`, `What are the main strengths and limitations of ${topic}?`, `Which alternatives to ${topic} are easiest to adopt?`, `How should a buyer evaluate ${topic}?`, `What are the best products in the same category as ${topic}?`]);
        }}><WandSparkles size={14} /> Suggest prompts</button></div>
      <textarea id="prompts" className="prompt-input" required rows={10} value={form.prompts.join('\n')} onChange={e => update('prompts', e.target.value.split('\n'))} />
      <p className="fine-print">Suggestions are editable templates. Use unbranded category questions to avoid biasing visibility.</p>
      <fieldset><legend>Search-grounded engines</legend><div className="engine-choices">{ENGINES.map(engine => <label className={`engine-choice ${form.providers.includes(engine.id) ? 'selected' : ''}`} key={engine.id}>
        <input type="checkbox" checked={form.providers.includes(engine.id)} onChange={e => update('providers', e.target.checked ? [...form.providers, engine.id] : form.providers.filter(p => p !== engine.id))} />
        <span className="engine-symbol">{engine.mark}</span><span>{engine.name}<small>{health?.providers.find(p => p.id === engine.id)?.configured ? 'Key configured' : 'Key required'}</small></span>
      </label>)}</div></fieldset>
      <div className="mode-row"><label htmlFor="mode">Run mode</label><select id="mode" value={form.mode} onChange={e => update('mode', e.target.value as 'live' | 'demo')}><option value="live">Live · real provider API calls</option><option value="demo">Demo · synthetic data, no API calls</option></select></div>
      {form.mode === 'demo' && <div className="notice">Demo results are synthetic and cannot be used to assess actual brand visibility.</div>}
      <details className="advanced"><summary>Revenue scenario assumptions <span>optional</span></summary>
        <div className="field-row"><label>Monthly organic revenue (USD)<input type="number" min="0" max="1000000000000" value={form.monthly_organic_revenue ?? ''} onChange={e => update('monthly_organic_revenue', e.target.value === '' ? null : Number(e.target.value))} /></label>
          <label>Assumed AI displacement (%)<input type="number" min="0" max="100" value={form.displacement_assumption * 100} onChange={e => update('displacement_assumption', Number(e.target.value) / 100)} /></label></div>
        <p className="fine-print">A user-defined scenario, not a measured loss: revenue × unmentioned share × displacement assumption.</p>
      </details>
      <button className="primary full" type="submit" disabled={busy || total === 0 || form.prompts.filter(p => p.trim()).length > 10}>
        {busy ? <LoaderCircle className="spin" size={17} /> : <Radio size={17} />}{busy ? 'Audit in progress' : `Launch ${total}-query ${form.mode === 'live' ? 'live' : 'demo'} audit`}<ArrowRight size={17} />
      </button><p className="fine-print center">Live mode uses your provider accounts and may incur API charges.</p>
    </form>
    <div className="launch-side">
      <section className="panel"><div className="section-line"><h2>Engine readiness</h2><button className="icon-button" aria-label="Refresh engine readiness" onClick={refresh}><RefreshCw size={15} /></button></div>
        {ENGINES.map(e => { const configured = health?.providers.find(p => p.id === e.id); return <div className="readiness-row" key={e.id}><span className="engine-symbol">{e.mark}</span><div><strong>{e.name}</strong><small className="mono">{configured?.model || 'Checking…'}</small></div><span className={`status-dot ${configured?.configured ? 'ready' : ''}`} /><span className="fine-print">{configured?.configured ? 'Configured' : 'Needs key'}</span></div>; })}
        <p className="fine-print">Configured means a key is present. Successful grounded responses confirm access. Add keys securely in environment settings, then refresh.</p>
      </section>
      <section className="panel radar-panel"><div className="section-line"><div><span className="eyebrow">QUERY RADAR</span><h2>Answers as they arrive</h2></div><Radio size={20} className={busy ? 'pulse' : 'muted'} /></div>
        {audit ? <><div className="progress-label"><span>{audit.results.length} / {audit.request.prompts.length * audit.request.providers.length} queries</span><span className="mono">{audit.request.mode.toUpperCase()}</span></div><progress max={audit.request.prompts.length * audit.request.providers.length} value={audit.results.length} />
          <div className="radar-grid"><span>Prompt</span>{ENGINES.map(e => <span key={e.id} title={e.name}>{e.mark}</span>)}
            {audit.request.prompts.map((_, i) => <div className="radar-row" key={i}><span className="mono">{String(i + 1).padStart(2, '0')}</span>{ENGINES.map(e => <Rank key={e.id} brand={audit.request.brand} result={audit.results.find(r => r.prompt_index === i && r.provider === e.id)} />)}</div>)}
          </div></> : <div className="radar-idle"><div className="radar-orbit"><Radio size={30} /></div><h3>Ready when you are</h3><p>Every answer, rank, and citation appears here as your audit runs.</p></div>}
      </section>
      <div className="small-note"><Check size={16} /><p>Every live result requires web-grounding citations. Failures stay visible and are excluded from metrics.</p></div>
    </div>
  </div>;
}
