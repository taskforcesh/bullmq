export interface RuntimeLanguage {
  id: string;
  label: string;
  aliases: string[];
}

// Tabs whose titles match these languages are kept in this order and synced
// with the runtime the reader picked.
export const LANGUAGES: RuntimeLanguage[] = [
  {
    id: 'typescript',
    label: 'TypeScript',
    aliases: ['typescript', 'ts', 'javascript', 'js', 'node.js', 'nodejs'],
  },
  { id: 'python', label: 'Python', aliases: ['python', 'py'] },
  { id: 'elixir', label: 'Elixir', aliases: ['elixir', 'ex'] },
  { id: 'dotnet', label: '.NET', aliases: ['.net', 'dotnet', 'c#', 'csharp'] },
  { id: 'rust', label: 'Rust', aliases: ['rust', 'rs'] },
  { id: 'php', label: 'PHP', aliases: ['php'] },
];

export const DEFAULT_LANGUAGE = LANGUAGES[0].id;

export function findLanguage(
  title?: string | null,
): RuntimeLanguage | undefined {
  const normalized = title?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return LANGUAGES.find(
    language =>
      language.id === normalized || language.aliases.includes(normalized),
  );
}

export function languageOrder(title: string): number {
  const language = findLanguage(title);
  return language ? LANGUAGES.indexOf(language) : -1;
}
