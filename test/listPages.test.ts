import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CTF_PAGES, withServer } from './helpers.js';

const paths = (data: any[]) => data.map((p) => p.path).sort();

describe('wiki_list_pages', () => {
  it('1. without a path parameter it lists the whole wiki (unchanged behaviour)', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call, fake) => {
      const res = await call('wiki_list_pages', {});
      assert.equal(res.isError, false);
      assert.equal(res.data.length, CTF_PAGES.length);
      // The limit is still delegated to Wiki.js when nothing is filtered.
      assert.deepEqual(fake.calls[0], {
        method: 'listPages',
        args: { limit: undefined, orderBy: undefined, tags: undefined, locale: undefined },
      });
    });
  });

  it('1b. without a path parameter the limit is still passed to Wiki.js', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call, fake) => {
      const res = await call('wiki_list_pages', { limit: 3 });
      assert.equal(res.data.length, 3);
      assert.equal((fake.calls[0].args as any).limit, 3);
    });
  });

  it('2. an exact path match is returned', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const res = await call('wiki_list_pages', { path: 'ctf2026' });
      assert.ok(paths(res.data).includes('ctf2026'));
    });
  });

  it('3. child paths at any depth are returned', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const res = await call('wiki_list_pages', { path: 'CTF2026', limit: 100, orderBy: 'PATH' });
      assert.deepEqual(paths(res.data), [
        'ctf2026',
        'ctf2026/hosts',
        'ctf2026/network/hosts',
        'ctf2026/writeups/box1',
      ]);
    });
  });

  it('4. unrelated paths are excluded', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const res = await call('wiki_list_pages', { path: 'ctf2026' });
      const got = paths(res.data);
      assert.ok(!got.includes('ctf2025/hosts'));
      assert.ok(!got.includes('infrastructure/backup'));
      assert.ok(!got.includes('foo/ctf2026'));
    });
  });

  it('5. a similar prefix (ctf20260, ctf2026-old) is excluded', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const res = await call('wiki_list_pages', { path: 'ctf2026' });
      const got = paths(res.data);
      assert.ok(!got.includes('ctf20260/test'));
      assert.ok(!got.includes('ctf2026-old'));
    });
  });

  it('6. a leading slash normalizes to the same result', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const plain = await call('wiki_list_pages', { path: 'CTF2026' });
      const slashed = await call('wiki_list_pages', { path: '/CTF2026' });
      assert.deepEqual(paths(slashed.data), paths(plain.data));
    });
  });

  it('7. a trailing slash normalizes to the same result', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const plain = await call('wiki_list_pages', { path: 'CTF2026' });
      const trailing = await call('wiki_list_pages', { path: 'CTF2026/' });
      const both = await call('wiki_list_pages', { path: '/CTF2026/' });
      assert.deepEqual(paths(trailing.data), paths(plain.data));
      assert.deepEqual(paths(both.data), paths(plain.data));
    });
  });

  it('8. limit stays numeric: an integer is accepted, a non-numeric string is rejected', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const ok = await call('wiki_list_pages', { path: 'ctf2026', limit: 2 });
      assert.equal(ok.data.length, 2);

      // Tolerated for compatibility with clients that stringify numbers.
      const stringified = await call('wiki_list_pages', { path: 'ctf2026', limit: '2' });
      assert.equal(stringified.data.length, 2);

      for (const bad of ['*', 'many', '', '2.5', 2.5, true, null, ['2']]) {
        const res = await call('wiki_list_pages', { limit: bad as never });
        assert.equal(res.isError, true, `limit=${JSON.stringify(bad)} should be rejected`);
        assert.match(res.text, /Input validation error.*limit/s);
        assert.match(res.text, /Expected an integer number/);
      }
      for (const outOfRange of [0, -1, 5000]) {
        const res = await call('wiki_list_pages', { limit: outOfRange });
        assert.equal(res.isError, true);
        assert.match(res.text, /limit must be an integer between 1 and 500/);
      }
    });
  });

  it('8b. the path filter is applied BEFORE the limit', async () => {
    // Sorted by PATH the ctf2026 pages are not the first ones globally, so a
    // limit applied globally first would return fewer than 4 matches.
    await withServer({ pages: [...CTF_PAGES] }, async (call, fake) => {
      const res = await call('wiki_list_pages', { path: 'ctf2026', limit: 4, orderBy: 'PATH' });
      assert.equal(res.data.length, 4);
      // Wiki.js was queried without a limit so the filter sees every page.
      assert.equal((fake.calls[0].args as any).limit, undefined);
    });
  });

  it('9. orderBy still works and is forwarded to Wiki.js', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call, fake) => {
      const res = await call('wiki_list_pages', { path: 'ctf2026', orderBy: 'PATH' });
      assert.deepEqual(
        res.data.map((p: any) => p.path),
        ['ctf2026', 'ctf2026/hosts', 'ctf2026/network/hosts', 'ctf2026/writeups/box1'],
      );
      assert.equal((fake.calls[0].args as any).orderBy, 'PATH');
      const bad = await call('wiki_list_pages', { orderBy: 'SIDEWAYS' });
      assert.equal(bad.isError, true);
      assert.match(bad.text, /Invalid enum value/);
    });
  });

  it('10. tags and path filter combine', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call, fake) => {
      const res = await call('wiki_list_pages', { path: 'ctf2026', tags: ['writeup'] });
      assert.deepEqual(paths(res.data), ['ctf2026/writeups/box1']);
      assert.deepEqual((fake.calls[0].args as any).tags, ['writeup']);

      // A tag outside the path section is filtered away by the path filter.
      const infra = await call('wiki_list_pages', { path: 'ctf2026', tags: ['infra'] });
      assert.deepEqual(paths(infra.data), ['ctf2026/hosts']);
    });
  });

  it('a wildcard path is treated as "no filter", not as a literal path', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const res = await call('wiki_list_pages', { path: '*', limit: 50 });
      assert.equal(res.data.length, CTF_PAGES.length);
    });
  });

  it('every returned page carries a url', async () => {
    await withServer({ pages: [...CTF_PAGES] }, async (call) => {
      const res = await call('wiki_list_pages', { path: 'ctf2026' });
      for (const page of res.data) {
        assert.match(page.url, /^https:\/\/wiki\.example\.test\/en\//);
      }
    });
  });
});
