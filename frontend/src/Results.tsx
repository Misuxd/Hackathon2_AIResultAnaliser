import { ArrowDownToLine, ArrowRight, ChevronDown, ExternalLink, FileSearch, Globe, Layers3, MessageSquare, ScanSearch, Target } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Rank } from './AuditLauncher';
import { clientMention, ENGINES, sameBrand, type Audit } from './types';

export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Empty({ launch }: { launch: () => void }) {
  return <section className="empty-state panel"><div className="empty-art"><div className="orbit one" /><div className="orbit two" /><ScanSearch size={43} /><span className="orbital-symbol o1">◎</span><span className="orbital-symbol o2">✳</span><span className="orbital-symbol o3">✦</span></div>
    <span className="eyebrow">MAKE YOUR BRAND VISIBLE</span><h2>Your next customer<br />is asking AI.</h2><p>Find out if your brand is in the answer.<br />Measure grounded recommendations across three engines,<br className="desktop" /> inspect the evidence, and improve your product content.</p>
    <button className="primary" onClick={launch}>Create your first audit <ArrowRight size={17} /></button><span className="fine-print">Your data. Your API accounts. Inspectable results.</span></section>;
}

function percent(value: number | null | undefined) { return value == null ? '—' : `${value}%`; }

export function Overview({ audit, launch, diagnose }: { audit: Audit | null; launch: () => void; diagnose: () => void }) {
  if (!audit) return <Empty launch={launch} />;
  const s = audit.summary;
  if (!s) return <section className="panel empty-state"><ScanSearch size={35} className="pulse" /><h2>{audit.status === 'failed' ? 'Audit interrupted' : 'Listening to the engines'}</h2><p>{audit.results.length} responses received. {audit.status === 'failed' ? 'Start a new audit to try again.' : 'The overview will appear when all queries finish.'}</p><button className="secondary" onClick={launch}>View query radar <ArrowRight size={16} /></button></section>;
  return <>
    {s.successful_queries === 0 && <div className="notice">All {s.failed_queries} provider requests failed. Metrics are unavailable. Inspect the citation matrix for errors.</div>}
    <div className="kpi-grid">
      <article className="panel kpi"><div className="kpi-label">Weighted share of model <Layers3 size={16} /></div><strong className="metric">{percent(s.weighted_som_pct)}</strong><span className="metric-note"><span className="tiny-square" />{s.rank_points} of {s.total_rank_points} rank points</span></article>
      <article className={`panel kpi ${s.visibility_pct === 0 ? 'zero-visibility' : ''}`}><div className="kpi-label">AI answer visibility <Target size={16} /></div><strong className="metric">{percent(s.visibility_pct)}</strong><span className="metric-note">Named in {s.mentioned_responses} / {s.successful_queries} successful answers</span></article>
      <article className="panel kpi"><div className="kpi-label">Revenue scenario <Globe size={16} /></div><strong className="metric">{s.revenue_scenario_usd == null ? '—' : `$${s.revenue_scenario_usd.toLocaleString()}`}</strong><span className="metric-note">{s.revenue_scenario_usd == null ? 'Add assumptions in your next audit' : `Per month · ${s.scenario_assumption * 100}% assumed displacement`}</span></article>
      <article className="panel kpi"><div className="kpi-label">Next content check <FileSearch size={16} /></div><strong className="gap-label">{s.primary_gap}</strong><button className="text-button" onClick={diagnose}>Inspect evidence <ArrowRight size={14} /></button></article>
    </div>
    <div className="chart-row"><section className="panel chart-panel"><div className="section-line"><div><h2>The recommendation landscape</h2><p>Weighted share of model across observed brands</p></div><span className="pill">{s.brand_leaderboard.length} brands</span></div>
      <div className="chart" role="img" aria-label="Weighted share of model by brand"><ResponsiveContainer width="100%" height={280}>
        <BarChart layout="vertical" data={s.brand_leaderboard} margin={{ left: 0, right: 28, top: 20, bottom: 10 }} barSize={19}>
          <CartesianGrid stroke="#1f2937" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="brand" width={125} tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={value => [`${value}%`, 'Share of model']} contentStyle={{ background: '#111827', border: '1px solid #334155', borderRadius: 9, color: '#F8FAFC' }} cursor={{ fill: '#ffffff04' }} />
          <Bar dataKey="weighted_som_pct" radius={[0, 4, 4, 0]} isAnimationActive={false}>{s.brand_leaderboard.map(b => <Cell key={b.brand} fill={sameBrand(b.brand, audit.request.brand) ? '#BEF264' : '#334155'} />)}</Bar>
        </BarChart></ResponsiveContainer></div>
      <details className="data-details"><summary>View chart data</summary><table><thead><tr><th>Brand</th><th>Rank points</th><th>SoM</th></tr></thead><tbody>{s.brand_leaderboard.map(b => <tr key={b.brand}><td>{b.brand}</td><td>{b.rank_points}</td><td>{percent(b.weighted_som_pct)}</td></tr>)}</tbody></table></details>
    </section>
      <section className="panel chart-panel"><div className="section-line"><div><h2>Visibility by engine</h2><p>How often your brand appears</p></div></div>
        <div className="engine-breakdown">{ENGINES.map(e => { const row = s.engine_breakdown.find(r => r.provider === e.id); return <div key={e.id}><div className="engine-bar-heading"><span><span className="engine-symbol">{e.mark}</span>{e.name}</span><strong className="mono">{percent(row?.visibility_pct)}</strong></div><div className="bar-track"><span style={{ width: `${row?.visibility_pct || 0}%` }} /></div><small>{row?.mentioned || 0} mentions · {row?.successful || 0} successful answers</small></div>; })}</div>
      </section></div>
    <section className="panel authority"><div className="section-line"><div><h2>Citation authority</h2><p>External domains cited in successful responses · a citation does not confirm a brand listing</p></div><span className="pill">SOURCE SIGNALS</span></div>
      {s.top_third_party_domains.length ? <div className="authority-grid">{s.top_third_party_domains.map((d, i) => <div className="authority-item" key={d.domain}><span className="domain-icon"><Globe size={18} /></span><div><strong>{d.domain}</strong><small>Cited in {d.response_count} responses</small></div><span className="mono muted">{String(i + 1).padStart(2, '0')}</span></div>)}</div> : <p className="muted">No external citation domains available.</p>}
    </section>
    <div className="methodology"><MessageSquare size={16} /><p>{s.methodology} {s.failed_queries > 0 && `${s.failed_queries} failed queries excluded. `}Revenue figures are scenarios, not measured losses. No historical delta is inferred.</p></div>
  </>;
}

