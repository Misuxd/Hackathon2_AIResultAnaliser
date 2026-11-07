export type Provider = 'openai' | 'perplexity' | 'gemini';
export const ENGINES: { id: Provider; name: string; mark: string }[] = [
  { id: 'openai', name: 'OpenAI', mark: '◎' },
  { id: 'perplexity', name: 'Perplexity', mark: '⌘' },
  { id: 'gemini', name: 'Google Gemini', mark: '✦' },
];
export type AuditRequest = {
  brand: string; target_url: string; competitors: string[]; prompts: string[];
  providers: Provider[]; mode: 'live' | 'demo'; monthly_organic_revenue: number | null;
  displacement_assumption: number;
};
export type Mention = { brand_name: string; rank_position: number | null; sentiment: string; evidence: string; reason_for_inclusion: string };
export type QueryResult = {
  query_id: string; prompt_index: number; provider: Provider; status: 'success' | 'error'; mode: string;
  answer: string; mentions: Mention[]; citations: string[]; structural_winner_patterns: string[]; error: string | null;
};
export type Summary = {
  visibility_pct: number | null; weighted_som_pct: number | null; mentioned_responses: number;
  successful_queries: number; total_queries: number; failed_queries: number; rank_points: number; total_rank_points: number;
  revenue_scenario_usd: number | null; scenario_assumption: number; primary_gap: string;
  brand_leaderboard: { brand: string; rank_points: number; mentions: number; weighted_som_pct: number | null }[];
  engine_breakdown: { provider: Provider; successful: number; mentioned: number; visibility_pct: number | null }[];
  top_third_party_domains: { domain: string; response_count: number }[]; methodology: string;
};
export type Audit = { id: string; created: number; request: AuditRequest; status: string; results: QueryResult[]; summary: Summary | null };
export type Health = { status: string; providers: { id: Provider; configured: boolean; model: string }[]; fetch_hosts: string[]; deployment: string };
export type Assets = {
  mode: string; provider: string | null; target_url: string; source_characters: number;
  checks: { label: string; present: boolean }[]; competitor_evidence: { url: string; has_table: boolean; schema_blocks: number; headings: string[] }[];
  optimized_markdown: string; json_ld_script: string; llms_txt: string; warnings: string[];
};
export function sameBrand(a: string, b: string) {
  const normalize = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ').trim().replace(/(?:\s+(?:inc|llc|ltd|limited|corp|corporation))+$/, '');
  return normalize(a) === normalize(b);
}
export function clientMention(result: QueryResult | undefined, brand: string) {
  return result?.mentions.find(m => sameBrand(m.brand_name, brand));
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
