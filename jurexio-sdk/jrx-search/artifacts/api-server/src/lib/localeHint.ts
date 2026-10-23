/** Resolve locale from API body — `locale` wins over `language` alias. */
export function resolveLocale(body: {
  locale?: string | null;
  language?: string | null;
}): string | undefined {
  const raw = (body.locale ?? body.language)?.trim();
  if (!raw || raw.length > 16) return undefined;
  return raw;
}

/** Append a pass-through locale instruction to a system prompt (no translation engine). */
export function localeSystemHint(locale: string | undefined): string {
  if (!locale) return "";
  return `\n\nLOCALE: The attorney prefers responses in locale "${locale}". Write directly in that language where appropriate. There is no separate translation engine — use your own multilingual capability and keep legal precision.`;
}
