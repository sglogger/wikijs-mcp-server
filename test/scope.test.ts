import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CTF_PAGES, withServer } from './helpers.js';

const SCOPE = 'CTF2026'; // deliberately unnormalized, as an admin would type it
const paths = (data: any[]) => data.map((p: any) => p.path).sort();
const pages = () => CTF_PAGES.map((p) => ({ ...p }));

describe('WIKIJS_PATH_PREFIX — unset', () => {
  it('leaves every tool unrestricted', async () => {
    await withServer({ pages: pages(), pathPrefix: '' }, async (call) => {
      const list = await call('wiki_list_pages', {});
      assert.equal(list.data.length, CTF_PAGES.length);

      const outside = await call('wiki_get_page', { path: 'infrastructure/backup' });
      assert.equal(outside.isError, false);
      assert.equal(outside.data.path, 'infrastructure/backup');

      const created = await call('wiki_create_page', { title: 'Elsewhere', path: 'other/section', content: '# x' });
      assert.equal(created.isError, false);

      const deleted = await call('wiki_delete_page', { id: 9 });
      assert.equal(deleted.isError, false);
    });
  });
});

describe('WIKIJS_PATH_PREFIX — wiki_list_pages', () => {
  it('only returns pages inside the configured prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_list_pages', {});
      assert.deepEqual(paths(res.data), [
        'ctf2026',
        'ctf2026/hosts',
        'ctf2026/network/hosts',
        'ctf2026/writeups/box1',
      ]);
    });
  });

  it('never widens the scope, even with a path filter pointing outside', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_list_pages', { path: 'ctf2025' });
      assert.deepEqual(paths(res.data), []);
      const wildcard = await call('wiki_list_pages', { path: '*' });
      assert.equal(wildcard.data.length, 4);
    });
  });

  it('narrows further with a path filter inside the scope', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const absolute = await call('wiki_list_pages', { path: 'ctf2026/network' });
      assert.deepEqual(paths(absolute.data), ['ctf2026/network/hosts']);
      // A relative filter is resolved inside the scope.
      const relative = await call('wiki_list_pages', { path: 'network' });
      assert.deepEqual(paths(relative.data), ['ctf2026/network/hosts']);
    });
  });
});

describe('WIKIJS_PATH_PREFIX — wiki_search / wiki_search_pages', () => {
  it('restricts a search to the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call, fake) => {
      const res = await call('wiki_search', { query: 'Hosts' });
      assert.deepEqual(paths(res.data.results), ['ctf2026/hosts', 'ctf2026/network/hosts']);
      const searchCall = fake.calls.find((c) => c.method === 'searchPages')!;
      assert.equal((searchCall.args as any).path, 'ctf2026');
    });
  });

  it('filters look-alike paths that Wiki.js own path argument would let through', async () => {
    // The fake search does a plain startsWith, like Wiki.js — "ctf2026" would
    // otherwise leak "ctf20260/test" and "ctf2026-old".
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_search', { query: 'Typo' });
      assert.equal(res.data.totalHits, 0);
      const archived = await call('wiki_search', { query: 'Archived' });
      assert.equal(archived.data.totalHits, 0);
    });
  });

  it('restricts the wildcard listing branch too', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_search', { query: '*' });
      assert.equal(res.data.length, 4);
    });
  });

  it('does not fall back to a wiki-wide scan when scoped', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call, fake) => {
      const res = await call('wiki_search', { query: 'nothingmatchesthis' });
      assert.equal(res.data.totalHits, 0);
      const greps = fake.calls.filter((c) => c.method === 'grepPages');
      assert.equal(greps.length, 1, 'only the scoped grep, never a wiki-wide one');
      assert.equal((greps[0].args as any).pathPrefix, 'ctf2026');
    });
  });

  it('applies to the wiki_search_pages alias as well', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_search_pages', { query: 'Hosts' });
      assert.deepEqual(paths(res.data.results), ['ctf2026/hosts', 'ctf2026/network/hosts']);
    });
  });
});

describe('WIKIJS_PATH_PREFIX — wiki_get_page', () => {
  it('reads pages inside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const byPath = await call('wiki_get_page', { path: 'ctf2026/hosts' });
      assert.equal(byPath.data.path, 'ctf2026/hosts');
      const byId = await call('wiki_get_page', { id: 1 });
      assert.equal(byId.data.path, 'ctf2026');
    });
  });

  it('rejects a path outside the prefix and suggests the scoped form', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call, fake) => {
      const res = await call('wiki_get_page', { path: 'infrastructure/backup' });
      assert.equal(res.isError, true);
      assert.match(res.text, /restricted to the wiki section "ctf2026"/);
      assert.match(res.text, /Did you mean "ctf2026\/infrastructure\/backup"\?/);
      assert.equal(fake.calls.length, 0, 'Wiki.js must not even be queried');
    });
  });

  it('rejects look-alike prefixes', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      for (const path of ['ctf20260/test', 'ctf2026-old', 'foo/ctf2026', 'ctf2025/hosts']) {
        const res = await call('wiki_get_page', { path });
        assert.equal(res.isError, true, `${path} must be refused`);
      }
    });
  });

  it('rejects an id whose page lies outside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_get_page', { id: 9 });
      assert.equal(res.isError, true);
      assert.match(res.text, /Page 9 at "infrastructure\/backup" is outside/);
    });
  });

  it('does not leak out-of-scope pages through the fuzzy fallback', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      // "ctf2026/backup" does not exist; the fuzzy fallback must not offer
      // "infrastructure/backup" as a similar page.
      const res = await call('wiki_get_page', { path: 'ctf2026/backup' });
      assert.equal(res.isError, true);
      assert.doesNotMatch(res.text, /infrastructure\/backup/);
    });
  });
});

