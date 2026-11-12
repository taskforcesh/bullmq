import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { DefaultTheme } from 'vitepress';

const SITE_ORIGIN = 'https://docs.bullmq.io';

const SUMMARY = `> BullMQ is an open source background job and message queue. It is available natively for TypeScript/JavaScript (Node.js and Bun), Python, Elixir, Rust, .NET and PHP, and runs on Redis (or compatible datastores such as Valkey and Dragonfly) and on PostgreSQL. All SDKs share the same data model, so producers and workers written in different languages can work on the same queues.

This is the index of the BullMQ documentation. Every page is also available as Markdown by appending \`.md\` to its URL, and [llms-full.txt](${SITE_ORIGIN}/llms-full.txt) contains all the pages except the changelogs in a single file.`;

const RELATED = `## Related

- [API reference](${SITE_ORIGIN}/api/): TypeScript API of every major version of BullMQ.
- [GitHub repository](https://github.com/taskforcesh/bullmq): Source code and issue tracker.
- [bullmq.io](https://bullmq.io): Website with articles, benchmarks and news.
- [Taskforce.sh](https://taskforce.sh): Dashboard for monitoring and managing BullMQ queues, made by the BullMQ team.`;

interface Page {
  /** Source file relative to srcDir, e.g. "guide/queues/README.md". */
  file: string;
  /** Page URL, e.g. "https://docs.bullmq.io/guide/queues/". */
  url: string;
  /** URL of the Markdown copy, e.g. ".../guide/queues.md". */
  markdownUrl: string;
  description?: string;
  markdown: string;
}

/**
 * Writes what AI assistants and agents read instead of the HTML pages, as the
 * GitBook site did:
 *
 * - A Markdown copy of every page at its URL plus ".md" (folder pages at
 *   the folder's name plus ".md", e.g. /guide/queues.md).
 * - /llms.txt, an index of the pages in SUMMARY.md order (https://llmstxt.org).
 * - /llms-full.txt, all the pages except the changelogs in one file.
 */
export function writeLlmsFiles(
  outDir: string,
  srcDir: string,
  sidebar: DefaultTheme.SidebarItem[],
): { pages: number } {
  const pages = new Map<string, Page>();
  for (const file of markdownFiles(srcDir)) {
    const page = readPage(srcDir, file);
    pages.set(page.url, page);
    const target = join(outDir, new URL(page.markdownUrl).pathname);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, page.markdown);
  }

  const sections: string[] = [];
  const optional: string[] = [];
  const full: string[] = [];
  for (const group of sidebar) {
    const lines: string[] = [];
    for (const { item, depth } of flatten(group.items ?? [])) {
      if (!item.link || !item.text) {
        continue;
      }
      const url = item.link.startsWith('/')
        ? `${SITE_ORIGIN}${item.link.replace(/\/index\.html$/, '/')}`
        : item.link;
      const page = pages.get(url);
      const description = page?.description ? `: ${page.description}` : '';
      const line = `- [${item.text}](${page?.markdownUrl ?? url})${description}`;
      if (isChangelog(item.link)) {
        // Long and rarely needed: listed last, as llms.txt recommends.
        optional.push(
          `- [${changelogLabel(group.text ?? '', item)}](${page?.markdownUrl ?? url})`,
        );
        continue;
      }
      lines.push(`${'  '.repeat(depth)}${line}`);
      if (page) {
        full.push(`Source: ${page.url}\n\n${page.markdown.trim()}`);
      }
    }
    if (lines.length > 0) {
      sections.push(`## ${group.text}\n\n${lines.join('\n')}`);
    }
  }

  writeFileSync(
    join(outDir, 'llms.txt'),
    [
      '# BullMQ',
      SUMMARY,
      ...sections,
      RELATED,
      `## Optional\n\n${optional.join('\n')}`,
    ].join('\n\n') + '\n',
  );
  writeFileSync(
    join(outDir, 'llms-full.txt'),
    `# BullMQ documentation\n\n${SUMMARY}\n\n---\n\n${full.join('\n\n---\n\n')}\n`,
  );
  return { pages: pages.size };
}

