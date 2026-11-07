import { useState } from 'react';
import { clientMention, ENGINES, type Audit, type VisibilityStats } from './types';

export function percent(value: number | null | undefined) {
  return value == null ? '—' : `${value}%`;
}

const providerName = (provider: string) => ENGINES.find(engine => engine.id === provider)?.name ?? provider;
const categories = { discovery: 'Unbranded discovery', brand_knowledge: 'Brand knowledge' } as const;
const outcomes = {
  website_cited: 'Website cited', brand_only: 'Brand mentioned only', neither: 'Neither', api_failure: 'API failure',
} as const;

export function ScoreStats({ score }: { score: VisibilityStats }) {
  return <>
    <p><strong>Brand mentions {percent(score.brand_mention_pct)}</strong> · <strong>Coverage {score.valid_answers}/{score.planned_answers}</strong> valid answers · {score.answered_questions}/{score.distinct_questions} distinct questions answered</p>
    {score.valid_answers < score.planned_answers && <p className="fine-print">Partial provider coverage. The score uses the providers that answered each question.</p>}
  </>;
}

export function ProviderScores({ score }: { score: VisibilityStats }) {
  return <ul className="provider-scores" aria-label="Visibility by provider">{score.providers.map(row => <li key={row.provider}>
    <strong>{providerName(row.provider)} {percent(row.percentage)}</strong> · {row.valid_answers}/{row.planned_answers} questions answered{row.model && <small className="muted"> · {row.model}</small>}
  </li>)}</ul>;
}

export function VisibilityReport({ audit }: { audit: Audit }) {
  const [filter, setFilter] = useState('all');
  const history = audit.summary?.history_visibility;
  const report = history ?? audit.summary?.observed_visibility;
  if (!report) return <section className="panel overview-sample"><h2>AI Visibility Score</h2><p>Run a new audit to measure observed website visibility.</p></section>;
  const score = report.categories.discovery;
  const previous = audit.summary?.observed_visibility?.previous;
  const results = new Map(audit.results.map(result => [result.query_id, result]));
  const questions = report.questions.filter(question => filter === 'all' || question.answers.some(answer =>
    filter === 'competitors' ? answer.competitors.length > 0 : answer.classification === filter));
  return <section className="panel overview-sample visibility-report" aria-labelledby="observed-visibility-heading">
    <span className="eyebrow">OBSERVED WEBSITE VISIBILITY</span>
    <h2 id="observed-visibility-heading">AI Visibility Score</h2>
    <strong className="metric">{percent(score.percentage)}</strong>
    <p>{score.percentage == null ? 'No valid answers to unbranded discovery questions.' : history
      ? 'Average website citation rate across unique unbranded questions in this site’s audit history. Each provider contributes its latest valid answer per question.'
      : 'Average website citation rate across answered unbranded questions. Each distinct question has equal weight.'}</p>
    <ScoreStats score={score} />
    {previous ? <p>This audit’s question set scored <strong>{previous.change_pp > 0 ? '+' : ''}{previous.change_pp} percentage points</strong> compared with {new Date(previous.created * 1000).toLocaleDateString()} ({percent(previous.percentage)} visibility, {previous.valid_answers}/{previous.planned_answers} valid answers).</p>
      : <p className="fine-print">No previous comparable audit with the same questions, providers, and model settings.</p>}
    <div className="visibility-breakdown">
      <section><h3>{categories.discovery}</h3><ProviderScores score={score} /></section>
      <section><h3>{categories.brand_knowledge} · {percent(report.categories.brand_knowledge.percentage)}</h3>
        {report.categories.brand_knowledge.distinct_questions > 0 ? <>
          <ScoreStats score={report.categories.brand_knowledge} /><ProviderScores score={report.categories.brand_knowledge} />
        </> : <p>No branded questions in this audit.</p>}
      </section>
    </div>
    <div className="section-line"><h3>Question evidence</h3><label>Show <select value={filter} onChange={event => setFilter(event.target.value)}>
      <option value="all">All questions</option><option value="website_cited">Website cited</option>
      <option value="brand_only">Brand mentioned only</option><option value="competitors">Competitors appeared instead</option>
    </select></label></div>
    {questions.map(question => <details className="data-details" key={question.id}>
      <summary>{question.prompt ?? audit.request.prompts[question.prompt_indices[0]]} · {categories[question.category]} · {question.valid_answers ? `${question.cited_answers}/${question.valid_answers} responding providers cited the site` : 'No valid answers'}</summary>
      {question.prompt_indices.length > 1 && <p className="fine-print">{question.prompt_indices.length} phrasings grouped. The first valid answer per provider counts.</p>}
      {question.answers.map(answer => {
        const result = history ? undefined : results.get(answer.query_id);
        const excerpt = answer.excerpt ?? (clientMention(result, audit.request.brand)?.evidence || result?.answer);
        return <article className="answer-card" key={answer.query_id}>
          <h4>{providerName(answer.provider)} · {(answer.skipped ?? result?.skipped) ? 'Not run' : outcomes[answer.classification]}</h4>
          {answer.audit_created != null && <p>{new Date(answer.audit_created * 1000).toLocaleDateString()}{answer.prompt !== question.prompt && ` · ${answer.prompt}`}</p>}
          {question.prompt_indices.length > 1 && <p>{audit.request.prompts[answer.prompt_index]}{!answer.counted && answer.classification !== 'api_failure' && ' · Extra phrasing'}</p>}
          {answer.competitors.length > 0 && <p>Competitors recommended {answer.competitors.join(', ')}</p>}
          {answer.classification === 'api_failure' ? <p>{answer.error || result?.error || 'No valid answer.'}</p>
            : excerpt && <p className="answer-text">{excerpt.length > 300 ? `${excerpt.slice(0, 300)}…` : excerpt}</p>}
          {answer.website_citations.length > 0 && <div className="source-links">{answer.website_citations.map(url =>
            <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>)}</div>}
        </article>;
      })}
    </details>)}
    {!questions.length && <p className="fine-print">No matching questions.</p>}
  </section>;
}
