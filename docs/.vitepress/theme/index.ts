import { h, nextTick, onMounted, watch } from 'vue';
import { onContentUpdated } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import LanguageSwitcher from './LanguageSwitcher.vue';
import {
  applyLanguage,
  handleCodeGroupClick,
  useRuntimeLanguage,
} from './runtimeLanguage';

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h(LanguageSwitcher),
      'nav-screen-content-after': () => h(LanguageSwitcher, { screen: true }),
    }),
  setup() {
    const language = useRuntimeLanguage();
    const sync = () => nextTick(() => applyLanguage(language.value));

    onMounted(() => {
      window.addEventListener('click', handleCodeGroupClick);
      sync();
    });
    onContentUpdated(sync);
    watch(language, sync);
  },
} satisfies Theme;
