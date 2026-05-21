'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useRef } from 'react';
import { PageLayout, Heading, Text, Box, Label } from '@primer/react';
import {
  BookIcon,
  ChecklistIcon,
  GlobeIcon,
  RepoIcon,
  StackIcon,
  IssueOpenedIcon,
  GitPullRequestIcon,
  PersonIcon,
  GearIcon,
  BellIcon,
  EyeIcon,
} from '@primer/octicons-react';

interface Section {
  id: string;
  title: string;
  icon: React.ReactNode;
}

const SECTIONS: Section[] = [
  { id: 'overview', title: 'Overview', icon: <BookIcon size={16} /> },
  { id: 'dashboard', title: 'Dashboard', icon: <ChecklistIcon size={16} /> },
  { id: 'explorer', title: 'Explorer', icon: <GlobeIcon size={16} /> },
  { id: 'repositories', title: 'Repositories', icon: <StackIcon size={16} /> },
  { id: 'issues', title: 'Issues', icon: <IssueOpenedIcon size={16} /> },
  { id: 'pulls', title: 'Pull Requests', icon: <GitPullRequestIcon size={16} /> },
  { id: 'my-prs', title: 'My PRs', icon: <PersonIcon size={16} /> },
  { id: 'manage', title: 'Manage Repositories', icon: <RepoIcon size={16} /> },
  { id: 'notifications', title: 'Notifications', icon: <BellIcon size={16} /> },
  { id: 'settings', title: 'Settings', icon: <GearIcon size={16} /> },
  { id: 'shortcuts', title: 'Keyboard Shortcuts', icon: <EyeIcon size={16} /> },
];

