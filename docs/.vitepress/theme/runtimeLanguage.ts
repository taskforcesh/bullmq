import { ref, watch, type Ref } from 'vue';
import { DEFAULT_LANGUAGE, LANGUAGES, findLanguage } from '../languages';

const STORAGE_KEY = 'bullmq-docs-language';

const language = ref(DEFAULT_LANGUAGE);
let initialized = false;

function readStoredLanguage(): string | undefined {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.some(lang => lang.id === stored) ? stored! : undefined;
  } catch {
    return undefined;
  }
}

function init() {
  if (initialized || typeof window === 'undefined') {
    return;
  }
  initialized = true;

  language.value = readStoredLanguage() ?? DEFAULT_LANGUAGE;

  watch(language, value => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Storage can be unavailable (e.g. private mode); the choice then only
      // lasts for the current page view.
    }
  });

  // Keep several open browser tabs in sync.
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) {
      language.value = readStoredLanguage() ?? DEFAULT_LANGUAGE;
    }
  });
}

/**
 * The runtime language selected by the reader, persisted across pages and
 * visits.
 */
export function useRuntimeLanguage(): Ref<string> {
  init();
  return language;
}

function groupTabs(group: Element) {
  const inputs = Array.from(
    group.querySelectorAll<HTMLInputElement>(':scope > .tabs > input'),
  );
  return inputs.map(input => {
    const label = group.querySelector<HTMLLabelElement>(
      `:scope > .tabs > label[for="${input.id}"]`,
    );
    return {
      input,
      label,
      language: findLanguage(label?.dataset.title ?? label?.textContent),
    };
  });
}

function activateTab(group: Element, index: number) {
  const blocks = group.querySelector(':scope > .blocks')?.children;
  if (!blocks || !blocks[index]) {
    return;
  }

  groupTabs(group).forEach((tab, i) => {
    tab.input.checked = i === index;
  });

  Array.from(blocks).forEach((block, i) => {
    const active = i === index;
    if (block.classList.contains('active') !== active) {
      block.classList.toggle('active', active);
      if (active) {
        window.dispatchEvent(
          new CustomEvent('vitepress:codeGroupTabActivate', { detail: block }),
        );
      }
    }
  });
}

/**
 * Shows the tab of the given language in every code group of the page.
 * Groups without that language keep their current tab.
 */
export function applyLanguage(languageId: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.querySelectorAll('.vp-code-group').forEach(group => {
    const index = groupTabs(group).findIndex(
      tab => tab.language?.id === languageId,
    );
    if (index >= 0) {
      activateTab(group, index);
    }
  });
}

/**
 * Selects the reader's language when they click a language tab, keeping the
 * clicked tab at the same position on screen while the other groups (which
 * may change height) are updated.
 */
export function handleCodeGroupClick(event: MouseEvent) {
  const target = event.target as Element | null;
  if (!target?.matches('.vp-code-group input')) {
    return;
  }

  const input = target as HTMLInputElement;
  const group = input.closest('.vp-code-group');
  const tab = group ? groupTabs(group).find(t => t.input === input) : undefined;
  if (!tab?.language || tab.language.id === language.value) {
    return;
  }

  const anchor = tab.label ?? input;
  const before = anchor.getBoundingClientRect().top;

  language.value = tab.language.id;
  applyLanguage(language.value);

  const after = anchor.getBoundingClientRect().top;
  if (after !== before) {
    window.scrollBy(0, after - before);
  }
}
