export interface IssueLinkedPrDto {
  number: number;
  title: string;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
  closed_at?: string | null;
  merged_at?: string | null;
  html_url?: string | null;
}

export interface IssueDto {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason: string | null;
  author_login: string | null;
  author_association: string | null;
  labels: Array<{ name: string; color?: string }>;
  comments: number;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  html_url: string | null;
  fetched_at: string;
  first_seen_at: string;
  linked_prs?: IssueLinkedPrDto[];
  linked_pr_count?: number;
  merged_pr_count?: number;
  closed_pr_count?: number;
}

export interface PullDto {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
  author_association: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string | null;
  fetched_at: string;
  first_seen_at: string;
  additions?: number | null;
  deletions?: number | null;
  score?: number | null;
  scored?: boolean;
}

export interface IssueStateCounts {
  open: number;
  completed: number;
  not_planned: number;
  /** Closed + state_reason='duplicate'. Gittensor rule treats these as not
   *  solved, separate from the generic "closed (other)" bucket. */
  duplicate: number;
  closed: number;
  /** @deprecated use `closed` */
  closed_other: number;
}

export interface IssuesResponse {
  repo: string;
  count: number; // total matching the current filter (page-independent)
  state_counts: IssueStateCounts;
  new_count?: number; // populated when ?since=ISO is sent
  last_fetch: string | null;
  last_error: string | null;
  issues: IssueDto[]; // current page only
  /** Linked PRs (closes/fixes/sidebar-linked) for issues on this page only. */
  linked_prs_by_issue?: Record<
    number,
    Array<{ number: number; title: string; state: string; draft: number; merged: number; author_login: string | null }>
  >;
  /** Per-author OPEN/DONE/NP/CL counts for authors of issues on this page. */
  page_author_stats?: Record<string, AuthorIssueStats>;
  /** Per-user valid/invalid marks for issues on this page (only set when signed in). */
  user_validations?: Record<number, 'valid' | 'invalid'>;
}

export interface PullStateCounts {
  open: number;
  draft: number;
  merged: number;
  closed: number;
}

export interface PullsResponse {
  repo: string;
  count: number;
  state_counts: PullStateCounts;
  new_count?: number;
  last_fetch: string | null;
  last_error: string | null;
  pulls: PullDto[];
  /** Linked issues (closes/fixes/sidebar-linked) for PRs on this page only. */
  linked_issues_by_pull?: Record<
    number,
    Array<{ number: number; title: string; state: string; state_reason: string | null; author_login: string | null }>
  >;
}

export interface AuthorOption {
  login: string;
  count: number;
  /** Per-author state-bucket counts. Populated by /issues-meta when the
   * dropdown asks for the full list (summary=1 omits these). */
  open?: number;
  completed?: number;
  not_planned?: number;
  closed?: number;
}

export interface AuthorIssueStats {
  open: number;
  completed: number;
  not_planned: number;
  closed: number;
}

export interface IssuesMetaResponse {
  repo: string;
  author_options: AuthorOption[];
  author_stats: Record<string, AuthorIssueStats>;
  total_authors: number;
  /** Issue counts grouped by GitHub `author_association`. Powers the
   * "Collaborators" / "Contributors" pseudo-filters at the top of the
   * author dropdown. */
  assoc_counts?: { collaborator: number; contributor: number };
}

export interface PullsMetaResponse {
  repo: string;
  author_options: AuthorOption[];
  mine_count?: number;
  total_authors: number;
}

export type PullStatus = 'open' | 'draft' | 'merged' | 'closed';

export function pullStatus(p: PullDto): PullStatus {
  if (p.merged) return 'merged';
  if (p.draft) return 'draft';
  if (p.state === 'open') return 'open';
  return 'closed';
}
