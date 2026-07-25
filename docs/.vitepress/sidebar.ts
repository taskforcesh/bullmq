import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { DefaultTheme } from 'vitepress';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUMMARY_PATH = resolve(__dirname, '../gitbook/SUMMARY.md');

interface RawItem {
  text: string;
  target: string;
  depth: number;
  children: RawItem[];
}

/**
 * Converts a GitBook SUMMARY link target into a VitePress link.
 *
 * External URLs are returned untouched. Local `.md` targets are turned into
 * clean, extension-less absolute links. `README.md` files map to their
 * containing directory to match the `rewrites` configured in `config.mts`.
 */
function toLink(target: string): string {
  const cleaned = target.replace(/^<(.*)>$/, '$1').trim();
  if (/^https?:\/\//.test(cleaned)) {
    return cleaned;
  }

  let link = cleaned.replace(/\.md$/i, '');
  link = link.replace(/(^|\/)README$/i, '$1');
  if (!link.startsWith('/')) {
    link = `/${link}`;
  }
  return link;
}

const LINK_RE = /^(\s*)-\s*\[([^\]]+)\]\(([^)]+)\)\s*$/;

/**
 * Parses the GitBook `SUMMARY.md` table of contents into VitePress `nav` and
 * `sidebar` structures, so the documentation navigation stays in sync with a
 * single source of truth.
 */
export function loadNavigation(): {
  nav: DefaultTheme.NavItem[];
  sidebar: DefaultTheme.SidebarItem[];
} {
  const content = readFileSync(SUMMARY_PATH, 'utf-8');
  const lines = content.split('\n');

  const sections: { title: string; items: RawItem[] }[] = [];
  let current: { title: string; items: RawItem[] } = {
    title: 'Overview',
    items: [],
  };
  sections.push(current);

  for (const line of lines) {
    const sectionMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (sectionMatch) {
      current = { title: sectionMatch[1], items: [] };
      sections.push(current);
      continue;
    }

    const linkMatch = LINK_RE.exec(line);
    if (!linkMatch) {
      continue;
    }

    const [, indent, text, target] = linkMatch;
    const depth = Math.floor(indent.length / 2);
    const item: RawItem = { text, target, depth, children: [] };

    // Attach to the last item at depth - 1, otherwise it is a top-level item.
    let parent: RawItem | undefined;
    const stack = current.items;
    if (depth > 0) {
      let candidates: RawItem[] = stack;
      for (let level = 0; level < depth - 1; level++) {
        candidates = candidates[candidates.length - 1]?.children ?? candidates;
      }
      parent = candidates[candidates.length - 1];
    }

    if (parent) {
      parent.children.push(item);
    } else {
      current.items.push(item);
    }
  }

  const toSidebarItem = (item: RawItem): DefaultTheme.SidebarItem => {
    const node: DefaultTheme.SidebarItem = { text: item.text };
    node.link = toLink(item.target);
    if (item.children.length > 0) {
      node.collapsed = true;
      node.items = item.children.map(toSidebarItem);
    }
    return node;
  };

  const sidebar: DefaultTheme.SidebarItem[] = sections
    .filter(section => section.items.length > 0)
    .map(section => ({
      text: section.title,
      collapsed: section.title !== 'Overview' && section.title !== 'Guide',
      items: section.items.map(toSidebarItem),
    }));

  // Build a compact top navigation from the main sections.
  const sectionLink = (title: string): string | undefined => {
    const section = sections.find(s => s.title === title);
    const first = section?.items.find(i => !/^https?:\/\//.test(i.target));
    return first ? toLink(first.target) : undefined;
  };

  const nav: DefaultTheme.NavItem[] = [];
  const guideLink = sectionLink('Guide');
  if (guideLink) {
    nav.push({ text: 'Guide', link: guideLink });
  }
  const patternsLink = sectionLink('Patterns');
  if (patternsLink) {
    nav.push({ text: 'Patterns', link: patternsLink });
  }

  const languageDropdown: DefaultTheme.NavItemWithChildren = {
    text: 'Bindings',
    items: [],
  };
  for (const title of ['Python', 'Rust', 'Elixir', 'PHP']) {
    const link = sectionLink(title);
    if (link) {
      languageDropdown.items.push({ text: title, link });
    }
  }
  if (languageDropdown.items.length > 0) {
    nav.push(languageDropdown);
  }

  const proLink = sectionLink('BullMQ Pro');
  if (proLink) {
    nav.push({ text: 'Pro', link: proLink });
  }

  nav.push({ text: 'API Reference', link: 'https://api.docs.bullmq.io' });

  return { nav, sidebar };
}