/**
 * URL of the Markdown copy of a page: "/guide/connections" ->
 * "/guide/connections.md", "/guide/queues/" -> "/guide/queues.md" and
 * "/" -> "/index.md".
 */
export function markdownPath(path: string): string {
  if (path === '/') {
    return '/index.md';
  }
  return `${path.replace(/\/$/, '')}.md`;
}

/** "BullMQ Pro changelog", "BullMQ changelog v4"... */
function changelogLabel(group: string, item: DefaultTheme.SidebarItem): string {
  const product = group === 'Overview' ? 'BullMQ' : group;
  const nestjs = item.link?.includes('/nestjs/') ? ' NestJS' : '';
  const version = /^v\d+$/.test(item.text ?? '') ? ` ${item.text}` : '';
  return `${product}${nestjs} changelog${version}`;
}

function isChangelog(link: string): boolean {
  return /(^|\/)changelogs?(\/|$)/.test(link);
}

function* flatten(
  items: DefaultTheme.SidebarItem[],
  depth = 0,
): Generator<{ item: DefaultTheme.SidebarItem; depth: number }> {
  for (const item of items) {
    yield { item, depth };
    if (item.items) {
      yield* flatten(item.items, depth + 1);
    }
  }
}

/** Markdown pages of the site, relative to srcDir. */
function markdownFiles(srcDir: string, dir = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(srcDir, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && path !== 'public') {
        files.push(...markdownFiles(srcDir, path));
      }
    } else if (entry.name.endsWith('.md') && entry.name !== 'SUMMARY.md') {
      files.push(path);
    }
  }
  return files;
}

/** "guide/queues/README.md" -> "/guide/queues/" */
function pagePath(file: string): string {
  return `/${file}`.replace(/\/README\.md$/, '/').replace(/\.md$/, '');
}

function readPage(srcDir: string, file: string): Page {
  const source = readFileSync(join(srcDir, file), 'utf-8');
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const description = frontmatter
    ? /^description:\s*(?:>-?\s*\n\s*)?(.+)$/m
        .exec(frontmatter[1])?.[1]
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2')
    : undefined;
  const path = pagePath(file);
  return {
    file,
    url: `${SITE_ORIGIN}${path}`,
    markdownUrl: `${SITE_ORIGIN}${markdownPath(path)}`,
    description,
    markdown: toPlainMarkdown(
      source.slice(frontmatter?.[0].length ?? 0),
      srcDir,
      file,
    ),
  };
}

/**
 * Replaces the GitBook blocks with plain Markdown and makes the links to
 * other pages absolute, so that the copy can be read on its own.
 */
function toPlainMarkdown(source: string, srcDir: string, file: string): string {
  const hintLabels: Record<string, string> = {
    info: 'Note',
    warning: 'Warning',
    danger: 'Danger',
    success: 'Tip',
  };
  return source
    .replace(
      /\{% hint style="(\w+)" %\}\n?([\s\S]*?)\n?\{% endhint %\}/g,
      (_, style: string, body: string) =>
        `> **${hintLabels[style] ?? 'Note'}:** ${body.trim()}`.replace(
          /\n/g,
          '\n> ',
        ),
    )
    .replace(/^[ \t]*\{% tab title="([^"]*)" %\}[ \t]*$/gm, '**$1**')
    .replace(/^[ \t]*\{% code title="([^"]*)"[^%]*%\}[ \t]*$/gm, '`$1`')
    .replace(/^[ \t]*\{% \/?[a-z-]+[^%]*%\}[ \t]*\n/gm, '')
    .replace(
      /\]\((?!https?:|mailto:|#|\/)([^)\s#]+\.md)(#[^)\s]*)?\)/g,
      (match, target: string, hash = '') => {
        const linked = posix.normalize(posix.join(posix.dirname(file), target));
        if (linked.startsWith('..') || !existsSync(join(srcDir, linked))) {
          return match;
        }
        return `](${SITE_ORIGIN}${markdownPath(pagePath(linked))}${hash})`;
      },
    )
    .replace(/\n{3,}/g, '\n\n');
}