describe('WIKIJS_PATH_PREFIX — wiki_create_page', () => {
  it('creates inside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_create_page', { title: 'Box 2', path: 'ctf2026/writeups/box2', content: '# Box 2' });
      assert.equal(res.isError, false);
      assert.equal(res.data.path, 'ctf2026/writeups/box2');
    });
  });

  it('rejects a path outside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call, fake) => {
      const res = await call('wiki_create_page', { title: 'Sneaky', path: 'ctf2025/box2', content: '# x' });
      assert.equal(res.isError, true);
      assert.match(res.text, /outside that section/);
      assert.equal(fake.calls.filter((c) => c.method === 'createPage').length, 0);
    });
  });

  it('rejects a title-derived path outside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_create_page', { title: 'Loose Notes', content: '# x' });
      assert.equal(res.isError, true);
      assert.match(res.text, /"loose-notes" is outside that section/);
    });
  });

  it('rejects the look-alike sibling section', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_create_page', { title: 'Nope', path: 'ctf2026-old/x', content: '# x' });
      assert.equal(res.isError, true);
    });
  });
});

describe('WIKIJS_PATH_PREFIX — wiki_update_page', () => {
  it('updates a page inside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_update_page', { id: 2, content: '# Updated' });
      assert.equal(res.isError, false);
    });
  });

  it('rejects updating a page outside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call, fake) => {
      const res = await call('wiki_update_page', { id: 9, content: '# nope' });
      assert.equal(res.isError, true);
      assert.match(res.text, /Page 9 at "infrastructure\/backup" is outside/);
      assert.equal(fake.calls.filter((c) => c.method === 'updatePage').length, 0);
    });
  });

  it('rejects moving a page out of the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call, fake) => {
      const res = await call('wiki_update_page', { id: 2, path: 'infrastructure/hosts' });
      assert.equal(res.isError, true);
      assert.match(res.text, /The new path "infrastructure\/hosts" is outside/);
      assert.equal(fake.calls.filter((c) => c.method === 'updatePage').length, 0);
    });
  });

  it('rejects a move to a look-alike sibling section', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_update_page', { id: 2, path: 'ctf20260/hosts' });
      assert.equal(res.isError, true);
    });
  });

  it('allows a move inside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_update_page', { id: 2, path: '/CTF2026/infra/hosts/' });
      assert.equal(res.isError, false);
      assert.equal(res.data.path, 'ctf2026/infra/hosts');
    });
  });
});

describe('WIKIJS_PATH_PREFIX — wiki_delete_page', () => {
  it('deletes a page inside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call) => {
      const res = await call('wiki_delete_page', { id: 4 });
      assert.equal(res.isError, false);
    });
  });

  it('rejects deleting a page outside the prefix', async () => {
    await withServer({ pages: pages(), pathPrefix: SCOPE }, async (call, fake) => {
      const res = await call('wiki_delete_page', { id: 7 });
      assert.equal(res.isError, true);
      assert.match(res.text, /outside that section/);
      assert.equal(fake.calls.filter((c) => c.method === 'deletePage').length, 0);
    });
  });
});

describe('WIKIJS_PATH_PREFIX — normalization', () => {
  for (const raw of ['CTF2026', '/CTF2026', 'CTF2026/', '/CTF2026/', '/en/CTF2026']) {
    it(`normalizes ${JSON.stringify(raw)} to the same scope`, async () => {
      await withServer({ pages: pages(), pathPrefix: raw }, async (call) => {
        const res = await call('wiki_list_pages', {});
        assert.deepEqual(paths(res.data), [
          'ctf2026',
          'ctf2026/hosts',
          'ctf2026/network/hosts',
          'ctf2026/writeups/box1',
        ]);
      });
    });
  }
});

describe('WIKIJS_READ_ONLY still hides the write tools', () => {
  it('registers only the read tools', async () => {
    await withServer({ pages: pages(), readOnly: true }, async (call) => {
      const denied = await call('wiki_delete_page', { id: 1 });
      assert.equal(denied.isError, true);
      assert.match(denied.text, /wiki_delete_page not found/);
      const res = await call('wiki_list_pages', {});
      assert.equal(res.isError, false);
    });
  });
});
