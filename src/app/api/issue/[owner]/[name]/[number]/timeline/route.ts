import { NextRequest, NextResponse } from 'next/server';
import type { Octokit } from '@octokit/rest';
import { withRotation } from '@/lib/github';
import { getReadDb } from '@/lib/db';
import { extractLinkedIssues } from '@/lib/pr-linking';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const GITHUB_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
};

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const TIMELINE_CACHE_TTL_MS = 2 * 60_000;
const TIMELINE_CACHE_MAX = 250;

type TimelineSubject = {
  number: number | null;
  title: string | null;
  state: string | null;
  state_reason: string | null;
  html_url: string | null;
  repo_full_name: string | null;
  is_pull_request: boolean;
  merged: boolean | null;
  draft: boolean | null;
};

type TimelineEventDto = {
  id: string;
  event: string;
  actor_login: string | null;
  actor_avatar_url: string | null;
  actor_html_url: string | null;
  author_association: string | null;
  body: string | null;
  html_url: string | null;
  created_at: string | null;
  label: { name: string; color?: string | null } | null;
  assignee_login: string | null;
  assignee_avatar_url: string | null;
  source: TimelineSubject | null;
  subject: TimelineSubject | null;
  rename: { from: string | null; to: string | null } | null;
  commit_id: string | null;
  commit_message: string | null;
  commit_html_url: string | null;
  commit_verified: boolean | null;
  review_state: string | null;
  state_reason: string | null;
  will_close: boolean | null;
};

type RawTimelineEvent = Record<string, unknown>;
type TimelineKind = 'issue' | 'pull';
type TimelinePayload = {
  repo: string;
  issue_number: number;
  count: number;
  events: TimelineEventDto[];
  source: 'github';
};

const timelineCache = new Map<string, { expiresAt: number; payload: TimelinePayload }>();
const inFlightTimelineFetches = new Map<string, Promise<TimelinePayload>>();

function timelineCacheKey(owner: string, repo: string, issueNumber: number, kind: TimelineKind): string {
  return `${kind}:${owner.toLowerCase()}/${repo.toLowerCase()}#${issueNumber}`;
}

function pruneTimelineCache(now = Date.now()) {
  for (const [key, entry] of timelineCache) {
    if (entry.expiresAt <= now) timelineCache.delete(key);
  }
  while (timelineCache.size > TIMELINE_CACHE_MAX) {
    const oldest = timelineCache.keys().next().value as string | undefined;
    if (!oldest) break;
    timelineCache.delete(oldest);
  }
}

