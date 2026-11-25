<script setup lang="ts">
import { LANGUAGES } from '../languages';
import { useRuntimeLanguage } from './runtimeLanguage';

defineProps<{ screen?: boolean }>();

const language = useRuntimeLanguage();
</script>

<template>
  <label
    class="runtime-language"
    :class="{ screen }"
    title="Language used in the code examples"
  >
    <span class="runtime-language-label">Language</span>
    <select v-model="language" aria-label="Language used in the code examples">
      <option v-for="lang in LANGUAGES" :key="lang.id" :value="lang.id">
        {{ lang.label }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.runtime-language {
  display: none;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

.runtime-language.screen {
  display: flex;
  justify-content: space-between;
  margin: 24px 0 0;
  padding: 12px 14px;
  border-radius: 8px;
  background-color: var(--vp-c-bg-soft);
}

@media (min-width: 768px) {
  .runtime-language:not(.screen) {
    display: flex;
  }

  .runtime-language-label {
    display: none;
  }
}

select {
  padding: 4px 24px 4px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background-color: var(--vp-c-bg-alt);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='none' stroke='%23888' stroke-width='1.5' d='M1 1l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
  appearance: none;
  transition: border-color 0.25s;
}

select:hover,
select:focus-visible {
  border-color: var(--vp-c-brand-1);
  outline: none;
}
</style>
