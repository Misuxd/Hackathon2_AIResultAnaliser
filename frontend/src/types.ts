export type Provider = 'openai' | 'perplexity';
export const ENGINES: { id: Provider; name: string; mark: string }[] = [
  { id: 'openai', name: 'OpenAI', mark: '◎' },
  { id: 'perplexity', name: 'Perplexity', mark: '⌘' },
];
export type AuditRequest = {
  brand: string; target_url: string; prompts: string[];
  offering?: string;
  providers: Provider[]; mode: 'live' | 'demo';
};
export type Mention = { brand_name: string; rank_position: number | null; sentiment: string; evidence: string; reason_for_inclusion: string };
export type QueryResult = {
  query_id: string; prompt_index: number; provider: Provider; status: 'success' | 'error'; mode: string;
  answer: string; mentions: Mention[]; citations: string[]; structural_winner_patterns: string[]; error: string | null;
  access_error?: boolean; skipped?: boolean;
};
export type VisibilityCategory = 'discovery' | 'brand_knowledge';
export type VisibilityStats = {
  percentage: number | null; brand_mention_pct: number | null;
  valid_answers: number; planned_answers: number; distinct_questions: number; answered_questions: number;
  providers: { provider: Provider; model: string | null; percentage: number | null;
    valid_answers: number; planned_answers: number; cited_answers: number }[];
};
export type RelevantSite = { domain: string; url: string; relevance_score: number; response_count: number; visibility_pct?: number };
type QuestionAttempt = { provider: Provider; prompt: string; audit_created: number; skipped: boolean; model?: string | null;
  classification: 'website_cited' | 'brand_only' | 'neither' | 'api_failure' };
export type VisibilityReport = {
  categories: Record<VisibilityCategory, VisibilityStats>;
  questions: { id: string; category: VisibilityCategory; prompt?: string; prompt_indices: number[]; valid_answers: number; cited_answers: number;
    attempts?: QuestionAttempt[];
    answers: { query_id: string; prompt_index: number; provider: Provider; counted: boolean; brand_mentioned: boolean;
      prompt?: string; excerpt?: string; error?: string | null; skipped?: boolean; audit_created?: number;
      classification: 'website_cited' | 'brand_only' | 'neither' | 'api_failure'; website_citations: string[]; competitors: string[] }[] }[];
  previous?: { created: number; percentage: number; change_pp: number; valid_answers: number; planned_answers: number } | null;
  product_category?: string;
  relevant_sites?: RelevantSite[];
};
export type Summary = {
  visibility_pct: number | null; weighted_som_pct: number | null; mentioned_responses: number;
  successful_queries: number; total_queries: number; failed_queries: number; rank_points: number; total_rank_points: number;
  ranked_queries?: number;
  brand_leaderboard: { brand: string; rank_points: number; mentions: number; weighted_som_pct: number | null }[];
  engine_breakdown: { provider: Provider; successful: number; mentioned: number; visibility_pct: number | null }[];
  relevant_sites?: RelevantSite[];
  observed_visibility?: VisibilityReport;
  history_visibility?: VisibilityReport;
};
export type Audit = { id: string; created: number; request: AuditRequest; status: string; results: QueryResult[]; summary: Summary | null };
export type Health = { status: string; providers: { id: Provider; configured: boolean; model: string }[]; fetch_hosts: string[]; deployment: string };
export type Assets = {
  recommendations: { title: string; evidence: string; change: string; why: string }[];
  mode: string; provider: string | null; target_url: string; source_characters: number;
  checks: { label: string; present: boolean }[];
  optimized_markdown: string; json_ld_script: string; llms_txt: string; warnings: string[];
};
function normalizeBrand(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ').trim().replace(/(?:\s+(?:inc|llc|ltd|limited|corp|corporation))+$/, '');
}
export function sameBrand(a: string, b: string) {
  return normalizeBrand(a) === normalizeBrand(b);
}
export function clientMention(result: QueryResult | undefined, brand: string) {
  return result?.mentions.find(m => sameBrand(m.brand_name, brand));
}
export function namesBrand(result: QueryResult, brand: string) {
  const name = normalizeBrand(brand);
  return !!name && ` ${normalizeBrand(result.answer)} `.includes(` ${name} `);
}
export function citesSite(result: QueryResult, site: string) {
  const host = (url: string) => URL.canParse(url) ? new URL(url).hostname.replace(/\.$/, '').replace(/^www\./, '') : '';
  const target = host(site);
  return !!target && result.citations.some(url => {
    const source = host(url);
    return source === target || source.endsWith(`.${target}`);
  });
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/v1' + url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail)
      ? data.detail.map((e: { msg: string }) => e.msg).join('. ') : `Request failed (${response.status})`);
  }
  return response.json();
}