function Highlight({ text, brand }: { text: string; brand: string }) {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return <>{text.split(new RegExp(`(${escaped})`, 'gi')).map((part, i) => part.toLowerCase() === brand.toLowerCase() ? <mark key={i}>{part}</mark> : part)}</>;
}

export function CitationMatrix({ audit, launch, fix }: { audit: Audit | null; launch: () => void; fix: (prompt: string) => void }) {
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  if (!audit) return <Empty launch={launch} />;
  const rows = audit.request.prompts.map((prompt, index) => ({ prompt, index, results: audit.results.filter(r => r.prompt_index === index) }));
  const filtered = rows.filter(({ results }) => filter === 'all' || (filter === 'invisible'
    ? results.some(r => r.status === 'success') && !results.some(r => clientMention(r, audit.request.brand))
    : results.some(r => clientMention(r, audit.request.brand)?.rank_position === 1)));
  return <section className="panel matrix-panel"><div className="section-line matrix-toolbar"><div className="tab-buttons" aria-label="Filter buyer prompts">{[['all', 'All prompts'], ['invisible', 'Not mentioned'], ['first', 'Ranked #1']].map(([key, name]) => <button className={filter === key ? 'active' : ''} key={key} onClick={() => { setFilter(key); setExpanded(null); }}>{name}</button>)}</div>
    <button className="secondary small" onClick={() => download('audit.json', JSON.stringify(audit, null, 2), 'application/json')}><ArrowDownToLine size={14} />Export evidence</button></div>
    <div className="table-scroll"><table className="matrix"><thead><tr><th>BUYER PROMPT</th>{ENGINES.map(e => <th key={e.id}><span className="engine-symbol">{e.mark}</span>{e.name}</th>)}<th>OBSERVED SIGNAL</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{filtered.map(({ prompt, index, results }) => {
        const winner = results.flatMap(r => r.mentions).find(m => m.rank_position === 1 && !sameBrand(m.brand_name, audit.request.brand));
        const pattern = results.flatMap(r => r.structural_winner_patterns)[0];
        return <Row key={index}><tr className={expanded === index ? 'expanded' : ''}><td><button className="prompt-expand" onClick={() => setExpanded(expanded === index ? null : index)} aria-expanded={expanded === index} aria-controls={`answers-${index}`}><span className="mono muted">{String(index + 1).padStart(2, '0')}</span><span>{prompt}</span><ChevronDown className={expanded === index ? 'rotate' : ''} size={15} /></button></td>
          {ENGINES.map(e => <td key={e.id}><Rank result={results.find(r => r.provider === e.id)} brand={audit.request.brand} /></td>)}
          <td><span className="signal-badge">{pattern || (results.some(r => r.status === 'error') ? 'Inspect provider errors' : 'Inspect answer evidence')}</span>{winner && <small className="winner-label">First recommendation includes {winner.brand_name}</small>}</td>
          <td><button className="text-button nowrap" onClick={() => fix(prompt)}>Fix this gap <ArrowRight size={14} /></button></td></tr>
          {expanded === index && <tr id={`answers-${index}`} className="drawer-row"><td colSpan={6}><div className="answer-grid">{ENGINES.map(e => {
            const result = results.find(r => r.provider === e.id);
            return <article className="answer-card" key={e.id}><div className="section-line"><h3><span className="engine-symbol">{e.mark}</span>{e.name}</h3><Rank result={result} brand={audit.request.brand} /></div>
              <p className="answer-text">{result?.status === 'error' ? result.error : result ? <Highlight text={result.answer} brand={audit.request.brand} /> : 'No response available.'}</p>
              {result?.mentions.map(m => <details className="mention-evidence" key={m.brand_name}><summary>{m.brand_name} · {m.sentiment}</summary><blockquote>{m.evidence}</blockquote><p>{m.reason_for_inclusion}</p></details>)}
              <div className="source-links"><span className="eyebrow">{result?.citations.length || 0} SOURCE LINKS {audit.request.mode === 'demo' && '· DEMO'}</span>{result?.citations.map((url, i) => <a href={url} target="_blank" rel="noreferrer" key={url}><span>{i + 1}. {url}</span><ExternalLink size={12} /></a>)}</div>
            </article>;
          })}</div></td></tr>}
        </Row>;
      })}</tbody></table></div>
    {!filtered.length && <p className="empty-filter">No prompts match this filter.</p>}
    <div className="table-footer"><span>{filtered.length} of {rows.length} prompts</span><span>Ranks reflect explicit ordering · unranked mentions remain unranked</span></div>
  </section>;
}

// A fragment preserves valid table markup for an expandable two-row record.
import { Fragment as Row } from 'react';
