import { ArrowDownToLine, ArrowRight, ChevronDown, ExternalLink, Layers3, MessageSquare, ScanSearch, Target } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Rank } from './AuditLauncher';
import { citesSite, clientMention, ENGINES, namesBrand, sameBrand, type Audit } from './types';

export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Empty({ launch }: { launch: () => void }) {
  return <section className="empty-state panel"><div className="empty-art"><div className="orbit one" /><div className="orbit two" /><ScanSearch size={43} /><span className="orbital-symbol o1">◎</span><span className="orbital-symbol o2">✳</span><span className="orbital-symbol o3">✦</span></div>
    <span className="eyebrow">START WITH A BUYER QUESTION</span><h2>Your next customer<br />is asking AI.</h2><p>Run a live audit, check whether your brand appears in OpenAI and Perplexity answers, and use the evidence to improve your product page.</p>
    <button className="primary" onClick={launch}>Create your first audit <ArrowRight size={17} /></button><span className="fine-print">Your data. Your API accounts. Inspectable results.</span></section>;
}

function percent(value: number | null | undefined) { return value == null ? '—' : `${value}%`; }

export function Overview({ audit, launch, diagnose }: { audit: Audit | null; launch: () => void; diagnose: () => void }) {
  if (!audit) return <Empty launch={launch} />;
  const s = audit.summary;
  if (!s) return <section className="panel empty-state"><ScanSearch size={35} className="pulse" /><h2>{audit.status === 'failed' ? 'Audit interrupted' : 'Listening to the engines'}</h2><p>{audit.results.length} responses received. {audit.status === 'failed' ? 'Start a new audit to try again.' : 'The overview will appear when all queries finish.'}</p><button className="secondary" onClick={launch}>View query radar <ArrowRight size={16} /></button></section>;
  const successful = audit.results.filter(r => r.status === 'success');
  const sourceLinks = new Map<string, string>();
  const citationCounts = new Map<string, number>();
  for (const answer of successful) {
    const domains = new Set<string>();
    for (const url of answer.citations) {
      if (!URL.canParse(url)) continue;
      const source = new URL(url);
      if (source.protocol !== 'https:') continue;
      const domain = source.hostname.replace(/^www\./, '');
      domains.add(domain);
      if (!sourceLinks.has(domain)) sourceLinks.set(domain, url);
    }
    for (const domain of domains) citationCounts.set(domain, (citationCounts.get(domain) ?? 0) + 1);
  }
  const sites = s.cited_domains ?? Array.from(citationCounts, ([domain, response_count]) => ({ domain, response_count }))
    .sort((a, b) => b.response_count - a.response_count || a.domain.localeCompare(b.domain));
  const rankedQueries = s.ranked_queries ?? successful.filter(r => r.mentions.some(m => m.rank_position != null)).length;
  const rankedBrands = s.brand_leaderboard.filter(brand => brand.rank_points > 0);
  const chartBrands = rankedBrands.slice(0, 10);
  const skipped = audit.results.filter(r => r.skipped).length;
  const accessErrors = Array.from(new Set(audit.results.filter(r => r.access_error).map(r => r.error)));
  return <>
    <section className="panel overview-sample"><div className="section-line"><div><h2>Answers included in this audit</h2>
      <p>{s.successful_queries} of {s.total_queries} planned answers succeeded. {rankedQueries} contained a verified ranking. {s.failed_queries - skipped} failed and {skipped} were skipped.</p></div>
      <button className="secondary small" onClick={diagnose}>Inspect answers and sources <ArrowRight size={14} /></button>
    </div>{accessErrors.map(error => <p className="notice" key={error}>{error}</p>)}</section>
    <div className="kpi-grid">
      <article className="panel kpi"><div className="kpi-label">Weighted share of model <Layers3 size={16} /></div><strong className="metric">{percent(s.weighted_som_pct)}</strong><span className="metric-note">{s.total_rank_points ? `${s.rank_points} of ${s.total_rank_points} verified rank points` : 'No verified rankings in this audit'}</span></article>
      <article className={`panel kpi ${s.visibility_pct === 0 ? 'zero-visibility' : ''}`}><div className="kpi-label">AI answer visibility <Target size={16} /></div><strong className="metric">{percent(s.visibility_pct)}</strong><span className="metric-note">Named in {s.mentioned_responses} / {s.successful_queries} successful answers</span></article>
    </div>
    <div className="chart-row"><section className="panel chart-panel"><div className="section-line"><div><h2>The recommendation landscape</h2><p>Top ranked brands by share of the audit’s verified rank points</p></div><span className="pill">{rankedBrands.length} ranked</span></div>
      {chartBrands.length ? <div className="chart" role="img" aria-label="Weighted share of model by brand"><ResponsiveContainer width="100%" height={Math.max(140, 34 * chartBrands.length + 48)}>
        <BarChart layout="vertical" data={chartBrands} margin={{ left: 0, right: 28, top: 20, bottom: 10 }} barSize={19}>
          <CartesianGrid stroke="#1f2937" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="brand" width={125} tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={value => [`${value}%`, 'Share of model']} contentStyle={{ background: '#111827', border: '1px solid #334155', borderRadius: 9, color: '#F8FAFC' }} cursor={{ fill: '#ffffff04' }} />
          <Bar dataKey="weighted_som_pct" radius={[0, 4, 4, 0]} isAnimationActive={false}>{chartBrands.map(b => <Cell key={b.brand} fill={sameBrand(b.brand, audit.request.brand) ? '#BEF264' : '#64748B'} />)}</Bar>
        </BarChart></ResponsiveContainer></div> : <p className="overview-empty">The answers contain no explicit rankings to chart.</p>}
      <details className="data-details"><summary>View all brand data</summary><table><thead><tr><th>Brand</th><th>Answers</th><th>Rank points</th><th>Weighted share</th></tr></thead><tbody>{s.brand_leaderboard.map(b => <tr key={b.brand}><td>{b.brand}</td><td>{b.mentions}</td><td>{b.rank_points}</td><td>{percent(b.weighted_som_pct)}</td></tr>)}</tbody></table></details>
    </section>
      <section className="panel chart-panel"><div className="section-line"><div><h2>Visibility by engine</h2><p>How often your brand appears</p></div></div>
        <div className="engine-breakdown">{ENGINES.map(e => { const row = s.engine_breakdown.find(r => r.provider === e.id); return <div key={e.id}><div className="engine-bar-heading"><span><span className="engine-symbol">{e.mark}</span>{e.name}</span><strong className="mono">{percent(row?.visibility_pct)}</strong></div><div className="bar-track"><span style={{ width: `${row?.visibility_pct || 0}%` }} /></div><small>{row?.mentioned || 0} mentions · {row?.successful || 0} successful answers</small></div>; })}</div>
      </section></div>
    <section className="panel authority"><div className="section-line"><div><h2>Cited websites</h2><p>Top websites by how often engines cited them. Each website counts once per successful answer.</p></div><span className="pill">{sites.length} domains</span></div>
      {sites.length ? <><ol className="site-chart" aria-label="Cited websites by number of answers">{sites.slice(0, 8).map(site => <li key={site.domain}>
        <div className="engine-bar-heading"><strong>{site.domain}</strong><span>{site.response_count} of {s.successful_queries} answers</span></div>
        <div className="bar-track" aria-hidden="true"><span style={{ width: `${100 * site.response_count / s.successful_queries}%` }} /></div>
      </li>)}</ol><details className="data-details"><summary>View all cited website data</summary><table><thead><tr><th>Domain</th><th>Answers</th><th>Share of successful answers</th></tr></thead><tbody>{sites.map(site => <tr key={site.domain}><td>{sourceLinks.has(site.domain) ? <a href={sourceLinks.get(site.domain)} target="_blank" rel="noreferrer">{site.domain} <ExternalLink size={12} /></a> : site.domain}</td><td>{site.response_count}</td><td>{percent(Math.round(1000 * site.response_count / s.successful_queries) / 10)}</td></tr>)}</tbody></table></details></> : <p className="overview-empty">No cited websites in the successful answers.</p>}
    </section>
    <div className="methodology"><MessageSquare size={16} /><p>Weighted share divides the brand’s rank points by the total across all ranked brands. A first place earns 3 points, second earns 2, third earns 1, and fourth or lower earns 0.5. Mentions without a verified rank earn zero. An answer can cite multiple domains, so website shares can add up to more than 100%.</p></div>
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
  const { brand, target_url: site } = audit.request;
  const engines = ENGINES.filter(e => audit.request.providers.includes(e.id));
  const generic = audit.summary?.generic_visibility;
  const rows = audit.request.prompts.map((prompt, index) => ({ prompt, index, results: audit.results.filter(r => r.prompt_index === index && engines.some(e => e.id === r.provider)) }));
  const filtered = rows.filter(({ results, index }) => {
    if (filter === 'generic') return generic?.prompt_indices.includes(index);
    if (filter === 'invisible') return results.some(r => r.status === 'success') && !results.some(r => namesBrand(r, brand) || citesSite(r, site));
    if (filter === 'first') return results.some(r => clientMention(r, brand)?.rank_position === 1);
    return true;
  });
  const filters = [['all', 'All prompts'], ['invisible', 'No brand or site'], ['first', 'Ranked #1']];
  if (generic) filters.splice(1, 0, ['generic', 'Generic score questions']);
  return <section className="panel matrix-panel">
    <div className="workflow-help"><h2>Read the evidence behind your score</h2><p>Open a buyer question to read each engine’s answer, see any exact brand quotes, and follow the sources it cited.</p><p><strong>Mentioned</strong> means the brand appears in the text. <strong>Site cited</strong> means the engine linked to your website. A rank is shown only when the answer explicitly orders recommendations. Open a failed answer for its error, or send a question to the optimizer to plan a page change.</p>
      {!engines.length && <p>This saved audit used a retired engine. Export its original evidence to read the responses.</p>}</div>
    <div className="section-line matrix-toolbar"><div className="tab-buttons" aria-label="Filter buyer prompts">{filters.map(([key, name]) => <button className={filter === key ? 'active' : ''} aria-pressed={filter === key} key={key} onClick={() => { setFilter(key); setExpanded(null); }}>{name}</button>)}</div>
    <button className="secondary small" onClick={() => download('audit.json', JSON.stringify(audit, null, 2), 'application/json')}><ArrowDownToLine size={14} />Export evidence</button></div>
    <div className="table-scroll"><table className="matrix"><thead><tr><th>BUYER PROMPT</th>{engines.map(e => <th key={e.id}><span className="engine-symbol">{e.mark}</span>{e.name}</th>)}<th>WHAT TO INSPECT</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{filtered.map(({ prompt, index, results }) => {
        const pattern = results.flatMap(r => r.structural_winner_patterns)[0];
        return <Row key={index}><tr className={expanded === index ? 'expanded' : ''}><td><button className="prompt-expand" onClick={() => setExpanded(expanded === index ? null : index)} aria-expanded={expanded === index} aria-controls={`answers-${index}`}><span className="mono muted">{String(index + 1).padStart(2, '0')}</span><span>{prompt}</span><ChevronDown className={expanded === index ? 'rotate' : ''} size={15} /></button></td>
          {engines.map(e => <td key={e.id}><Rank result={results.find(r => r.provider === e.id)} brand={brand} site={site} /></td>)}
          <td><span className="signal-badge">{results.some(r => r.status === 'error') ? 'Open for request errors' : pattern || 'Open the answers and sources'}</span>{generic && <small className="winner-label">{generic.prompt_indices.includes(index) ? 'Eligible for generic visibility' : 'Outside generic visibility'}</small>}</td>
          <td><button className="text-button" onClick={() => fix(prompt)}>Optimize for this question <ArrowRight size={14} /></button></td></tr>
          {expanded === index && <tr id={`answers-${index}`} className="drawer-row"><td colSpan={engines.length + 3}><div className="answer-grid">{engines.map(e => {
            const result = results.find(r => r.provider === e.id);
            return <article className="answer-card" key={e.id}><div className="section-line"><h3><span className="engine-symbol">{e.mark}</span>{e.name}</h3><Rank result={result} brand={brand} site={site} /></div>
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
