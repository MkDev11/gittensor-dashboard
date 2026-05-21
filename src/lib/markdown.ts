// GitHub-flavored markdown renderer for issue/PR bodies.
// Uses `marked` (CommonMark + GFM) and DOMPurify for sanitization.
// Output is styled by .md-content rules in globals.css to match github.com.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  // GitHub does NOT convert single newlines inside paragraphs to <br/>.
  breaks: false,
});

const SANITIZE_OPTS = {
  ADD_TAGS: ['svg', 'path'],
  ADD_ATTR: ['target', 'rel', 'aria-hidden', 'focusable', 'viewBox', 'fill', 'class'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
};

type MarkdownRenderOptions = {
  repoFullName?: string | null;
};

// Open every rendered link in a new tab with safe rel attributes.
// Done as a post-process so we don't have to override marked's renderer
// (which would lose its internal `this` context for parseInline).
function openLinksInNewTab(html: string): string {
  return html.replace(/<a (?![^>]*\btarget=)/g, '<a target="_blank" rel="noreferrer noopener" ');
}

const ISSUE_REF_RE = /(^|[^\w/.-])((?:(PR|pr|Pull Request|pull request)\s+)?(?:(\b[\w.-]+\/[\w.-]+)#|#)(\d+))/g;
const SKIP_AUTOLINK_TAGS = new Set(['A', 'CODE', 'PRE', 'KBD', 'SCRIPT', 'STYLE']);

function shouldSkipAutolink(node: Text): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP_AUTOLINK_TAGS.has(el.tagName)) return true;
  }
  return false;
}

function refIconSvg(documentRef: Document, kind: 'issue' | 'pull'): SVGSVGElement {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('class', 'gh-ref-icon');
  const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    kind === 'pull'
      ? 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A3.5 3.5 0 0 1 14.5 6v4.628a2.251 2.251 0 1 1-1.5 0V6a2 2 0 0 0-2-2h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z'
      : 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z'
  );
  svg.appendChild(path);
  return svg;
}

function createRefLink(documentRef: Document, repo: string, number: string, kind: 'issue' | 'pull', label: string): HTMLAnchorElement {
  const a = documentRef.createElement('a');
  a.href = `https://github.com/${repo}/${kind === 'pull' ? 'pull' : 'issues'}/${number}`;
  a.target = '_blank';
  a.rel = 'noreferrer noopener';
  a.className = `gh-ref gh-ref-${kind}`;
  a.appendChild(refIconSvg(documentRef, kind));
  a.appendChild(documentRef.createTextNode(label));
  return a;
}

function autolinkGitHubReferences(html: string, repoFullName: string | null | undefined): string {
  if (!repoFullName || typeof document === 'undefined') return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text && node.nodeValue?.includes('#') && !shouldSkipAutolink(node)) {
      textNodes.push(node);
    }
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? '';
    ISSUE_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let changed = false;

    while ((match = ISSUE_REF_RE.exec(text))) {
      const index = match.index;
      const [rawMatch, separator, fullRef, prPrefix, explicitRepo, number] = match;
      const repo = explicitRepo ?? repoFullName;
      const kind = prPrefix ? 'pull' : 'issue';
      const label = explicitRepo ? `${explicitRepo}#${number}` : `#${number}`;

      fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
      if (separator) fragment.appendChild(document.createTextNode(separator));
      if (prPrefix) fragment.appendChild(document.createTextNode(prPrefix));
      fragment.appendChild(createRefLink(document, repo, number, kind, prPrefix ? label : fullRef));
      lastIndex = index + rawMatch.length;
      changed = true;
    }

    if (!changed) continue;
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    textNode.replaceWith(fragment);
  }

  return template.innerHTML;
}

// LRU cache so re-opening the same issue/PR (or a viewer re-render with the
// same body string) doesn't re-parse + re-sanitize. ContentViewer can blast
// through the same body 10+ times during a single open as TanStack Query
// settles its cache, so even a small cache pays for itself.
const MARKDOWN_CACHE_LIMIT = 256;
const markdownCache = new Map<string, string>();
function memoizedRender(key: string, build: () => string): string {
  const hit = markdownCache.get(key);
  if (hit !== undefined) {
    // Re-insert at the tail so it's marked recently-used.
    markdownCache.delete(key);
    markdownCache.set(key, hit);
    return hit;
  }
  const value = build();
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value;
    if (oldest !== undefined) markdownCache.delete(oldest);
  }
  markdownCache.set(key, value);
  return value;
}

export function renderMarkdownToHtml(input: string, options: MarkdownRenderOptions = {}): string {
  if (!input) return '';
  const isClient = typeof window !== 'undefined';
  // Cache per-environment so the unsanitized SSR output never leaks into a
  // later client-side call.
  const cacheKey = `${isClient ? 'c' : 's'}:${options.repoFullName ?? ''}:${input}`;
  return memoizedRender(cacheKey, () => {
    const raw = autolinkGitHubReferences(
      openLinksInNewTab(marked.parse(input, { async: false }) as string),
      options.repoFullName
    );
    if (!isClient) return raw;
    return DOMPurify.sanitize(raw, SANITIZE_OPTS);
  });
}

// Some submissions are pasted from an issue-generator template:
//
//   **Body:**
//   ```markdown
//   ...actual GitHub issue body...
//   ```
//
// github.com renders the actual submitted body, not the outer generator
// wrapper. Extracting the inner markdown keeps the dashboard view aligned
// with what users expect to inspect on GitHub.
export function normalizeGitHubBodyMarkdown(input: string): string {
  const bodyBlock = input.match(/(?:^|\n)\*\*Body:\*\*\s*\n+```(?:markdown|md)?[^\n]*\n([\s\S]*?)\n```/i);
  if (bodyBlock?.[1]) return bodyBlock[1].trim();

  const wholeFence = input.match(/^```(?:markdown|md)?[^\n]*\n([\s\S]*?)\n```\s*$/i);
  if (wholeFence?.[1]) return wholeFence[1].trim();

  return input;
}
