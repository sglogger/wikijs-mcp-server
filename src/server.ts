import http from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { config } from './config.js';
import { WikiJsClient } from './wikiClient.js';

const client = new WikiJsClient(config.WIKIJS_BASE_URL, config.WIKIJS_API_KEY);

function success(summary: string, data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `${summary}\n\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  };
}

function failure(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `ERROR: ${(error as Error).message}` }],
    isError: true,
  };
}

const localeParam = z
  .string()
  .optional()
  .describe(
    `Locale code of the page, e.g. "en" or "de". Optional — defaults to "${config.WIKIJS_DEFAULT_LOCALE}". Only set this if the wiki uses multiple languages.`,
  );

// LLMs frequently send numbers/booleans/arrays as strings — accept both.
const flexBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);
const flexTags = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((t) => t.trim()).filter(Boolean) : v),
  z.array(z.string()),
);

function transliterate(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function slugifySegment(segment: string): string {
  // Dots and underscores are valid in Wiki.js paths (e.g. "10.0.0.0-27") -- keep them.
  return transliterate(segment)
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Aggressive comparison key: all punctuation collapses to "-", so
// "10.0.0.0-27-hosts" and "10-0-0-0-27-hosts" compare equal.
function fuzzyPathKey(path: string): string {
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

// Accepts sloppy input ("/de/Infrastruktur/Backup Konzept") and returns the
// canonical Wiki.js form ("infrastruktur/backup-konzept").
function normalizePath(raw: string, locale: string): string {
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

// Browser URL of a page, e.g. https://wiki.example.com/en/infrastructure/backup
function pageUrl(path: string, locale: string): string {
  return `${config.WIKIJS_BASE_URL}/${locale}/${path}`;
}

const SERVER_INSTRUCTIONS = `This server manages a Wiki.js knowledge base.

Recommended workflows:
- Answer a question from the wiki: wiki_search with short keywords, then wiki_get_page with an id/path from the results.
- Every returned page carries a "url" field. When you present information from the wiki in your chat answer, ALWAYS cite the source page as a Markdown link using that url, e.g. "Quelle: [CTF Hints](https://wiki.example.com/en/ctf2026/hints)".
- Create a page from a vague request (e.g. "create a page with ssh dummy accounts"): 1) wiki_search to check whether a similar page exists (update it instead of duplicating), 2) optionally wiki_list_pages to see the existing path structure and place the new page consistently, 3) write complete, well-structured Markdown content yourself (start with a "# Heading", use sections, tables and fenced code blocks where useful — never create a near-empty page), 4) wiki_create_page. The "path" is optional — it is derived from the title automatically; sloppy paths are normalized.
- Edit a page: wiki_get_page first, modify the FULL Markdown, then wiki_update_page (content replaces the whole page).

