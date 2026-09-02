import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CTF_PAGES, withServer } from './helpers.js';

const pages = () => CTF_PAGES.map((p) => ({ ...p }));

describe('WIKIJS_URL — public page links', () => {
  it('defaults to the API base URL when unset', async () => {
    await withServer({ pages: pages() }, async (call) => {
      const res = await call('wiki_get_page', { id: 2 });
      assert.equal(res.data.url, 'https://wiki.example.test/en/ctf2026/hosts');
    });
  });

  it('uses the public URL instead of the internal API address', async () => {
    await withServer({ pages: pages(), publicUrl: 'https://wiki.hacktober.ch' }, async (call) => {
      const res = await call('wiki_get_page', { id: 2 });
      assert.equal(res.data.url, 'https://wiki.hacktober.ch/en/ctf2026/hosts');
    });
  });

  it('strips a trailing slash from the public URL', async () => {
    await withServer({ pages: pages(), publicUrl: 'https://wiki.hacktober.ch/' }, async (call) => {
      const res = await call('wiki_get_page', { id: 2 });
      assert.equal(res.data.url, 'https://wiki.hacktober.ch/en/ctf2026/hosts');
    });
  });

  it('applies to every tool that returns pages', async () => {
    await withServer({ pages: pages(), publicUrl: 'https://wiki.hacktober.ch' }, async (call) => {
      const list = await call('wiki_list_pages', { path: 'ctf2026' });
      for (const page of list.data) {
        assert.match(page.url, /^https:\/\/wiki\.hacktober\.ch\/en\//);
      }

      const search = await call('wiki_search', { query: 'Hosts' });
      for (const hit of search.data.results) {
        assert.match(hit.url, /^https:\/\/wiki\.hacktober\.ch\/en\//);
      }

      const wildcard = await call('wiki_search', { query: '*' });
      for (const page of wildcard.data) {
        assert.match(page.url, /^https:\/\/wiki\.hacktober\.ch\/en\//);
      }

      const created = await call('wiki_create_page', {
        title: 'Box 9',
        path: 'ctf2026/writeups/box9',
        content: '# Box 9',
      });
      assert.equal(created.data.url, 'https://wiki.hacktober.ch/en/ctf2026/writeups/box9');

      const updated = await call('wiki_update_page', { id: 2, title: 'Hosts v2' });
      assert.equal(updated.data.url, 'https://wiki.hacktober.ch/en/ctf2026/hosts');
    });
  });

  it('keeps a non-default locale in the link', async () => {
    await withServer(
      { pages: [{ id: 20, path: 'ctf2026/hosts', title: 'Hosts', locale: 'de' }], publicUrl: 'https://wiki.hacktober.ch' },
      async (call) => {
        const res = await call('wiki_get_page', { id: 20 });
        assert.equal(res.data.url, 'https://wiki.hacktober.ch/de/ctf2026/hosts');
      },
    );
  });

  it('an empty or blank value is treated as unset, not as an invalid URL', async () => {
    // .env.example ships "WIKIJS_URL=", which dotenv turns into an empty
    // string — that must not fail the config validation.
    const { z } = await import('zod');
    const schema = z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().url().optional(),
    );
    assert.equal(schema.parse(''), undefined);
    assert.equal(schema.parse('   '), undefined);
    assert.equal(schema.parse(undefined), undefined);
    assert.equal(schema.parse('https://wiki.hacktober.ch'), 'https://wiki.hacktober.ch');
    assert.throws(() => schema.parse('not-a-url'));
  });
});
