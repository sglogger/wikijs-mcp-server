import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { WikiJsClient } from '../src/wikiClient.js';

type GraphqlCall = { query: string; variables: Record<string, any> };

const PAGE = {
  id: 37,
  path: 'ctf2026/hosts',
  hash: 'h',
  title: 'Hosts',
  description: 'Host inventory',
  content: '# Hosts\n\nold',
  editor: 'markdown',
  locale: 'en',
  authorName: 'a',
  creatorName: 'c',
  isPublished: true,
  tags: [{ tag: 'ctf', title: 'ctf' }, { tag: 'infra', title: 'infra' }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const realFetch = globalThis.fetch;

/** Stubs fetch with a minimal Wiki.js GraphQL endpoint and records the calls. */
function stubWiki(page: typeof PAGE | null = PAGE) {
  const calls: GraphqlCall[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ query: body.query, variables: body.variables });
    const data = body.query.includes('mutation')
      ? {
          pages: {
            update: {
              responseResult: { succeeded: true, errorCode: 0, slug: 'ok', message: 'ok' },
              page: { id: page?.id ?? 0, path: page?.path ?? '', title: page?.title ?? '' },
            },
          },
        }
      : { pages: { single: page } };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

const mutationVars = (calls: GraphqlCall[]) => calls.find((c) => c.query.includes('mutation'))!.variables;

describe('WikiJsClient.updatePage', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('keeps the page published when isPublished is omitted', async () => {
    const calls = stubWiki();
    const client = new WikiJsClient('https://wiki.example.test', 'k');
    await client.updatePage(37, { content: '# Hosts\n\nnew' });
    assert.equal(mutationVars(calls).isPublished, true);
  });

  it('sends the current tags when tags are omitted (Wiki.js crashes on undefined tags)', async () => {
    const calls = stubWiki();
    const client = new WikiJsClient('https://wiki.example.test', 'k');
    await client.updatePage(37, { content: '# Hosts\n\nnew' });
    assert.deepEqual(mutationVars(calls).tags, ['ctf', 'infra']);
  });

  it('keeps title, description, path and locale of the page it did not touch', async () => {
    const calls = stubWiki();
    const client = new WikiJsClient('https://wiki.example.test', 'k');
    await client.updatePage(37, { content: '# Hosts\n\nnew' });
    const vars = mutationVars(calls);
    assert.equal(vars.title, 'Hosts');
    assert.equal(vars.description, 'Host inventory');
    assert.equal(vars.path, 'ctf2026/hosts');
    assert.equal(vars.locale, 'en');
    assert.equal(vars.content, '# Hosts\n\nnew');
  });

  it('still honours an explicit isPublished=false and an explicit tag list', async () => {
    const calls = stubWiki();
    const client = new WikiJsClient('https://wiki.example.test', 'k');
    await client.updatePage(37, { isPublished: false, tags: ['draft'] });
    const vars = mutationVars(calls);
    assert.equal(vars.isPublished, false);
    assert.deepEqual(vars.tags, ['draft']);
    // Content is untouched but must still be sent, or Wiki.js would blank it.
    assert.equal(vars.content, '# Hosts\n\nold');
  });

  it('republishes a page that is currently an unpublished draft only on request', async () => {
    const calls = stubWiki({ ...PAGE, isPublished: false });
    const client = new WikiJsClient('https://wiki.example.test', 'k');
    await client.updatePage(37, { content: 'x' });
    assert.equal(mutationVars(calls).isPublished, false);

    const calls2 = stubWiki({ ...PAGE, isPublished: false });
    await client.updatePage(37, { content: 'x', isPublished: true });
    assert.equal(mutationVars(calls2).isPublished, true);
  });

  it('reuses a caller-supplied page instead of fetching it again', async () => {
    const calls = stubWiki();
    const client = new WikiJsClient('https://wiki.example.test', 'k');
    await client.updatePage(37, { content: 'x' }, { ...PAGE, title: 'From caller' } as any);
    assert.equal(calls.length, 1, 'only the mutation should hit the API');
    assert.equal(mutationVars(calls).title, 'From caller');
  });
});
