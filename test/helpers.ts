import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { BuildServerOptions } from '../src/server.js';
import type { WikiJsClient } from '../src/wikiClient.js';

// The config module validates the environment at import time.
process.env.WIKIJS_BASE_URL ??= 'https://wiki.example.test';
process.env.WIKIJS_API_KEY ??= 'test-key';
process.env.WIKIJS_DEFAULT_LOCALE ??= 'en';

export type FakePage = {
  id: number;
  path: string;
  title: string;
  tags?: string[];
  locale?: string;
  content?: string;
};

export type Call = { method: string; args: unknown };

/** In-memory stand-in for the Wiki.js GraphQL client. */
export class FakeWikiClient {
  readonly calls: Call[] = [];

  constructor(private pages: FakePage[]) {}

  private toListItem(p: FakePage) {
    return {
      id: p.id,
      path: p.path,
      title: p.title,
      description: '',
      isPublished: true,
      locale: p.locale ?? 'en',
      tags: p.tags ?? [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
  }

  private toPage(p: FakePage) {
    return {
      ...this.toListItem(p),
      hash: 'h',
      content: p.content ?? `# ${p.title}`,
      editor: 'markdown',
      authorName: 'a',
      creatorName: 'c',
      tags: (p.tags ?? []).map((tag) => ({ tag, title: tag })),
    };
  }

  async listPages(params: { limit?: number; orderBy?: string; tags?: string[]; locale?: string } = {}) {
    this.calls.push({ method: 'listPages', args: params });
    let list = this.pages.map((p) => this.toListItem(p));
    if (params.tags?.length) {
      list = list.filter((p) => params.tags!.every((t) => p.tags.includes(t)));
    }
    if (params.locale) list = list.filter((p) => p.locale === params.locale);
    const order = params.orderBy ?? 'TITLE';
    const key = order === 'PATH' ? 'path' : order === 'ID' ? 'id' : 'title';
    list = [...list].sort((a, b) => String(a[key as 'path']).localeCompare(String(b[key as 'path'])));
    return params.limit === undefined ? list : list.slice(0, params.limit);
  }

  async getPageById(id: number) {
    this.calls.push({ method: 'getPageById', args: { id } });
    const found = this.pages.find((p) => p.id === id);
    if (!found) throw new Error(`No page with id ${id} found.`);
    return this.toPage(found);
  }

  async getPageByPath(path: string, locale: string) {
    this.calls.push({ method: 'getPageByPath', args: { path, locale } });
    const found = this.pages.find((p) => p.path === path && (p.locale ?? 'en') === locale);
    if (!found) throw new Error(`No page found at path "${path}" (locale "${locale}").`);
    return this.toPage(found);
  }

  async searchPages(query: string, path?: string, locale?: string) {
    this.calls.push({ method: 'searchPages', args: { query, path, locale } });
    // Deliberately sloppy, like Wiki.js itself: a plain substring path match.
    const hits = this.pages.filter(
      (p) =>
        (p.title.toLowerCase().includes(query.toLowerCase()) ||
          (p.content ?? '').toLowerCase().includes(query.toLowerCase())) &&
        (!path || p.path.toLowerCase().startsWith(path.toLowerCase())),
    );
    return {
      results: hits.map((p) => ({
        id: String(p.id),
        title: p.title,
        description: '',
        path: p.path,
        locale: p.locale ?? 'en',
      })),
      suggestions: [],
      totalHits: hits.length,
    };
  }

  async grepPages(query: string, opts: { pathPrefix?: string; locale?: string } = {}) {
    this.calls.push({ method: 'grepPages', args: { query, ...opts } });
    return { matches: [], scannedPages: 0, candidatePages: this.pages.length };
  }

  async createPage(input: { path: string; title: string }) {
    this.calls.push({ method: 'createPage', args: input });
    const page = { id: 900 + this.pages.length, path: input.path, title: input.title };
    this.pages.push(page);
    return page;
  }

  async updatePage(id: number, input: Record<string, unknown>) {
    this.calls.push({ method: 'updatePage', args: { id, ...input } });
    const found = this.pages.find((p) => p.id === id);
    if (!found) throw new Error(`No page with id ${id}`);
    if (typeof input.path === 'string') found.path = input.path;
    return { id: found.id, path: found.path, title: found.title };
  }

  async deletePage(id: number) {
    this.calls.push({ method: 'deletePage', args: { id } });
    this.pages = this.pages.filter((p) => p.id !== id);
    return { id, deleted: true };
  }
}

export type ToolResult = {
  isError: boolean;
  summary: string;
  text: string;
  data: any;
};

export async function withServer(
  options: Omit<BuildServerOptions, 'client'> & { pages: FakePage[] },
  run: (call: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>, fake: FakeWikiClient) => Promise<void>,
) {
  const { buildServer } = await import('../src/server.js');
  const fake = new FakeWikiClient(options.pages);
  const server = buildServer({
    client: fake as unknown as WikiJsClient,
    pathPrefix: options.pathPrefix ?? '',
    readOnly: options.readOnly ?? false,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);

  const call = async (tool: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const res: any = await mcp.callTool({ name: tool, arguments: args });
    const text: string = res.content?.[0]?.text ?? '';
    const sep = text.indexOf('\n\n');
    let data: unknown = undefined;
    if (!res.isError && sep >= 0) {
      try {
        data = JSON.parse(text.slice(sep + 2));
      } catch {
        data = undefined;
      }
    }
    return { isError: Boolean(res.isError), summary: sep >= 0 ? text.slice(0, sep) : text, text, data };
  };

  try {
    await run(call, fake);
  } finally {
    await mcp.close();
    await server.close();
  }
}

export const CTF_PAGES: FakePage[] = [
  { id: 1, path: 'ctf2026', title: 'CTF 2026', tags: ['ctf'] },
  { id: 2, path: 'ctf2026/hosts', title: 'Hosts', tags: ['ctf', 'infra'] },
  { id: 3, path: 'ctf2026/network/hosts', title: 'Network Hosts', tags: ['ctf'] },
  { id: 4, path: 'ctf2026/writeups/box1', title: 'Box 1 Writeup', tags: ['ctf', 'writeup'] },
  { id: 5, path: 'ctf2025/hosts', title: 'Old Hosts', tags: ['ctf'] },
  { id: 6, path: 'ctf20260/test', title: 'Typo Section', tags: [] },
  { id: 7, path: 'ctf2026-old', title: 'Archived CTF', tags: [] },
  { id: 8, path: 'foo/ctf2026', title: 'Nested Mention', tags: [] },
  { id: 9, path: 'infrastructure/backup', title: 'Backup', tags: ['infra'] },
];
