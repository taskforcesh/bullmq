import { defineConfig } from 'vitepress';
import { markdownItGitbook } from './gitbook';
import { loadNavigation } from './sidebar';

const { nav, sidebar } = loadNavigation();
const legacyApiOrigin = 'https://api.docs.bullmq.io';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'BullMQ',
  description:
    'The fastest, most reliable, Redis-based distributed queue for Node. ' +
    'Carefully written for rock solid stability and atomicity.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

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
