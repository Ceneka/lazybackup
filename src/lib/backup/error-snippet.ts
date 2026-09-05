/** Max length for compact error previews (dashboard activity, last-failure chip). */
export const ERROR_SNIPPET_MAX = 160

/** Collapse whitespace and truncate for list/card previews. Full text stays on the history page. */
export function errorSnippet(text: string | null | undefined, max = ERROR_SNIPPET_MAX): string | null {
  if (!text) return null
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return null
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}
