import type MarkdownIt from 'markdown-it';
import { languageOrder } from './languages';

// Maps GitBook hint styles to VitePress custom-container types.
const HINT_STYLES: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'tip',
};

/**
 * Sorts the tabs of every `{% tabs %}` block whose titles are all runtime
 * languages, so that languages always appear in the same order.
 */
export function sortLanguageTabs(src: string): string {
  return src.replace(
    /\{%\s*tabs\s*%\}([\s\S]*?)\{%\s*endtabs\s*%\}/g,
    (block: string, body: string) => {
      const tabs = [
        ...body.matchAll(
          /\{%\s*tab\s+title="([^"]*)"\s*%\}[\s\S]*?\{%\s*endtab\s*%\}/g,
        ),
      ].map(match => ({ title: match[1], content: match[0] }));

      if (tabs.length < 2 || tabs.some(tab => languageOrder(tab.title) < 0)) {
        return block;
      }

      const sorted = tabs
        .map((tab, index) => ({ ...tab, index }))
        .sort(
          (a, b) =>
            languageOrder(a.title) - languageOrder(b.title) ||
            a.index - b.index,
        );

      return `{% tabs %}\n${sorted.map(tab => tab.content).join('\n\n')}\n{% endtabs %}`;
    },
  );
}

/**
 * Converts GitBook-flavoured Markdown into the equivalent VitePress Markdown.
 *
 * The docs were originally authored for GitBook, which uses a handful of
 * `{% ... %}` block tags that VitePress does not understand. This rewrites the
 * most common ones so the existing content renders correctly:
 *
 *  - `{% hint style="..." %}`  -\> `::: info | tip | warning | danger`
 *  - `{% tabs %}` / `{% tab %}` -\> `::: code-group` with labeled code fences
 *  - `{% code title="..." %}`   -\> a labeled `::: code-group` block
 */
export function transformGitbookMarkdown(src: string): string {
  let out = sortLanguageTabs(src);

  // {% code title="file.ts" lineNumbers="true" %} ```lang ... ``` {% endcode %}
  out = out.replace(
    /\{%\s*code([^%]*)%\}\s*\r?\n```(\w*)([^\n]*)\n([\s\S]*?)```\s*\r?\n\{%\s*endcode\s*%\}/g,
    (_match, attrs: string, lang: string, fenceAttrs: string, code: string) => {
      const title = /title="([^"]*)"/.exec(attrs)?.[1];
      const lineNumbers = /lineNumbers="true"/.test(attrs)
        ? ':line-numbers'
        : '';
      const label = title ? ` [${title}]` : '';
      return `::: code-group\n\`\`\`${lang}${lineNumbers}${label}${fenceAttrs}\n${code}\`\`\`\n:::`;
    },
  );

  // {% tabs %} ... {% endtabs %} wrapping labelled {% tab title="..." %} blocks.
  out = out.replace(/\{%\s*tabs\s*%\}/g, '\n::: code-group\n');
  out = out.replace(/\{%\s*endtabs\s*%\}/g, '\n:::\n');
  // {% tab title="TypeScript" %} immediately followed by a code fence becomes a
  // labelled fence understood by the surrounding ::: code-group block.
  out = out.replace(
    /\{%\s*tab\s+title="([^"]*)"\s*%\}\s*\r?\n+```(\w*)/g,
    (_match, title: string, lang: string) => `\`\`\`${lang} [${title}]`,
  );
  // Drop any leftover tab markers (e.g. tabs that did not wrap a code fence).
  out = out.replace(/\{%\s*tab\s+title="[^"]*"\s*%\}/g, '');
  out = out.replace(/\{%\s*endtab\s*%\}/g, '');

  // {% hint style="info" %} ... {% endhint %}
  out = out.replace(
    /\{%\s*hint\s+style="([^"]*)"\s*%\}/g,
    (_match, style: string) => {
      const type = HINT_STYLES[style] ?? 'info';
      return `\n::: ${type}\n`;
    },
  );
  out = out.replace(/\{%\s*endhint\s*%\}/g, '\n:::\n');

  return out;
}

/**
 * markdown-it plugin that rewrites GitBook syntax before block tokenization.
 */
export function markdownItGitbook(md: MarkdownIt): void {
  md.core.ruler.before('block', 'gitbook', state => {
    state.src = transformGitbookMarkdown(state.src);
  });
}
