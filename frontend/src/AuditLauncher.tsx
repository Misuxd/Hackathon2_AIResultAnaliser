import { ArrowRight, Check, LoaderCircle, Radio, RefreshCw, WandSparkles } from 'lucide-react';
import { citesSite, clientMention, ENGINES, namesBrand, type Audit, type AuditRequest, type Health, type QueryResult } from './types';

function suggestedPrompts(category: string) {
  return [
    `What are the best options for ${category}?`,
    `Who benefits most from ${category}?`,
    `What features matter most when evaluating ${category}?`,
    `How do the leading options for ${category} compare?`,
    `What trade-offs should buyers consider when choosing ${category}?`,
    `How should a small team evaluate ${category}?`,
    `Which options for ${category} are easiest to get started with?`,
    `What does pricing typically look like for ${category}?`,
    `What evidence should buyers look for before choosing ${category}?`,
    `What questions should buyers ask when shortlisting ${category}?`,
  ];
}
export const initialRequest: AuditRequest = {
  brand: '', target_url: '', offering: '', prompts: [''], mode: 'live', providers: ENGINES.map(engine => engine.id),
};

export function Rank({ result, brand, site }: { result?: QueryResult; brand: string; site: string }) {
  if (!result) return <span className="rank pending">—</span>;
  if (result.status === 'error') return <span className="rank warning" title={result.error || ''}>{result.skipped ? 'Not run' : 'Failed'}</span>;
  const mention = clientMention(result, brand);
  return <span className={`rank ${mention?.rank_position === 1 ? 'first' : ''}`}>
    {mention?.rank_position ? `#${mention.rank_position}` : namesBrand(result, brand) ? 'Mentioned' : citesSite(result, site) ? 'Site cited' : 'Not shown'}
  </span>;
}

