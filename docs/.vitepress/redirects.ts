import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DefaultTheme } from 'vitepress';

const SITE_ORIGIN = 'https://docs.bullmq.io';

// Generated or copied as is, not documentation folders.
const SKIPPED_DIRS = new Set(['api', 'assets', 'images']);

/**
 * Pages that had another URL on the GitBook site and still get visits from
 * search engines and links elsewhere. Old path -> current path.
 */
const MOVED_PAGES: Record<string, string> = {
  '/readme-1': '/',
  '/guide/migration-to-newer-versions':
    '/guide/migrations/migration-to-newer-versions',
  '/guide/migration-to-newer-versions/bull-to-bullmq':
    '/guide/migrations/bull-to-bullmq',
};

/**
 * Writes a redirect page for every URL of the GitBook site that has no page
 * in this build, and returns the redirects as "from -> to" for logging:
 *
 * - Pages that moved (MOVED_PAGES).
 * - Changelogs of previous major versions, which GitBook served under
 *   /changelog/ (e.g. /changelog/changelog-v4) and now live under
 *   /changelogs/.
 * - Folder URLs (e.g. /bullmq-pro/). GitBook served every folder, but
 *   VitePress only builds a page for folders with a README.md, so the others
 *   redirect to their first page in SUMMARY.md order (or alphabetical order
 *   for pages that are not in SUMMARY.md).
 *
 * GitHub Pages cannot send HTTP redirects, so the pages use an instant meta
 * refresh with a canonical link, which search engines treat as a permanent
 * redirect. They carry no noindex tag, because that would stop the old URL
 * from passing its ranking on to the new one.
 */
export function writeRedirects(
  outDir: string,
  sidebar: DefaultTheme.SidebarItem[],
): string[] {
  const redirects = new Map<string, string>([
    ...Object.entries(MOVED_PAGES),
    ...movedChangelogs(outDir),
    ...folderRedirects(outDir, sidebar),
  ]);

  const written: string[] = [];
  for (const [from, to] of redirects) {
    const file = join(
      outDir,
      from.endsWith('/') ? `${from}index.html` : `${from}.html`,
    );
    if (existsSync(file)) {
      // A real page has this URL (again): the redirect is obsolete.
      continue;
    }
    if (!hasPage(outDir, to)) {
      console.warn(`Skipped redirect ${from} -> ${to}: the target is missing`);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, redirectPage(to));
    written.push(`${from} -> ${to}`);
  }
  return written;
}

/** "/guide/queues/" or "/guide/connections" -> is there a built page? */
function hasPage(outDir: string, path: string): boolean {
  return path.endsWith('/')
    ? existsSync(join(outDir, path, 'index.html'))
    : existsSync(join(outDir, `${path}.html`));
}

/**
 * /python/changelogs/changelog-v1 was /python/changelog/changelog-v1, and
 * /python/changelog/ was the current changelog, now /python/changelog.
 */
function movedChangelogs(outDir: string): [string, string][] {
  const moved: [string, string][] = [];
  for (const dir of ['', ...builtDirs(outDir)]) {
    const base = dir ? `/${dir}` : '';
    if (existsSync(join(outDir, dir, 'changelog.html'))) {
      moved.push([`${base}/changelog/`, `${base}/changelog`]);
    }
    const changelogs = join(outDir, dir, 'changelogs');
    if (!existsSync(changelogs)) {
      continue;
    }
    for (const name of readdirSync(changelogs)) {
      if (name.endsWith('.html') && name !== 'index.html') {
        const page = name.replace(/\.html$/, '');
        moved.push([`${base}/changelog/${page}`, `${base}/changelogs/${page}`]);
      }
    }
  }
  return moved;
}

function folderRedirects(
  outDir: string,
  sidebar: DefaultTheme.SidebarItem[],
): [string, string][] {
  const targets = new Map<string, string>();
  const hasIndex = (dir: string) => existsSync(join(outDir, dir, 'index.html'));

  for (const link of sidebarLinks(sidebar)) {
    for (const dir of parentDirs(link)) {
      if (!targets.has(dir) && !hasIndex(dir)) {
        targets.set(dir, link);
      }
    }
  }

  for (const dir of builtDirs(outDir)) {
    if (!targets.has(dir) && !hasIndex(dir)) {
      const first = readdirSync(join(outDir, dir))
        .filter(name => name.endsWith('.html'))
        .sort()[0];
      if (first) {
        targets.set(dir, `/${dir}/${first.replace(/\.html$/, '')}`);
      }
    }
  }

  return [...targets].map(([dir, target]) => [`/${dir}/`, target]);
}

function* sidebarLinks(items: DefaultTheme.SidebarItem[]): Generator<string> {
  for (const item of items) {
    const link = item.link;
    if (link?.startsWith('/') && !link.startsWith('/api/')) {
      yield link;
    }
    if (item.items) {
      yield* sidebarLinks(item.items);
    }
  }
}

/** "/guide/migrations/v1" -> ["guide", "guide/migrations"] */
function parentDirs(link: string): string[] {
  const parts = link
    .replace(/^\/|\/$/g, '')
    .split('/')
    .slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** Folders of the build that contain pages, relative to outDir. */
function builtDirs(outDir: string, dir = ''): string[] {
  const dirs: string[] = [];
  for (const entry of readdirSync(join(outDir, dir), { withFileTypes: true })) {
    if (!entry.isDirectory() || (!dir && SKIPPED_DIRS.has(entry.name))) {
      continue;
    }
    const child = dir ? `${dir}/${entry.name}` : entry.name;
    const hasPages = readdirSync(join(outDir, child)).some(name =>
      name.endsWith('.html'),
    );
    if (hasPages) {
      dirs.push(child);
    }
    dirs.push(...builtDirs(outDir, child));
  }
  return dirs;
}

function redirectPage(target: string): string {
  const url = `${SITE_ORIGIN}${target}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Redirecting…</title>
    <link rel="canonical" href="${url}" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <script>location.replace(${JSON.stringify(target)} + location.search + location.hash);</script>
  </head>
  <body>
    <a href="${target}">${url}</a>
  </body>
</html>
`;
}