async function cachedTimelinePayload(key: string, load: () => Promise<TimelinePayload>): Promise<TimelinePayload> {
  const now = Date.now();
  const cached = timelineCache.get(key);
  if (cached && cached.expiresAt > now) return cached.payload;

  const inFlight = inFlightTimelineFetches.get(key);
  if (inFlight) return inFlight;

  const promise = load()
    .then((payload) => {
      timelineCache.delete(key);
      timelineCache.set(key, { expiresAt: Date.now() + TIMELINE_CACHE_TTL_MS, payload });
      pruneTimelineCache();
      return payload;
    })
    .finally(() => {
      inFlightTimelineFetches.delete(key);
    });
  inFlightTimelineFetches.set(key, promise);
  return promise;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function actorFrom(raw: RawTimelineEvent) {
  const actor = objectValue(raw.actor) ?? objectValue(raw.user);
  return {
    login: stringValue(actor?.login),
    avatarUrl: stringValue(actor?.avatar_url),
    htmlUrl: stringValue(actor?.html_url),
  };
}

function labelFrom(raw: RawTimelineEvent): { name: string; color?: string | null } | null {
  const label = objectValue(raw.label);
  const name = stringValue(label?.name);
  if (!name) return null;
  return { name, color: stringValue(label?.color) };
}

function subjectFrom(rawValue: unknown): TimelineSubject | null {
  const container = objectValue(rawValue);
  const raw = objectValue(container?.issue) ?? objectValue(container?.subject) ?? container;
  if (!raw) return null;
  const repo = objectValue(raw.repository);
  const repoFullName =
    stringValue(repo?.full_name) ??
    stringValue(repo?.name_with_owner) ??
    stringValue(repo?.nameWithOwner);
  const htmlUrl = stringValue(raw.html_url);
  const apiUrl = stringValue(raw.url);
  const type = stringValue(raw.type) ?? stringValue(raw.__typename);
  const isPull =
    !!raw.pull_request ||
    type === 'PullRequest' ||
    !!htmlUrl?.includes('/pull/') ||
    !!apiUrl?.includes('/pulls/');
  return {
    number: numberValue(raw.number),
    title: stringValue(raw.title),
    state: stringValue(raw.state),
    state_reason: stringValue(raw.state_reason),
    html_url: htmlUrl,
    repo_full_name: repoFullName,
    is_pull_request: isPull,
    merged: null,
    draft: typeof raw.draft === 'boolean' ? raw.draft : null,
  };
}

function sourcePullClosesIssue(raw: RawTimelineEvent, repoFullName: string, issueNumber: number): boolean | null {
  const source = subjectFrom(raw.source);
  if (!source?.is_pull_request) return null;
  const container = objectValue(raw.source);
  const sourceRaw = objectValue(container?.issue) ?? objectValue(container?.subject) ?? container;
  const title = stringValue(sourceRaw?.title) ?? '';
  const body = stringValue(sourceRaw?.body);
  const sourceRepo = source.repo_full_name ?? repoFullName;
  return extractLinkedIssues({ title, body, repo_full_name: sourceRepo }).some(
    (link) => link.number === issueNumber && (link.repo ?? sourceRepo).toLowerCase() === repoFullName.toLowerCase(),
  );
}

function normalizeTimelineEvent(
  raw: RawTimelineEvent,
  index: number,
  repoFullName: string,
  issueNumber: number,
): TimelineEventDto {
  const actor = actorFrom(raw);
  const assignee = actorFrom({ actor: raw.assignee });
  const rename = objectValue(raw.rename);
  const event = stringValue(raw.event) ?? (raw.body ? 'commented' : 'unknown');
  const author = objectValue(raw.author);
  const committer = objectValue(raw.committer);
  const verification = objectValue(raw.verification);
  const commitId = stringValue(raw.commit_id) ?? stringValue(raw.sha);
  const source = subjectFrom(raw.source);
  const subject = subjectFrom(raw.subject);
  const refSubject = source ?? subject;
  const id =
    raw.id ??
    (commitId ? `${event}-${commitId}` : null) ??
    (refSubject?.number
      ? `${event}-${refSubject.repo_full_name ?? repoFullName}-${refSubject.is_pull_request ? 'pull' : 'issue'}-${refSubject.number}-${stringValue(raw.created_at) ?? index}`
      : `${event}-${index}`);
  return {
    id: String(id),
    event,
    actor_login: actor.login ?? stringValue(author?.name) ?? stringValue(committer?.name),
    actor_avatar_url: actor.avatarUrl,
    actor_html_url: actor.htmlUrl,
    author_association: stringValue(raw.author_association),
    body: stringValue(raw.body),
    html_url: stringValue(raw.html_url),
    created_at:
      stringValue(raw.created_at) ??
      stringValue(raw.submitted_at) ??
      stringValue(author?.date) ??
      stringValue(committer?.date),
    label: labelFrom(raw),
    assignee_login: assignee.login,
    assignee_avatar_url: assignee.avatarUrl,
    source,
    subject,
    rename: rename ? { from: stringValue(rename.from), to: stringValue(rename.to) } : null,
    commit_id: commitId,
    commit_message: stringValue(raw.commit_message) ?? stringValue(raw.message),
    commit_html_url: stringValue(raw.commit_html_url) ?? stringValue(raw.html_url),
    commit_verified:
      typeof raw.commit_verified === 'boolean'
        ? raw.commit_verified
        : typeof verification?.verified === 'boolean'
        ? verification.verified
        : null,
    review_state: event === 'reviewed' ? stringValue(raw.state) : null,
    state_reason: stringValue(raw.state_reason),
    will_close: sourcePullClosesIssue(raw, repoFullName, issueNumber),
  };
}

function eventRank(event: string): number {
  if (event === 'commented') return 20;
  if (event === 'closed') return 30;
  if (event === 'reopened') return 30;
  if (event === 'referenced') return 35;
  if (event === 'cross-referenced' || event === 'connected') return 40;
  return 10;
}

function eventTime(event: TimelineEventDto): number {
  const t = event.created_at ? new Date(event.created_at).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function timelineDedupeKey(event: TimelineEventDto): string {
  if (isFallbackReferenceEvent(event)) {
    return `fallback:${referenceSubjectKey(event) ?? event.id}`;
  }
  const refSubjectKey = referenceSubjectKey(event);
  if (refSubjectKey && (event.event === 'cross-referenced' || event.event === 'connected')) {
    return [
      'reference',
      refSubjectKey,
      event.actor_login ?? '',
      event.created_at ?? '',
      event.event,
    ].join(':');
  }
  return `${event.event}:${event.id}`;
}

function isFallbackReferenceEvent(event: TimelineEventDto): boolean {
  return event.id.startsWith('linked-pr-') || event.id.startsWith('search-reference-');
}

function referenceSubjectKey(event: TimelineEventDto): string | null {
  const refSubject = event.source ?? event.subject;
  if (
    (event.event === 'cross-referenced' || event.event === 'connected') &&
    refSubject?.number
  ) {
    const repoKey = refSubject.repo_full_name ?? repoFromHtmlUrl(refSubject.html_url) ?? '';
    return `${repoKey.toLowerCase()}:${refSubject.is_pull_request ? 'pull' : 'issue'}:${refSubject.number}`;
  }
  return null;
}

function repoFromHtmlUrl(htmlUrl: string | null): string | null {
  if (!htmlUrl) return null;
  try {
    const url = new URL(htmlUrl);
    if (url.hostname !== 'github.com') return null;
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

function pickString(a: string | null, b: string | null): string | null {
  return a ?? b;
}

function pickBoolean(a: boolean | null, b: boolean | null): boolean | null {
  return a ?? b;
}

function pickClosingReference(a: boolean | null, b: boolean | null): boolean | null {
  if (a === true || b === true) return true;
  if (a === false || b === false) return false;
  return null;
}

function mergeTimelineSubject(
  existing: TimelineSubject | null,
  incoming: TimelineSubject | null,
): TimelineSubject | null {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    number: existing.number ?? incoming.number,
    title: pickString(existing.title, incoming.title),
    state: pickString(existing.state, incoming.state),
    state_reason: pickString(existing.state_reason, incoming.state_reason),
    html_url: pickString(existing.html_url, incoming.html_url),
    repo_full_name: pickString(existing.repo_full_name, incoming.repo_full_name),
    is_pull_request: existing.is_pull_request || incoming.is_pull_request,
    merged: pickBoolean(existing.merged, incoming.merged),
    draft: pickBoolean(existing.draft, incoming.draft),
  };
}

function mergeTimelineEvent(existing: TimelineEventDto, incoming: TimelineEventDto): TimelineEventDto {
  return {
    ...existing,
    actor_login: pickString(existing.actor_login, incoming.actor_login),
    actor_avatar_url: pickString(existing.actor_avatar_url, incoming.actor_avatar_url),
    actor_html_url: pickString(existing.actor_html_url, incoming.actor_html_url),
    author_association: pickString(existing.author_association, incoming.author_association),
    body: pickString(existing.body, incoming.body),
    html_url: pickString(existing.html_url, incoming.html_url),
    created_at: pickString(existing.created_at, incoming.created_at),
    label: existing.label ?? incoming.label,
    assignee_login: pickString(existing.assignee_login, incoming.assignee_login),
    assignee_avatar_url: pickString(existing.assignee_avatar_url, incoming.assignee_avatar_url),
    source: mergeTimelineSubject(existing.source, incoming.source),
    subject: mergeTimelineSubject(existing.subject, incoming.subject),
    rename: existing.rename ?? incoming.rename,
    commit_id: pickString(existing.commit_id, incoming.commit_id),
    commit_message: pickString(existing.commit_message, incoming.commit_message),
    commit_html_url: pickString(existing.commit_html_url, incoming.commit_html_url),
    commit_verified: pickBoolean(existing.commit_verified, incoming.commit_verified),
    review_state: pickString(existing.review_state, incoming.review_state),
    state_reason: pickString(existing.state_reason, incoming.state_reason),
    will_close: pickClosingReference(existing.will_close, incoming.will_close),
  };
}

function mergeTimelineEvents(events: TimelineEventDto[]): TimelineEventDto[] {
  const byKey = new Map<string, TimelineEventDto>();
  const seenReferenceSubjects = new Set<string>();
  for (const event of events) {
    const subjectKey = referenceSubjectKey(event);
    if (isFallbackReferenceEvent(event) && subjectKey && seenReferenceSubjects.has(subjectKey)) {
      continue;
    }
    const key = timelineDedupeKey(event);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeTimelineEvent(existing, event) : event);
    if (subjectKey) seenReferenceSubjects.add(subjectKey);
  }
  return [...byKey.values()].sort((a, b) => {
    const timeCmp = eventTime(a) - eventTime(b);
    if (timeCmp !== 0) return timeCmp;
    const rankCmp = eventRank(a.event) - eventRank(b.event);
    if (rankCmp !== 0) return rankCmp;
    return a.id.localeCompare(b.id);
  });
}

function linkedPullReferenceEvents(repoFullName: string, issueNumber: number): TimelineEventDto[] {
  const db = getReadDb();
  const rows = db
    .prepare(
      `SELECT p.number, p.title, p.state, p.draft, p.author_login, p.created_at, p.updated_at,
              p.closed_at, p.merged_at, p.html_url, p.body
       FROM pr_issue_links l
       JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
       WHERE l.repo_full_name = ? AND l.issue_number = ?`
    )
    .all(repoFullName, issueNumber) as Array<{
      number: number;
      title: string;
      state: string;
      draft: number;
      author_login: string | null;
      created_at: string | null;
      updated_at: string | null;
      closed_at: string | null;
      merged_at: string | null;
      html_url: string | null;
      body: string | null;
    }>;

  return rows.map((pr): TimelineEventDto => ({
    id: `linked-pr-${pr.number}`,
    event: 'cross-referenced',
    actor_login: pr.author_login,
    actor_avatar_url: pr.author_login ? `https://github.com/${pr.author_login}.png?size=40` : null,
    actor_html_url: pr.author_login ? `https://github.com/${pr.author_login}` : null,
    author_association: null,
    body: null,
    html_url: pr.html_url,
    created_at: pr.created_at ?? pr.updated_at ?? pr.merged_at ?? pr.closed_at,
    label: null,
    assignee_login: null,
    assignee_avatar_url: null,
    source: {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      state_reason: null,
      html_url: pr.html_url,
      repo_full_name: repoFullName,
      is_pull_request: true,
      merged: pr.merged_at !== null,
      draft: pr.draft === 1,
    },
    subject: null,
    rename: null,
    commit_id: null,
    commit_message: null,
    commit_html_url: null,
    commit_verified: null,
    review_state: null,
    state_reason: null,
    will_close: extractLinkedIssues({ title: pr.title, body: pr.body, repo_full_name: repoFullName }).some(
      (link) => link.number === issueNumber && (link.repo ?? repoFullName).toLowerCase() === repoFullName.toLowerCase(),
    ),
  }));
}

type SearchIssueItem = {
  number?: number;
  title?: string | null;
  body?: string | null;
  state?: string | null;
  state_reason?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  user?: {
    login?: string | null;
    avatar_url?: string | null;
    html_url?: string | null;
  } | null;
  pull_request?: unknown;
};

const ISSUE_MENTION_REGEX =
  /(?:https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/|([\w.-]+\/[\w.-]+)#|#)(\d+)/gi;

function searchItemMentionsIssue(item: SearchIssueItem, repoFullName: string, issueNumber: number): boolean {
  const text = `${item.title ?? ''}\n${item.body ?? ''}`;
  for (const match of text.matchAll(ISSUE_MENTION_REGEX)) {
    const repo = match[1] ?? match[2] ?? repoFullName;
    const number = Number(match[3]);
    if (
      number === issueNumber &&
      repo.toLowerCase() === repoFullName.toLowerCase()
    ) {
      return true;
    }
  }
  return false;
}

function searchItemClosesIssue(item: SearchIssueItem, repoFullName: string, issueNumber: number): boolean {
  return extractLinkedIssues({
    title: item.title ?? '',
    body: item.body ?? null,
    repo_full_name: repoFullName,
  }).some(
    (link) => link.number === issueNumber && (link.repo ?? repoFullName).toLowerCase() === repoFullName.toLowerCase(),
  );
}

async function searchReferenceEvents(
  octokit: Octokit,
  owner: string,
  name: string,
  issueNumber: number,
): Promise<TimelineEventDto[]> {
  const repoFullName = `${owner}/${name}`;
  const resp = await octokit.request('GET /search/issues', {
    q: `repo:${repoFullName} "#${issueNumber}" in:title,body`,
    per_page: 50,
    headers: GITHUB_HEADERS,
  });

  return (resp.data.items ?? [])
    .filter((item) => item.number !== issueNumber && searchItemMentionsIssue(item, repoFullName, issueNumber))
    .map((item): TimelineEventDto => {
      const isPullRequest = !!item.pull_request || !!item.html_url?.includes('/pull/');
      const closesIssue = isPullRequest && searchItemClosesIssue(item, repoFullName, issueNumber);
      return {
        id: `search-reference-${isPullRequest ? 'pull' : 'issue'}-${item.number ?? 'unknown'}`,
        event: 'cross-referenced',
        actor_login: item.user?.login ?? null,
        actor_avatar_url: item.user?.avatar_url ?? null,
        actor_html_url: item.user?.html_url ?? null,
        author_association: null,
        body: null,
        html_url: item.html_url ?? null,
        created_at: item.created_at ?? null,
        label: null,
        assignee_login: null,
        assignee_avatar_url: null,
        source: {
          number: item.number ?? null,
          title: item.title ?? null,
          state: item.state ?? null,
          state_reason: item.state_reason ?? null,
          html_url: item.html_url ?? null,
          repo_full_name: repoFullName,
          is_pull_request: isPullRequest,
          merged: null,
          draft: null,
        },
        subject: null,
        rename: null,
        commit_id: null,
        commit_message: null,
        commit_html_url: null,
        commit_verified: null,
        review_state: null,
        state_reason: null,
        will_close: closesIssue,
      };
    });
}

type GraphqlActor = { login: string | null; avatarUrl: string | null; url: string | null } | null;
type GraphqlSubject = {
  __typename: string;
  number?: number;
  title?: string;
  state?: string;
  stateReason?: string;
  url?: string;
  body?: string;
  merged?: boolean;
  isDraft?: boolean;
  repository?: { nameWithOwner: string };
} | null;

function graphQlSubjectToTimelineSubject(subject: GraphqlSubject): TimelineSubject | null {
  if (!subject?.number) return null;
  const isPull = subject.__typename === 'PullRequest';
  return {
    number: subject.number,
    title: subject.title ?? null,
    state: subject.state?.toLowerCase() ?? null,
    state_reason: subject.stateReason?.toLowerCase() ?? null,
    html_url: subject.url ?? null,
    repo_full_name: subject.repository?.nameWithOwner ?? null,
    is_pull_request: isPull,
    merged: isPull ? (subject.merged ?? false) : null,
    draft: isPull ? (subject.isDraft ?? false) : null,
  };
}

function graphQlSubjectClosesIssue(
  subject: GraphqlSubject,
  repoFullName: string,
  issueNumber: number,
): boolean | null {
  if (subject?.__typename !== 'PullRequest') return null;
  const sourceRepo = subject.repository?.nameWithOwner ?? repoFullName;
  return extractLinkedIssues({
    title: subject.title ?? '',
    body: subject.body ?? null,
    repo_full_name: sourceRepo,
  }).some(
    (link) => link.number === issueNumber && (link.repo ?? sourceRepo).toLowerCase() === repoFullName.toLowerCase(),
  );
}

async function graphqlReferenceEvents(
  octokit: { graphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T> },
  owner: string,
  name: string,
  issueNumber: number,
): Promise<TimelineEventDto[]> {
  type GraphqlTimelineNode =
    | {
        __typename: 'CrossReferencedEvent';
        createdAt: string;
        actor: GraphqlActor;
        source: GraphqlSubject;
      }
    | {
        __typename: 'ConnectedEvent';
        createdAt: string;
        actor: GraphqlActor;
        subject: GraphqlSubject;
      }
    | null;
  type GraphqlTimelinePageInfo = { hasNextPage: boolean; endCursor: string | null };
  type GraphqlReferencesResponse = {
    repository?: {
      issue?: {
        timelineItems?: {
          nodes: GraphqlTimelineNode[] | null;
          pageInfo?: GraphqlTimelinePageInfo | null;
        } | null;
      } | null;
    } | null;
  };

  const out: TimelineEventDto[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 10; page += 1) {
    const data: GraphqlReferencesResponse = await octokit.graphql<GraphqlReferencesResponse>(
      `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            timelineItems(itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT], first: 100, after: $after) {
              nodes {
                __typename
                ... on CrossReferencedEvent {
                  createdAt
                  actor { login avatarUrl url }
                  source {
                    __typename
                    ... on Issue { number title state stateReason url repository { nameWithOwner } }
                    ... on PullRequest { number title body state url merged isDraft repository { nameWithOwner } }
                  }
                }
                ... on ConnectedEvent {
                  createdAt
                  actor { login avatarUrl url }
                  subject {
                    __typename
                    ... on Issue { number title state stateReason url repository { nameWithOwner } }
                    ... on PullRequest { number title body state url merged isDraft repository { nameWithOwner } }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { owner, repo: name, number: issueNumber, after: cursor },
    );

    for (const node of data.repository?.issue?.timelineItems?.nodes ?? []) {
      if (!node) continue;
      const subject = node.__typename === 'CrossReferencedEvent'
        ? graphQlSubjectToTimelineSubject(node.source)
        : graphQlSubjectToTimelineSubject(node.subject);
      if (!subject) continue;
      const rawSubject = node.__typename === 'CrossReferencedEvent' ? node.source : node.subject;
      const actor = node.actor;
      out.push({
        id: `graphql-${node.__typename}-${subject.repo_full_name ?? ''}-${subject.is_pull_request ? 'pull' : 'issue'}-${subject.number}`,
        event: node.__typename === 'ConnectedEvent' ? 'connected' : 'cross-referenced',
        actor_login: actor?.login ?? null,
        actor_avatar_url: actor?.avatarUrl ?? null,
        actor_html_url: actor?.url ?? null,
        author_association: null,
        body: null,
        html_url: subject.html_url,
        created_at: node.createdAt,
        label: null,
        assignee_login: null,
        assignee_avatar_url: null,
        source: subject,
        subject: null,
        rename: null,
        commit_id: null,
        commit_message: null,
        commit_html_url: null,
        commit_verified: null,
        review_state: null,
        state_reason: null,
        will_close: graphQlSubjectClosesIssue(rawSubject, `${owner}/${name}`, issueNumber),
      });
    }

    const pageInfo: GraphqlTimelinePageInfo | null | undefined =
      data.repository?.issue?.timelineItems?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return out;
}

async function loadTimelinePayload(
  owner: string,
  name: string,
  issueNumber: number,
  itemKind: TimelineKind,
): Promise<TimelinePayload> {
  const repoFullName = `${owner}/${name}`;
  const events = await withRotation(async (octokit) => {
    const out: TimelineEventDto[] = [];
    const perPage = 100;
    for (let page = 1; page <= 5; page += 1) {
      const resp = await octokit.issues.listEventsForTimeline({
        owner,
        repo: name,
        issue_number: issueNumber,
        per_page: perPage,
        page,
        headers: GITHUB_HEADERS,
      });
      const items = resp.data as unknown as RawTimelineEvent[];
      out.push(...items.map((raw, index) => normalizeTimelineEvent(raw, index, repoFullName, issueNumber)));
      if (items.length < perPage) break;
    }

    // Timeline responses can vary by repository permissions/API shape. The
    // comments endpoint is the authoritative backstop for conversation
    // cards, so merge it in and dedupe by GitHub's comment id.
    for (let page = 1; page <= 5; page += 1) {
      const resp = await octokit.issues.listComments({
        owner,
        repo: name,
        issue_number: issueNumber,
        per_page: perPage,
        page,
        headers: GITHUB_HEADERS,
      });
      const items = resp.data as unknown as RawTimelineEvent[];
      out.push(...items.map((raw, index) => normalizeTimelineEvent({ ...raw, event: 'commented' }, index, repoFullName, issueNumber)));
      if (items.length < perPage) break;
    }

    if (itemKind === 'issue') {
      try {
        out.push(...await graphqlReferenceEvents(octokit, owner, name, issueNumber));
      } catch (err) {
        console.warn(
          `[timeline] GraphQL cross-reference fallback failed for ${repoFullName}#${issueNumber}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // REST timeline is the primary source. GraphQL is an exact
        // cross-reference completeness fallback, so failure should not hide
        // the rest of the issue conversation.
      }

      try {
        out.push(...await searchReferenceEvents(octokit, owner, name, issueNumber));
      } catch (err) {
        console.warn(
          `[timeline] Search cross-reference fallback failed for ${repoFullName}#${issueNumber}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Search is only a completeness fallback for GitHub cross-reference
        // rows that occasionally differ between timeline API shapes.
      }

      out.push(...linkedPullReferenceEvents(repoFullName, issueNumber));
    }

    const merged = mergeTimelineEvents(out);
    const commitEvents = merged.filter((event) =>
      (event.event === 'referenced' || event.event === 'committed' || event.event === 'merged') && event.commit_id
    );
    for (const event of commitEvents) {
      try {
        const resp = await octokit.repos.getCommit({
          owner,
          repo: name,
          ref: event.commit_id as string,
          headers: GITHUB_HEADERS,
        });
        event.actor_avatar_url = event.actor_avatar_url ?? resp.data.author?.avatar_url ?? null;
        event.actor_html_url = event.actor_html_url ?? resp.data.author?.html_url ?? null;
        event.commit_message = event.commit_message ?? (resp.data.commit.message.split('\n')[0] || null);
        event.commit_html_url = resp.data.html_url ?? null;
        event.commit_verified = resp.data.commit.verification?.verified ?? null;
      } catch {
        // Keep the timeline usable with the SHA-only event if commit lookup
        // fails due to permissions, pruning, or transient GitHub errors.
      }
    }

    return merged;
  });

  return {
    repo: repoFullName,
    issue_number: issueNumber,
    count: events.length,
    events,
    source: 'github',
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string; number: string }> },
) {
  const params = await ctx.params;
  const issueNumber = parseInt(params.number, 10);
  if (!Number.isFinite(issueNumber)) {
    return NextResponse.json({ error: 'Invalid issue number' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const itemKind: TimelineKind = new URL(req.url).searchParams.get('kind') === 'pull' ? 'pull' : 'issue';
    const key = timelineCacheKey(params.owner, params.name, issueNumber, itemKind);
    const payload = await cachedTimelinePayload(key, () =>
      loadTimelinePayload(params.owner, params.name, issueNumber, itemKind),
    );
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
