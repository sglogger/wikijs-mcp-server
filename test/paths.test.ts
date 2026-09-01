import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fuzzyPathKey, normalizePath, pathMatchesPrefix, resolveFilterPrefix } from '../src/paths.js';

describe('normalizePath', () => {
  it('normalizes leading and trailing slashes consistently', () => {
    assert.equal(normalizePath('CTF2026', 'en'), 'ctf2026');
    assert.equal(normalizePath('/CTF2026', 'en'), 'ctf2026');
    assert.equal(normalizePath('CTF2026/', 'en'), 'ctf2026');
    assert.equal(normalizePath('/CTF2026/', 'en'), 'ctf2026');
    assert.equal(normalizePath('//CTF2026//', 'en'), 'ctf2026');
    assert.equal(normalizePath('  /CTF2026/  ', 'en'), 'ctf2026');
  });

  it('strips the locale prefix and a full URL', () => {
    assert.equal(normalizePath('/en/CTF2026/hosts', 'en'), 'ctf2026/hosts');
    assert.equal(normalizePath('https://wiki.example.com/de/CTF2026/hosts', 'de'), 'ctf2026/hosts');
  });

  it('treats a wildcard as no filter', () => {
    assert.equal(normalizePath('*', 'en'), '');
    assert.equal(normalizePath('', 'en'), '');
  });

  it('keeps dots and underscores inside a segment', () => {
    assert.equal(normalizePath('net/10.0.0.0-27', 'en'), 'net/10.0.0.0-27');
  });
});

describe('pathMatchesPrefix', () => {
  const prefix = 'ctf2026';

  it('matches the prefix page itself', () => {
    assert.equal(pathMatchesPrefix('ctf2026', prefix), true);
  });

  it('matches child paths at any depth', () => {
    assert.equal(pathMatchesPrefix('ctf2026/hosts', prefix), true);
    assert.equal(pathMatchesPrefix('ctf2026/network/hosts', prefix), true);
    assert.equal(pathMatchesPrefix('ctf2026/writeups/box1', prefix), true);
  });

  it('rejects unrelated and look-alike paths', () => {
    assert.equal(pathMatchesPrefix('ctf2025/hosts', prefix), false);
    assert.equal(pathMatchesPrefix('ctf20260', prefix), false);
    assert.equal(pathMatchesPrefix('ctf20260/test', prefix), false);
    assert.equal(pathMatchesPrefix('ctf2026-old', prefix), false);
    assert.equal(pathMatchesPrefix('ctf2026-old/hosts', prefix), false);
    assert.equal(pathMatchesPrefix('foo/ctf2026', prefix), false);
    assert.equal(pathMatchesPrefix('foo/ctf2026/hosts', prefix), false);
  });

  it('matches case-insensitively', () => {
    assert.equal(pathMatchesPrefix('CTF2026/Hosts', prefix), true);
    assert.equal(pathMatchesPrefix('ctf2026/hosts', 'CTF2026'), true);
  });

  it('tolerates punctuation differences inside a segment', () => {
    assert.equal(pathMatchesPrefix('net/10.0.0.0-27', 'net/10-0-0-0-27'), true);
  });

  it('treats an empty prefix as no restriction', () => {
    assert.equal(pathMatchesPrefix('anything/at/all', ''), true);
  });
});

describe('resolveFilterPrefix', () => {
  it('returns the requested filter when no scope is configured', () => {
    assert.equal(resolveFilterPrefix('/CTF2026/', '', 'en'), 'ctf2026');
    assert.equal(resolveFilterPrefix(undefined, '', 'en'), '');
    assert.equal(resolveFilterPrefix('*', '', 'en'), '');
  });

  it('falls back to the scope when no filter is given', () => {
    assert.equal(resolveFilterPrefix(undefined, 'ctf2026', 'en'), 'ctf2026');
    assert.equal(resolveFilterPrefix('*', 'ctf2026', 'en'), 'ctf2026');
  });

  it('keeps a filter that is already inside the scope', () => {
    assert.equal(resolveFilterPrefix('ctf2026/hosts', 'ctf2026', 'en'), 'ctf2026/hosts');
  });

  it('narrows a filter that would escape the scope', () => {
    assert.equal(resolveFilterPrefix('hosts', 'ctf2026', 'en'), 'ctf2026/hosts');
    assert.equal(resolveFilterPrefix('ctf2025', 'ctf2026', 'en'), 'ctf2026/ctf2025');
  });
});

describe('fuzzyPathKey', () => {
  it('collapses punctuation but keeps segment boundaries', () => {
    assert.equal(fuzzyPathKey('Net/10.0.0.0-27'), 'net/10-0-0-0-27');
    assert.equal(fuzzyPathKey('/CTF2026/Übersicht/'), 'ctf2026/uebersicht');
  });
});