Never invent page ids — always obtain them from wiki_list_pages, wiki_search or wiki_get_page.`;

export function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: config.MCP_SERVER_NAME,
      version: '0.5.0',
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    'wiki_list_pages',
    {
      title: 'List wiki pages',
      description:
        'List pages of the Wiki.js knowledge base. Returns for every page: numeric id, path, title, description, tags and timestamps. ' +
        'Use this to get an overview of the wiki or to find the id/path of a page when you only roughly know what you are looking for. ' +
        'For keyword search in page content use wiki_search instead. This tool only reads data and is always safe to call.',
      inputSchema: {
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Maximum number of pages to return, e.g. 50. Omit to return all pages.'),
        orderBy: z
          .enum(['ID', 'PATH', 'TITLE', 'CREATED', 'UPDATED'])
          .optional()
          .describe('Sort order. Use UPDATED to see recently changed pages first. Default: TITLE.'),
        path: z
          .string()
          .optional()
          .describe('Optional path prefix filter, e.g. "ctf2026" lists only pages below that section. "*" or empty means no filter (all pages).'),
        tags: flexTags
          .optional()
          .describe('Only return pages that have ALL of these tags, e.g. ["howto", "backup"].'),
        locale: localeParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, orderBy, path, tags, locale }) => {
      try {
        let pages = await client.listPages({ limit, orderBy, tags, locale });
        const prefix = path?.trim() ? normalizePath(path, locale ?? config.WIKIJS_DEFAULT_LOCALE) : '';
        if (prefix) {
          const want = fuzzyPathKey(prefix);
          pages = pages.filter((p) => fuzzyPathKey(p.path).startsWith(want));
        }
        return success(
          `Found ${pages.length} page(s)${prefix ? ` under "${prefix}"` : ''}. Cite the "url" of any page you quote in your answer.`,
          pages.map((p) => ({ ...p, url: pageUrl(p.path, p.locale) })),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'wiki_get_page',
    {
      title: 'Read a wiki page',
      description:
        'Read the full content (Markdown) and metadata of ONE wiki page. Provide EITHER the numeric "id" OR the "path" of the page — exactly one of the two is required. ' +
        'If you do not know the id or path yet, first call wiki_search (keyword search) or wiki_list_pages (overview) to find it. ' +
        'This tool only reads data and is always safe to call.',
      inputSchema: {
        id: z.coerce
          .number()
          .int()
          .optional()
          .describe('Numeric page id (integer), e.g. 42. Get it from wiki_list_pages or wiki_search.'),
        path: z
          .string()
          .optional()
          .describe(
            'Page path, e.g. "infrastructure/backup-concept". Prefer the canonical form (no leading slash, no locale prefix); sloppy input is normalized automatically. Ignored if "id" is given.',
          ),
        locale: localeParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, path, locale }) => {
      try {
        if (id === undefined && !path) {
          return failure(
            new Error(
              'Provide either "id" (numeric page id) or "path" (page path like "team/onboarding"). Use wiki_search or wiki_list_pages to find them.',
            ),
          );
        }
        const effectiveLocale = locale ?? config.WIKIJS_DEFAULT_LOCALE;
        if (id !== undefined) {
          const page = await client.getPageById(id);
          return success(
            `Page ${page.id} ("${page.title}", path: ${page.path}). Cite the "url" as source when quoting it.`,
            { ...page, url: pageUrl(page.path, page.locale) },
          );
        }

        const normalized = normalizePath(path!, effectiveLocale);
        try {
          const page = await client.getPageByPath(normalized, effectiveLocale);
          return success(
            `Page ${page.id} ("${page.title}", path: ${page.path}). Cite the "url" as source when quoting it.`,
            { ...page, url: pageUrl(page.path, page.locale) },
          );
        } catch (lookupError) {
          // Fuzzy fallback: resolve punctuation differences ("10-0-0-0" vs
          // "10.0.0.0") and locale mismatches against the real page list.
          const pages = await client.listPages({});
          const want = fuzzyPathKey(normalized);
          let matches = pages.filter((p) => fuzzyPathKey(p.path) === want);
          if (matches.length > 1) {
            const localeMatches = matches.filter((p) => p.locale === effectiveLocale);
            if (localeMatches.length > 0) matches = localeMatches;
          }
          if (matches.length >= 1) {
            const page = await client.getPageById(matches[0].id);
            const note =
              matches.length > 1
                ? ` Note: ${matches.length} similar pages exist; the others are ${matches
                    .slice(1)
                    .map((m) => `id ${m.id} (${m.locale}) ${m.path}`)
                    .join(', ')}.`
                : '';
            return success(
              `Page ${page.id} ("${page.title}", path: ${page.path}) — resolved from your input "${path}".${note} Cite the "url" as source when quoting it.`,
              { ...page, url: pageUrl(page.path, page.locale) },
            );
          }

          const lastSegment = want.split('/').pop() ?? '';
          const similar = lastSegment
            ? pages.filter((p) => fuzzyPathKey(p.path).includes(lastSegment)).slice(0, 10)
            : [];
          if (similar.length > 0) {
            return failure(
              new Error(
                `${(lookupError as Error).message} Similar pages that DO exist — call wiki_get_page again with one of these ids: ${similar
                  .map((p) => `id ${p.id}: ${p.path} ("${p.title}")`)
                  .join('; ')}`,
              ),
            );
          }
          throw lookupError;
        }
      } catch (error) {
        return failure(error);
      }
    },
  );

  const searchToolDefinition = {
    title: 'Search the wiki',
    description:
      'Full-text search across the Wiki.js knowledge base. Returns matching pages with id, title, description and path, plus the total number of hits. ' +
      'Use SHORT keyword queries (e.g. "backup postgres"), not full sentences or questions. ' +
      'A query of "*" (or an empty query) returns ALL pages instead of searching. ' +
      'If the search index finds nothing, page contents are scanned directly as a fallback, so content matches are found even with a weak index. ' +
      'To read the actual content of a result, call wiki_get_page with the returned id or path afterwards. ' +
      'This tool only reads data and is always safe to call.',
    inputSchema: {
      query: z
        .string()
        .describe('Search keywords, e.g. "vpn setup". Keep it short — 1 to 4 keywords work best. Use "*" to list all pages.'),
      path: z
        .string()
        .optional()
        .describe('Restrict the search to a path prefix, e.g. "infrastructure". Optional.'),
      locale: localeParam,
    },
    annotations: { readOnlyHint: true },
  };

  const searchHandler = async ({ query, path, locale }: { query: string; path?: string; locale?: string }) => {
    try {
      // Weak models often try "*" or "" to mean "everything" — serve that
      // via the page list instead of a fruitless full-text search.
      const trimmed = query.trim();
      if (trimmed === '' || /^[*%.]+$/.test(trimmed) || trimmed.toLowerCase() === 'all') {
        const pages = await client.listPages({ orderBy: 'TITLE', locale });
        return success(
          `Wildcard query — returning all ${pages.length} page(s) instead of a full-text search. Use wiki_get_page with an id or path to read one.`,
          pages.map((p) => ({ ...p, url: pageUrl(p.path, p.locale) })),
        );
      }

      const effectiveLocale = locale ?? config.WIKIJS_DEFAULT_LOCALE;
      const pathFilter = (path?.trim() ? normalizePath(path, effectiveLocale) : '') || undefined;

      const result = await client.searchPages(trimmed, pathFilter, locale);
      if (result.totalHits > 0) {
        return success(
          `${result.totalHits} hit(s) for "${trimmed}". Use wiki_get_page with an id or path from the results to read a page, and cite its "url" as source in your answer.`,
          { ...result, results: result.results.map((r) => ({ ...r, url: pageUrl(r.path, r.locale) })) },
        );
      }

      // The search index found nothing. Wiki.js' default database search
      // engine often misses words inside page content (or the index is
      // stale), so fall back to scanning the actual page contents.
      const grep = await client.grepPages(trimmed, { pathPrefix: pathFilter, locale });
      if (grep.matches.length > 0) {
        return success(
          `The Wiki.js search index returned 0 hits for "${trimmed}", but a direct content scan found ${grep.matches.length} page(s) containing it. Use wiki_get_page with an id or path to read one. (Admin hint: the Wiki.js search index seems incomplete — rebuild it under Administration → Search Engine.)`,
          grep.matches.map((m) => ({ ...m, url: pageUrl(m.path, m.locale) })),
        );
      }

      if (pathFilter && grep.candidatePages === 0) {
        const wikiWide = await client.grepPages(trimmed, { locale });
        if (wikiWide.matches.length > 0) {
          return success(
            `No pages exist under path "${pathFilter}", but "${trimmed}" was found on ${wikiWide.matches.length} page(s) elsewhere in the wiki:`,
            wikiWide.matches.map((m) => ({ ...m, url: pageUrl(m.path, m.locale) })),
          );
        }
      }

      return success(
        `0 hit(s) for "${trimmed}"${pathFilter ? ` under path "${pathFilter}"` : ''} — the search index AND a direct scan of ${grep.scannedPages} page content(s) found nothing. The term really does not appear${pathFilter ? ' there; try again without the "path" filter' : '; try different or shorter keywords'}.`,
        { results: [], totalHits: 0 },
      );
    } catch (error) {
      return failure(error);
    }
  };

  server.registerTool('wiki_search', searchToolDefinition, searchHandler);
  // Alias under the longer name so both spellings a model might guess work.
  server.registerTool(
    'wiki_search_pages',
    { ...searchToolDefinition, description: `Alias of wiki_search — identical behavior. ${searchToolDefinition.description}` },
    searchHandler,
  );

  if (config.WIKIJS_READ_ONLY) {
    console.error('WIKIJS_READ_ONLY=true — write tools (create/update/delete) are disabled.');
    return server;
  }

  server.registerTool(
    'wiki_create_page',
    {
      title: 'Create a wiki page',
      description:
        'Create a NEW page in the wiki. If a page already exists at the target path, this fails and tells you the existing page id — use wiki_update_page then. ' +
        'Before creating, consider calling wiki_search to check whether a similar page already exists. ' +
        'Write complete, well-structured Markdown for "content" — never create a near-empty page. Returns the id and path of the created page.',
      inputSchema: {
        title: z.string().min(1).describe('Human-readable page title, e.g. "Backup Concept" or "SSH Dummy Accounts".'),
        path: z
          .string()
          .optional()
          .describe(
            'Target path, e.g. "infrastructure/backup-concept". OPTIONAL — if omitted, it is derived from the title. Sloppy input (leading slash, spaces, umlauts, uppercase) is normalized automatically. Use "/" to place the page in a section, e.g. "team/onboarding".',
          ),
        content: z
          .string()
          .min(1)
          .describe('Full page content as Markdown. Start with a heading, e.g. "# Backup Concept\\n\\n...".'),
        description: z
          .string()
          .optional()
          .describe('One-sentence summary of the page, shown in search results. Optional but recommended.'),
        tags: flexTags
          .optional()
          .describe('Tags for categorization, lowercase, e.g. ["howto", "backup"]. Optional.'),
        isPublished: flexBool
          .optional()
          .describe('true (default) = immediately visible to wiki users; false = saved as unpublished draft.'),
        locale: localeParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ title, path, content, description, tags, isPublished, locale }) => {
      try {
        const effectiveLocale = locale ?? config.WIKIJS_DEFAULT_LOCALE;
        const finalPath = normalizePath(path?.trim() ? path : title, effectiveLocale);
        if (!finalPath) {
          return failure(
            new Error('Could not derive a valid path from the given title/path. Provide a path like "section/page-name".'),
          );
        }

        // Proactive duplicate check so the model gets the existing id directly.
        let existing = null;
        try {
          existing = await client.getPageByPath(finalPath, effectiveLocale);
        } catch {
          // Not found (or wiki unreachable — createPage below will surface that).
        }
        if (existing) {
          return failure(
            new Error(
              `A page already exists at "${finalPath}" (id ${existing.id}, title "${existing.title}"). Do not create a duplicate — read it with wiki_get_page (id ${existing.id}) and, if appropriate, modify it with wiki_update_page.`,
            ),
          );
        }

        const page = await client.createPage({
          title,
          path: finalPath,
          content,
          description: description ?? '',
          editor: 'markdown',
          isPublished: isPublished ?? true,
          locale: effectiveLocale,
          tags: tags ?? [],
        });
        return success(
          `Created page ${page.id} ("${page.title}") at path "${page.path}". Share the "url" with the user.`,
          { ...page, url: pageUrl(page.path, effectiveLocale) },
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'wiki_update_page',
    {
      title: 'Update a wiki page',
      description:
        'Update an EXISTING wiki page, identified by its numeric id. ' +
        'IMPORTANT: the "content" field REPLACES the entire page content. To change only part of a page: 1) call wiki_get_page to load the current content, 2) apply your edits to that full text, 3) pass the complete modified Markdown here. ' +
        'Fields you omit stay unchanged. Returns id and path of the updated page.',
      inputSchema: {
        id: z.coerce
          .number()
          .int()
          .describe('Numeric id of the page to update, e.g. 42. Get it from wiki_get_page, wiki_list_pages or wiki_search.'),
        content: z
          .string()
          .optional()
          .describe('COMPLETE new page content as Markdown. Replaces the entire existing content — never pass only the changed paragraph.'),
        title: z.string().optional().describe('New page title. Omit to keep the current title.'),
        path: z
          .string()
          .optional()
          .describe('New path (moves the page), e.g. "archive/old-concept". Omit to keep the current path.'),
        description: z.string().optional().describe('New one-sentence summary. Omit to keep the current one.'),
        tags: flexTags
          .optional()
          .describe('New COMPLETE tag list (replaces all existing tags). Omit to keep current tags.'),
        isPublished: flexBool.optional().describe('true = published, false = hidden draft. Omit to keep current state.'),
        locale: localeParam,
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, content, title, path, description, tags, isPublished, locale }) => {
      try {
        const page = await client.updatePage(id, {
          content,
          title,
          path: path !== undefined ? normalizePath(path, locale ?? config.WIKIJS_DEFAULT_LOCALE) : undefined,
          description,
          tags,
          isPublished,
          locale,
        });
        return success(
          `Updated page ${id}.${'path' in page && page.path ? ' Share the "url" with the user.' : ''}`,
          'path' in page && page.path ? { ...page, url: pageUrl(page.path, locale ?? config.WIKIJS_DEFAULT_LOCALE) } : page,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'wiki_delete_page',
    {
      title: 'Delete a wiki page',
      description:
        'PERMANENTLY delete a wiki page by its numeric id. This cannot be undone. ' +
        'Only call this after the user has EXPLICITLY confirmed the deletion of this specific page. ' +
        'Verify you have the right page first via wiki_get_page (check title and path). ' +
        'To merely hide a page instead of deleting it, use wiki_update_page with isPublished=false.',
      inputSchema: {
        id: z.coerce
          .number()
          .int()
          .describe('Numeric id of the page to delete, e.g. 42. Double-check via wiki_get_page before deleting.'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      try {
        const result = await client.deletePage(id);
        return success(`Page ${id} permanently deleted.`, result);
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!config.MCP_AUTH_TOKEN) return true;
  return req.headers.authorization === `Bearer ${config.MCP_AUTH_TOKEN}`;
}

async function startHttp() {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Not found. MCP endpoint is POST /mcp.' }));
      return;
    }

    if (!isAuthorized(req)) {
      res
        .writeHead(401, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'Unauthorized. Send header "Authorization: Bearer <MCP_AUTH_TOKEN>".' }));
      return;
    }

    // Stateless mode: a fresh server + transport per request.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res
          .writeHead(500, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, resolve));
  console.error(
    `${config.MCP_SERVER_NAME} listening on http://${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}/mcp` +
      (config.MCP_AUTH_TOKEN ? ' (bearer auth enabled)' : ' (no auth — set MCP_AUTH_TOKEN to protect the endpoint)'),
  );
}

async function startStdio() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${config.MCP_SERVER_NAME} started on stdio`);
}

const main = config.MCP_TRANSPORT === 'http' ? startHttp : startStdio;

main().catch((error) => {
  console.error('Failed to start Wiki.js MCP server:', error);
  process.exit(1);
});
