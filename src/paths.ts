// Path helpers shared by the config layer, the Wiki.js client and the MCP tools.
// Wiki.js stores paths without a leading slash and without the locale prefix
// ("infrastructure/backup-concept"); everything here normalizes towards that form.

export function transliterate(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function slugifySegment(segment: string): string {
  // Dots and underscores are valid in Wiki.js paths (e.g. "10.0.0.0-27") -- keep them.
  return transliterate(segment)
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Aggressive comparison key: all punctuation collapses to "-", so
// "10.0.0.0-27-hosts" and "10-0-0-0-27-hosts" compare equal. Segment
// boundaries ("/") are preserved, which is what makes prefix matching safe.
export function fuzzyPathKey(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      transliterate(seg)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('/');
}

// Accepts sloppy input ("/de/Infrastruktur/Backup Konzept", "CTF2026/") and
// returns the canonical Wiki.js form ("infrastruktur/backup-konzept").
// Leading and trailing slashes are always removed. Wildcards ("*") normalize
// to "" so that callers can treat them as "no filter".
export function normalizePath(raw: string, locale: string): string {
  let segments = raw
    .trim()
    .replace(/^https?:\/\/[^/]+/i, '')
    .split('/')
    .filter(Boolean);
  if (segments.length > 1 && segments[0].toLowerCase() === locale.toLowerCase()) {
    segments = segments.slice(1);
  }
  return segments.map(slugifySegment).filter(Boolean).join('/');
}

/**
 * True when `pagePath` is the prefix itself or lies below it.
 *
 * Deliberately NOT a plain startsWith(): with prefix "ctf2026" that would also
 * match "ctf20260" and "ctf2026-old". Matching happens on whole path segments.
 * An empty prefix means "no restriction" and matches everything.
 */
export function pathMatchesPrefix(pagePath: string, prefix: string): boolean {
  const want = fuzzyPathKey(prefix);
  if (!want) return true;
  const key = fuzzyPathKey(pagePath);
  return key === want || key.startsWith(`${want}/`);
}

/**
 * Effective prefix filter for the read tools (list/search).
 *
 * `scope` is the hard server-side restriction (WIKIJS_PATH_PREFIX, already
 * normalized), `requested` the optional per-call "path" argument. A requested
 * filter can only ever narrow the scope, never widen it: a filter that lies
 * outside the scope is interpreted relative to it ("hosts" -> "ctf2026/hosts").
 */
export function resolveFilterPrefix(requested: string | undefined, scope: string, locale: string): string {
  const wanted = requested?.trim() ? normalizePath(requested, locale) : '';
  if (!scope) return wanted;
  if (!wanted) return scope;
  if (pathMatchesPrefix(wanted, scope)) return wanted;
  return `${scope}/${wanted}`;
}