export default function AuditLauncher({ form, setForm, health, audit, launch, busy, refresh, inspect }: {
  form: AuditRequest; setForm: (v: AuditRequest) => void; health: Health | null; audit: Audit | null;
  launch: (v: AuditRequest) => void; busy: boolean; refresh: () => void; inspect: () => void;
}) {
  const update = <K extends keyof AuditRequest>(key: K, value: AuditRequest[K]) => setForm({ ...form, [key]: value });
  const live = form.mode === 'live';
  const configuredProviders = health?.providers.filter(p => p.configured).map(p => p.id) ?? [];
  const providers = live ? form.providers.filter(p => configuredProviders.includes(p)) : form.providers;
  const total = form.prompts.filter(p => p.trim()).length * providers.length;
  const category = form.offering?.trim() ?? '';
  const visibility = audit?.summary?.generic_visibility;
  const percentage = visibility?.percentage;
  const accessErrors = Array.from(new Set(audit?.results.filter(r => r.access_error).map(r => r.error)));
  return <><div className="launch-layout">
    <form className="panel launch-form" onSubmit={event => {
      event.preventDefault();
      if (total > 0) launch({ ...form, providers, prompts: form.prompts.filter(p => p.trim()) });
    }}>
      <div className="panel-heading"><span className="step-dot">01</span><div><h2>Set up your audit</h2><p>Describe what you sell, then choose the questions and engines to test.</p></div></div>
      <div className="field-row"><label>Brand name<input required minLength={2} maxLength={80} placeholder="e.g. CloudScale CRM" value={form.brand} onChange={e => update('brand', e.target.value)} /></label>
        <label>Product page URL<input type="url" required placeholder="https://yourbrand.com/product" value={form.target_url} onChange={e => update('target_url', e.target.value)} /></label></div>
      <label>Product category or buyer need<input required maxLength={120} placeholder="e.g. payroll software" value={form.offering ?? ''} onChange={e => update('offering', e.target.value)} /></label>
      <div className="section-line"><label htmlFor="prompts">Buyer prompts <span className="muted">one per line · 1–10</span></label>
        <button className="text-button" type="button" disabled={!category} onClick={() => update('prompts', suggestedPrompts(category))}><WandSparkles size={14} /> Suggest prompts</button></div>
      <textarea id="prompts" className="prompt-input" required rows={10} value={form.prompts.join('\n')} onChange={e => update('prompts', e.target.value.split('\n'))} />
      <p className="fine-print">For the visibility score, use your category phrase and leave brand names and websites out of the question.</p>
      <fieldset><legend>Search-grounded engines</legend><div className="engine-choices">{ENGINES.map(engine => {
        const configured = configuredProviders.includes(engine.id);
        const selected = providers.includes(engine.id);
        return <label className={`engine-choice ${selected ? 'selected' : ''}`} key={engine.id}>
          <input type="checkbox" checked={selected} disabled={live && !configured} onChange={e => update('providers', e.target.checked ? [...form.providers, engine.id] : form.providers.filter(p => p !== engine.id))} />
          <span className="engine-symbol">{engine.mark}</span><span>{engine.name}<small className={live && configured ? 'key-configured' : undefined}>{!live ? 'Demo available' : !health ? 'Checking readiness' : configured ? 'Key configured' : 'Key required'}</small></span>
        </label>;
      })}</div></fieldset>
      <div className="mode-row"><label htmlFor="mode">Run mode</label><select id="mode" value={form.mode} onChange={e => update('mode', e.target.value as 'live' | 'demo')}><option value="live">Live · real provider API calls</option><option value="demo">Demo · synthetic data, no API calls</option></select></div>
      {live && health && configuredProviders.length === 0 && <div className="notice">Configure at least one API key to run a live audit.</div>}
      {form.mode === 'demo' && <div className="notice">Demo results are synthetic and cannot be used to assess actual brand visibility.</div>}
      <button className="primary full" type="submit" disabled={busy || total === 0 || form.prompts.filter(p => p.trim()).length > 10}>
        {busy ? <LoaderCircle className="spin" size={17} /> : <Radio size={17} />}{busy ? 'Audit in progress' : `Launch ${total}-query ${form.mode === 'live' ? 'live' : 'demo'} audit`}<ArrowRight size={17} />
      </button><p className="fine-print center">Live mode uses your provider accounts and may incur API charges.</p>
    </form>
    <div className="launch-side">
      <section className="panel"><div className="section-line"><h2>Engine readiness</h2><button className="icon-button" aria-label="Refresh engine readiness" onClick={refresh}><RefreshCw size={15} /></button></div>
        {ENGINES.map(e => { const configured = health?.providers.find(p => p.id === e.id); return <div className="readiness-row" key={e.id}><span className="engine-symbol">{e.mark}</span><div><strong>{e.name}</strong><small className="mono">{configured?.model || '—'}</small></div><span className={`status-dot ${configured?.configured ? 'ready' : ''}`} /><span className="fine-print">{!health ? 'Status unavailable' : configured?.configured ? 'Configured' : 'Needs key'}</span></div>; })}
        <p className="fine-print">Configured means a key is present. After editing <code>backend/.env</code>, restart the backend and refresh readiness.</p>
      </section>
      <section className="panel radar-panel"><div className="section-line"><div><span className="eyebrow">QUERY RADAR</span><h2>Answers as they arrive</h2></div><Radio size={20} className={busy ? 'pulse' : 'muted'} /></div>
        {audit ? <><div className="progress-label"><span>{audit.results.length} / {audit.request.prompts.length * audit.request.providers.length} queries</span><span className="mono">{audit.request.mode.toUpperCase()}</span></div><progress max={audit.request.prompts.length * audit.request.providers.length} value={audit.results.length} />
          <div className="radar-grid"><span>Prompt</span>{ENGINES.map(e => <span key={e.id} title={e.name}>{e.mark}</span>)}
            {audit.request.prompts.map((_, i) => <div className="radar-row" key={i}><span className="mono">{String(i + 1).padStart(2, '0')}</span>{ENGINES.map(e => <Rank key={e.id} brand={audit.request.brand} site={audit.request.target_url} result={audit.results.find(r => r.prompt_index === i && r.provider === e.id)} />)}</div>)}
          </div>{audit.summary && <a className="text-button" href="#audit-result">View visibility result <ArrowRight size={14} /></a>}
          {accessErrors.map(error => <p className="notice" key={error}>{error}</p>)}
          </> : <div className="radar-idle"><div className="radar-orbit"><Radio size={30} /></div><h3>Ready when you are</h3><p>Follow each engine’s answer here as the audit runs.</p></div>}
      </section>
      <div className="small-note"><Check size={16} /><p>Every live result requires web-grounding citations. Failures stay visible and are excluded from metrics.</p></div>
    </div>
  </div>
  {audit?.summary && <section className="panel audit-result" id="audit-result" aria-labelledby="audit-result-title">
    <div className="visibility-result">
      <div className="visibility-ring" role="img" aria-label={percentage == null ? 'Visibility unavailable' : `${percentage}% visibility`}>
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="51" className="ring-track" />
          {percentage != null && <circle cx="60" cy="60" r="51" pathLength="100" strokeDasharray={`${percentage} 100`} className="ring-fill" />}</svg>
        <strong>{percentage == null ? '—' : `${percentage}%`}</strong>
      </div>
      <div><span className="eyebrow">{audit.request.mode === 'demo' ? 'DEMO RESULT' : 'AUDIT RESULT'}</span><h2 id="audit-result-title">Visibility on generic buyer questions</h2>
        {percentage != null ? <p>Named or cited in <strong>{visibility?.appearances} of {visibility?.successful_answers}</strong> successful answers to {visibility?.prompt_indices.length} eligible questions.</p>
          : <p>{visibility ? 'No eligible questions received a successful answer.' : 'This saved audit predates generic visibility scoring.'}</p>}
        <p>Each successful answer counts once if it names your brand or cites your site. Only unbranded questions containing the category phrase count.</p>
        {audit.summary.failed_queries > 0 && <p>{audit.summary.failed_queries} queries failed or were skipped. Open the Citation Matrix for details.</p>}
        <button className="secondary small" onClick={inspect}>Inspect answers and sources <ArrowRight size={14} /></button>
      </div>
    </div>
  </section>}
  </>;
}
