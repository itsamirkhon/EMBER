/** Refuse script/data/file URLs in external source citations. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function safeExternalHost(value: string | null | undefined): string | null {
  const url = safeExternalUrl(value);
  return url ? new URL(url).hostname.replace(/^www\./i, '') : null;
}
