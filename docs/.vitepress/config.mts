import { defineConfig } from 'vitepress';
import { markdownItGitbook } from './gitbook';
import { markdownPath, writeLlmsFiles } from './llms';
import { writeRedirects } from './redirects';
import { loadNavigation } from './sidebar';

const { nav, sidebar } = loadNavigation();
const legacyApiOrigin = 'https://api.docs.bullmq.io';
const hostname = 'https://docs.bullmq.io';

// The changelogs are generated and start with a version heading, which
// VitePress would use as the title of the page.
const changelogProducts: Record<string, string> = {
  '': 'BullMQ',
  'bullmq-pro': 'BullMQ Pro',
  'bullmq-pro/nestjs': 'BullMQ Pro for NestJS',
  python: 'BullMQ for Python',
  elixir: 'BullMQ for Elixir',
  php: 'BullMQ for PHP',
  rust: 'BullMQ for Rust',
  dotnet: 'BullMQ for .NET',
};

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'BullMQ',
  description:
    'The fastest, most reliable distributed queue for Node.js, Bun, Python, ' +
    'Elixir, .NET, Rust and PHP, on top of Redis or PostgreSQL. ' +
    'Carefully written for rock solid stability and atomicity.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname },

  // One canonical URL per page. Folder pages (GitBook README.md, rewritten to
  // index.md) live at /guide/queues/, other pages at /guide/connections, and
  // each also answers at the other form, so search engines need the canonical.
  transformPageData(pageData) {
    const path = pageData.relativePath
      .replace(/(^|\/)index\.md$/, '$1')
      .replace(/\.md$/, '');
    const url = `${hostname}/${path}`;
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      // The Markdown copy of the page, written by writeLlmsFiles.
      [
        'link',
        {
          rel: 'alternate',
          type: 'text/markdown',
          href: `${hostname}${markdownPath(`/${path}`)}`,
        },
      ],
    );

    const changelog = /^(?:(.+)\/)?changelog(?:s\/changelog-(v\d+))?\.md$/.exec(
      pageData.relativePath,
    );
    const product = changelog && changelogProducts[changelog[1] ?? ''];
    if (product) {
      const version = changelog[2] ? ` ${changelog[2]}` : '';
      pageData.title = `${product}${version} changelog`;
      pageData.description = `Release notes of ${product}${version}: features, bug fixes and performance improvements of every release.`;
    }
  },

  buildEnd: siteConfig => {
    const redirects = writeRedirects(siteConfig.outDir, sidebar);
    console.log(`Wrote ${redirects.length} redirects for legacy URLs`);
    const { pages } = writeLlmsFiles(
      siteConfig.outDir,
      siteConfig.srcDir,
      sidebar,
    );
    console.log(`Wrote llms.txt, llms-full.txt and ${pages} Markdown pages`);
  },

  // Content lives in ./gitbook (migrated from the GitBook site).
  srcDir: 'gitbook',
  srcExclude: ['**/SUMMARY.md'],

  // GitBook used README.md as the index of each folder; map those to clean
  // directory URLs (e.g. guide/queues/README.md -> /guide/queues/).
  rewrites: (id: string) => id.replace(/(^|\/)README\.md$/, '$1index.md'),

  // The migrated content contains many cross-links and anchors that are not
  // worth auditing as part of the migration; skip dead-link checking.
  ignoreDeadLinks: true,

  markdown: {
    config: md => {
      md.use(markdownItGitbook);
      md.core.ruler.after('inline', 'rewrite-api-reference-links', state => {
        for (const token of state.tokens) {
          for (const child of token.children ?? []) {
            if (child.type === 'link_open') {
              const href = child.attrGet('href');
              if (href === legacyApiOrigin || href === `${legacyApiOrigin}/`) {
                child.attrSet('href', '/api/index.html');
              } else if (href?.startsWith(`${legacyApiOrigin}/`)) {
                child.attrSet(
                  'href',
                  `/api/${href.slice(legacyApiOrigin.length + 1)}`,
                );
              }
              if (child.attrGet('href')?.startsWith('/api/')) {
                child.attrSet('target', '_self');
              }
            }
          }
        }
      });
    },
  },

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav,
    sidebar,

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/taskforcesh/bullmq' },
      { icon: 'discord', link: 'https://discord.gg/f4uq7dv' },
    ],

    editLink: {
      pattern:
        'https://github.com/taskforcesh/bullmq/edit/master/docs/gitbook/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2018-present Taskforce.sh Inc.',
    },
  },
});