export default function DocsPage() {
  const [section, setSection] = useState<string>('overview');
  const tocRef = useRef<HTMLDivElement | null>(null);
  const sectionButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // When the user clicks a TOC entry we initiate a smooth scroll. Suppress the
  // observer-driven update during that scroll so the clicked entry stays active
  // until the scroll settles on its target.
  const suppressObserverRef = useRef<number>(0);

  useEffect(() => {
    // Active section = the last one whose heading has scrolled above an anchor
    // line near the top of the viewport (just below the sticky header).
    const getAnchorOffset = () => {
      const rawHeaderHeight = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
      const headerHeight = Number.parseFloat(rawHeaderHeight) || 0;
      const mobileTocHeight = window.innerWidth < 768 ? tocRef.current?.offsetHeight ?? 0 : 0;
      return headerHeight + mobileTocHeight + 16;
    };

    const computeActive = () => {
      if (Date.now() < suppressObserverRef.current) return;
      let activeId = SECTIONS[0].id;
      const anchorOffset = getAnchorOffset();
      for (const s of SECTIONS) {
        const el = document.getElementById(`docs-${s.id}`);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - anchorOffset <= 0) activeId = s.id;
        else break; // sections are in DOM order, no need to keep checking
      }
      setSection((prev) => (prev !== activeId ? activeId : prev));
    };
    computeActive();
    window.addEventListener('scroll', computeActive, { passive: true });
    window.addEventListener('resize', computeActive);
    return () => {
      window.removeEventListener('scroll', computeActive);
      window.removeEventListener('resize', computeActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const toc = tocRef.current;
    const activeButton = sectionButtonRefs.current[section];
    if (!toc || !activeButton) return;

    if (toc.scrollWidth > toc.clientWidth) {
      const left = activeButton.offsetLeft - (toc.clientWidth - activeButton.offsetWidth) / 2;
      toc.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
      return;
    }

    if (toc.scrollHeight > toc.clientHeight) {
      const top = activeButton.offsetTop - (toc.clientHeight - activeButton.offsetHeight) / 2;
      toc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }, [section]);

  return (
    <PageLayout containerWidth="xlarge" padding="normal">
      <PageLayout.Header>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Box sx={{ flexShrink: 0, display: 'inline-flex' }}>
            <BookIcon size={20} />
          </Box>
          <Heading sx={{ fontSize: [3, null, 4], lineHeight: 1.2 }}>Gittensor Hub Documentation</Heading>
        </Box>
        <Text sx={{ color: 'fg.muted', display: 'block', maxWidth: 720 }}>
          How the dashboard, explorer, pipelines, and SN74 scoring views work.
        </Text>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box sx={{ display: 'flex', flexDirection: ['column', null, 'row'], gap: [3, null, 4], alignItems: ['stretch', null, 'flex-start'] }}>
          {/* Left rail TOC */}
          <Box
            ref={tocRef}
            sx={{
              width: ['100%', null, 220],
              flexShrink: 0,
              position: 'sticky',
              // Clears the optional top header (--header-height is 0 in
              // sidebar mode, 64px in top-nav mode) plus a small gap.
              top: ['var(--header-height)', null, 'calc(var(--header-height) + 16px)'],
              maxHeight: ['none', null, 'calc(100vh - var(--header-height) - 32px)'],
              overflowX: ['auto', null, 'hidden'],
              overflowY: ['hidden', null, 'auto'],
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              bg: 'canvas.subtle',
              p: [1, null, 2],
              display: ['flex', null, 'block'],
              gap: 1,
              zIndex: 20,
              boxShadow: ['0 8px 18px rgba(0, 0, 0, 0.18)', null, 'none'],
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            {SECTIONS.map((s) => {
              const active = s.id === section;
              return (
                <Box
                  as="button"
                  ref={(node) => {
                    sectionButtonRefs.current[s.id] = node as HTMLButtonElement | null;
                  }}
                  key={s.id}
                  onClick={() => {
                    setSection(s.id);
                    suppressObserverRef.current = Date.now() + 800;
                    document.getElementById(`docs-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    width: ['auto', null, '100%'],
                    flexShrink: 0,
                    px: 2,
                    py: ['8px', null, '6px'],
                    border: 'none',
                    bg: active ? 'var(--bg-emphasis)' : 'transparent',
                    color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
                    fontWeight: active ? 600 : 500,
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderRadius: 1,
                    fontSize: 1,
                    fontFamily: 'inherit',
                    borderLeft: '3px solid',
                    borderLeftColor: [null, null, active ? 'var(--accent-emphasis)' : 'transparent'],
                    borderBottom: ['2px solid', null, 'none'],
                    borderBottomColor: [active ? 'var(--accent-emphasis)' : 'transparent', null, 'transparent'],
                    whiteSpace: 'nowrap',
                    '&:hover': { bg: active ? 'var(--bg-emphasis)' : 'var(--bg-canvas)' },
                  }}
                >
                  {s.icon}
                  {s.title}
                </Box>
              );
            })}
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1, minWidth: 0, width: '100%', lineHeight: 1.65, fontSize: 1, color: 'fg.default' }}>
            <Article id="overview" title="Overview">
              <P>
                <strong>Gittensor Hub</strong> is a daily operating workspace for miners, validators, and repository
                owners on <strong>Bittensor Subnet 74 (SN74)</strong>. It combines live Gittensor score data, local
                GitHub issue/PR cache data, and the SN74 repository registry into one dashboard.
              </P>
              <P>
                <Code>/</Code> opens the <strong>Dashboard</strong>. <Code>/explorer</Code> is the repo drill-down view.
                Global pages for miners, repositories, issues, pull requests, and your PRs are available from the
                sidebar or mobile bottom navigation.
              </P>
              <H3>Tech stack</H3>
              <Ul>
                <Li>Next.js 15 (App Router) + TypeScript + Primer React</Li>
                <Li>SQLite cache for issues / PRs / linked-issue map</Li>
                <Li>TanStack Query for client-side polling and cache</Li>
                <Li>Gittensor live APIs for repo, PR, and miner score data</Li>
                <Li>GitHub REST polling for issue, PR, and linked-issue metadata</Li>
              </Ul>
            </Article>

            <Article id="dashboard" title="Dashboard">
              <P>
                <Code>/</Code> opens the dashboard. It is designed for information worth checking
                every day: network activity, work waiting for validation, best scored work, changing repo momentum,
                and current PR/issue queues.
              </P>
              <H3>Time range</H3>
              <Ul>
                <Li><strong>24H</strong> and <strong>7D</strong> use fixed rolling windows.</Li>
                <Li><strong>30D</strong> follows each repo's configured Gittensor PR lookback window when available; otherwise it uses the current SN74 default of 30 days.</Li>
                <Li>The freshness chips show when repo config, issue/PR cache data, and miner score data last updated.</Li>
              </Ul>
              <H3>Top cards</H3>
              <Ul>
                <Li><strong>Network Activity</strong>: PR and issue lifecycle events in the selected range.</Li>
                <Li><strong>OSS Contributions</strong>: official scored PRs, plus merged PRs awaiting Gittensor validation.</Li>
                <Li><strong>Discoveries</strong>: issues resolved through linked solver PRs or real issue-discovery scoring.</Li>
                <Li><strong>OSS Score</strong>: sum, average, and top official PR scores in the selected range.</Li>
                <Li><strong>Active Contributors</strong>: unique GitHub actors plus current open PR/issue queue size.</Li>
              </Ul>
              <H3>Top Contributions</H3>
              <P>
                Top Contributions are ranked by modeled <strong>reward share</strong>, not raw PR score. The dashboard mirrors the
                Gittensor allocator at a UI level:
              </P>
              <Pre>{`PR share = PR score / repo total scored PRs
reward share = PR share x effective repo PR reward pool`}</Pre>
              <Ul>
                <Li>The repo slice starts from <Code>emission_share x 90%</Code>.</Li>
                <Li><Code>maintainer_cut</Code> is subtracted only when registered maintainer miners exist for that repo.</Li>
                <Li>The remaining slice is split by <Code>issue_discovery_share</Code>.</Li>
                <Li>If only PRs or only issue discovery has non-zero scores in a repo, that repo's other sub-pool spills to the active side.</Li>
              </Ul>
              <H3>Pull Request Pipeline</H3>
              <Ul>
                <Li><strong>Drafting</strong>: draft PRs.</Li>
                <Li><strong>Submitted</strong>: open non-draft PRs.</Li>
                <Li><strong>Closed</strong>: closed and not merged.</Li>
                <Li><strong>Merged</strong>: merged on GitHub but not yet validated/scored by Gittensor.</Li>
                <Li><strong>Scored</strong>: PRs with official Gittensor score data, including score <Code>0</Code>.</Li>
                <Li>Repo chips filter only the PR pipeline. Multi-select is supported; <strong>All</strong> clears the filter.</Li>
              </Ul>
              <H3>Issue Pipeline</H3>
              <Ul>
                <Li><strong>Opened</strong>: open GitHub issues.</Li>
                <Li><strong>Closed</strong>: not validation-ready, not planned, or completed without a rewardable merged/scored linked PR.</Li>
                <Li><strong>Completed</strong>: completed issue with a rewardable merged linked PR waiting for Gittensor validation.</Li>
                <Li><strong>Scored</strong>: issue has a linked solver PR with official Gittensor score, or real <Code>discovery_earned_score</Code>.</Li>
                <Li>A <strong>Discovery</strong> score badge means real issue-discovery score data is present. The compact warning icon means issue discovery is enabled for the repo but the issue author appears ineligible or unknown.</Li>
                <Li>Repo chips filter only the issue pipeline, independently from the PR pipeline.</Li>
              </Ul>
            </Article>

            <Article id="explorer" title="Explorer">
              <P>
                <Code>/explorer</Code> is the repo drill-down view. Three-pane layout:
              </P>
              <Ul>
                <Li>
                  <strong>Left rail</strong> — searchable list of all SN74 + custom repos, sorted by weight, with star
                  toggle, activity badges, and a <em>Mark all read</em> button. Click a repo to load its content into
                  the middle pane.
                </Li>
                <Li>
                  <strong>Middle pane</strong> — Issues / Pull Requests tabs for the selected repo. Each table shows
                  state badges, author with avatar, opened/updated/closed timestamps (recent items in bold green),
                  related-PR count for issues, linked issue chips for pull requests, and Gittensor PR scores where
                  available. Clicking a linked issue opens its detail view directly.
                </Li>
                <Li>
                  <strong>Right rail (when open)</strong> — issue/PR content viewer. Slides in from the right and
                  pushes the table left so nothing is hidden.
                </Li>
              </Ul>
              <P>Both side rails are <strong>resizable</strong> — drag the vertical separators.</P>
            </Article>

            <Article id="repositories" title="Repositories">
              <P>
                <Code>/repositories</Code> — the full catalog of every repo the dashboard knows about, with
                per-repository statistics:
              </P>
              <Ul>
                <Li><strong>Weight / emission share</strong>: the repo's configured SN74 reward allocation share (0-1)</Li>
                <Li><strong>Band</strong>: Flagship (≥0.5), High (0.3–0.5), Mid-high (0.15–0.3), Standard (0.05–0.15), Low</Li>
                <Li><strong>Issues / Open</strong>: total cached issues + currently open</Li>
                <Li><strong>PRs / PR Open / Merged</strong>: total / open / merged pulls</Li>
                <Li><strong>Activity</strong>: last update timestamp across issues + PRs</Li>
              </Ul>
              <P>
                The SN74 whitelist auto-syncs from{' '}
                <a href="https://github.com/entrius/gittensor/blob/main/gittensor/validator/weights/master_repositories.json" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-fg)' }}>
                  master_repositories.json
                </a>{' '}
                every hour. Custom repos added via Manage Repositories appear with a blue <Pill>CUSTOM</Pill> pill.
              </P>
            </Article>

            <Article id="issues" title="Issues page">
              <P>
                <Code>/issues</Code> — global server-backed issue feed across current SN74 and custom repositories.
                Results are fetched a page at a time, with compact pagination and configurable rows per page.
              </P>
              <Ul>
                <Li><strong>Search</strong>: filter by title, repository, issue number, or author</Li>
                <Li><strong>State filter</strong>: All / Open / Completed / Not planned / Closed (other)</Li>
                <Li><strong>Author filter</strong>: searchable combobox with avatars + per-author counts</Li>
                <Li><strong>Tracked only</strong>: limits results to repos you've starred; row stars update that watchlist</Li>
                <Li><strong>Linked PRs</strong>: PR count chips open the related pull requests for each issue</Li>
                <Li><strong>Author activity</strong>: click an author to open their repo-scoped activity sidebar</Li>
                <Li><strong>Sorting</strong>: server-backed sorting on Repository, Weight, Comments, Opened, and Closed</Li>
              </Ul>
            </Article>

            <Article id="pulls" title="Pull Requests page">
              <P>
                <Code>/pulls</Code> — global server-backed PR feed across current SN74 and custom repositories. Results
                are fetched a page at a time, with the same compact pagination and row-count controls used by the Issues
                view.
              </P>
              <P>
                Use search, state, author, <strong>Tracked only</strong>, and <strong>My PRs only</strong> filters to
                narrow the feed without loading the full cache into the browser. Star controls on each row update the
                tracked repo set used by the filter.
              </P>
              <Ul>
                <Li><strong>Pagination</strong>: page controls at the table edge with configurable rows per page</Li>
                <Li><strong>Author activity</strong>: click an author to open their repo-scoped activity sidebar with latest PRs and issues</Li>
                <Li><strong>Score</strong>: Gittensor-backed PR score column; open PRs show potential and collateral values, merged PRs show the final score</Li>
                <Li><strong>Linked issues</strong>: issue chips mirror Explorer and open the issue detail view directly</Li>
                <Li><strong>Sorting</strong>: server-backed sort controls keep large PR sets responsive</Li>
              </Ul>
            </Article>

            <Article id="my-prs" title="My PRs">
              <P>
                <Code>/my-prs</Code> — every PR <strong>you</strong> have authored on GitHub (uses the GitHub search
                API: <Code>is:pr author:&lt;username&gt;</Code>), enriched with whether each repo is in the SN74
                whitelist and the repo's weight.
              </P>
              <Ul>
                <Li>Default view: <strong>SN74 whitelist</strong> only (the PRs that earn TAO)</Li>
                <Li>Stat cards at top: total / in whitelist / open / merged / draft / closed</Li>
                <Li>Whitelisted PRs are highlighted yellow with the repo's weight as a chip</Li>
              </Ul>
            </Article>

            <Article id="manage" title="Manage Repositories">
              <P>
                <Code>/manage-repos</Code> (also accessible from the user menu). Add custom repositories that aren't on
                the SN74 whitelist — useful for tracking your own projects or non-SN74 repos you contribute to.
              </P>
              <Ul>
                <Li>Form: <Code>owner/name</Code> + weight (0–1) + optional notes</Li>
                <Li>Custom repos are polled by the same background worker and show up everywhere — Explorer left rail, Repositories table, Issues, Pulls — with a <Pill>CUSTOM</Pill> pill</Li>
                <Li>Edit weight or notes inline; remove with the trash icon (confirmation prompt)</Li>
              </Ul>
              <P>Stored in SQLite (<Code>user_repos</Code> table) so they persist across server restarts.</P>
            </Article>

            <Article id="notifications" title="Notifications">
              <P>
                Toast notifications fire when a new issue is detected. Triggers: issue's <Code>created_at</Code> is
                later than the time you opened the dashboard.
              </P>
              <Ul>
                <Li><strong>Toast</strong>: bottom-right, 8s auto-dismiss, click to navigate</Li>
                <Li><strong>Click</strong>: routes to <Code>/explorer?repo=...&tab=issues&issue=N</Code> — Explorer opens with the issue auto-loaded into the configured display (modal/side/accordion)</Li>
                <Li><strong>Sticky badges</strong>: red pill on the corresponding repo in the left rail; clears when you click that repo</Li>
                <Li><strong>Mark all read</strong>: button in the left rail header clears all sticky badges at once</Li>
              </Ul>
            </Article>

            <Article id="settings" title="Settings">
              <P>
                <Code>/settings</Code> (or click your avatar → Settings). All preferences live in <Code>localStorage</Code>:
              </P>
              <Ul>
                <Li><strong>Theme</strong>: dark / light</Li>
                <Li><strong>Density</strong>: comfortable / compact</Li>
                <Li><strong>Issue / PR content display</strong>: modal / side panel / inline accordion</Li>
                <Li><strong>Render markdown</strong>: on/off for issue & PR bodies</Li>
                <Li><strong>Default issue state filter</strong> and <strong>repo sort order</strong></Li>
                <Li><strong>Page size</strong>: 10/25/50/100 for paginated tables</Li>
                <Li><strong>Notifications</strong>: enable/disable + UI tick interval</Li>
              </Ul>
            </Article>

            <Article id="shortcuts" title="Keyboard Shortcuts">
              <Kbd>Esc</Kbd> Close any open side panel, modal, or dropdown.<br />
              <Kbd>Click outside</Kbd> Same as Esc for side panels.<br />
              <Kbd>↑ / ↓</Kbd> When a dropdown is open, navigate options.<br />
              <Kbd>Enter</Kbd> Confirm dropdown selection.<br />
              <Kbd>Tab / Shift+Tab</Kbd> Move focus between interactive elements.
            </Article>
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

function Article({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Box
      id={`docs-${id}`}
      sx={{
        mb: [4, null, 5],
        scrollMarginTop: ['calc(var(--header-height) + 64px)', null, 'calc(var(--header-height) + 16px)'],
        minWidth: 0,
      }}
    >
      <Heading sx={{ fontSize: [2, null, 3], lineHeight: 1.25, mb: 2, pb: 2, borderBottom: '1px solid', borderColor: 'border.muted' }}>
        {title}
      </Heading>
      <Box sx={{ minWidth: 0, '& > * + *': { mt: 2 } }}>{children}</Box>
    </Box>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Box as="p" sx={{ mb: 2, color: 'fg.default', overflowWrap: 'anywhere' }}>{children}</Box>;
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <Heading as="h3" sx={{ fontSize: 2, mt: 3, mb: 2, color: 'fg.default' }}>
      {children}
    </Heading>
  );
}

function Ul({ children }: { children: React.ReactNode }) {
  return (
    <Box as="ul" sx={{ pl: [3, null, 4], mb: 2, '& > li + li': { mt: 1 } }}>
      {children}
    </Box>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <Box as="li" sx={{ overflowWrap: 'anywhere' }}>{children}</Box>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="code"
      sx={{
        bg: 'var(--bg-emphasis)',
        px: '6px',
        py: '1px',
        borderRadius: 4,
        fontFamily: 'mono',
        fontSize: 0,
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </Box>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="pre"
      sx={{
        bg: 'var(--bg-inset)',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        my: 2,
        fontFamily: 'mono',
        fontSize: 0,
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </Box>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: '6px',
        py: '1px',
        bg: 'var(--accent-subtle)',
        color: 'accent.fg',
        fontSize: 0,
        fontWeight: 700,
        borderRadius: 999,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Box>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="kbd"
      sx={{
        display: 'inline-block',
        bg: 'var(--bg-emphasis)',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 1,
        px: '6px',
        py: '1px',
        fontFamily: 'mono',
        fontSize: 0,
        color: 'fg.default',
        mr: 2,
        boxShadow: '0 1px 0 var(--border-default)',
      }}
    >
      {children}
    </Box>
  );
}
