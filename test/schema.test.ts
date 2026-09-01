import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { CTF_PAGES, FakeWikiClient } from './helpers.js';
import type { WikiJsClient } from '../src/wikiClient.js';

async function listTools(pathPrefix = '') {
  const { buildServer } = await import('../src/server.js');
  const server = buildServer({
    client: new FakeWikiClient([...CTF_PAGES]) as unknown as WikiJsClient,
    pathPrefix,
    readOnly: false,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(st), mcp.connect(ct)]);
  const { tools } = await mcp.listTools();
  await mcp.close();
  await server.close();
  return tools;
}

describe('wiki_list_pages schema and description', () => {
  it('declares path, limit, orderBy, tags and locale, all optional', async () => {
    const tool = (await listTools()).find((t) => t.name === 'wiki_list_pages')!;
    const schema: any = tool.inputSchema;
    assert.deepEqual(Object.keys(schema.properties).sort(), ['limit', 'locale', 'orderBy', 'path', 'tags']);
    assert.ok(!schema.required || schema.required.length === 0, 'no parameter may be required');
    assert.equal(schema.properties.path.type, 'string');
    assert.equal(schema.properties.orderBy.enum.join(','), 'ID,PATH,TITLE,CREATED,UPDATED');
  });

  it('spells out the rules a weak model needs', async () => {
    const tool = (await listTools()).find((t) => t.name === 'wiki_list_pages')!;
    const d = tool.description ?? '';
    assert.match(d, /Use this tool to LIST pages/);
    assert.match(d, /PATH PREFIX FILTER/);
    assert.match(d, /Do NOT use wildcards/);
    assert.match(d, /"limit" is an INTEGER, not a string/);
    assert.match(d, /\{"path": "CTF2026", "limit": 100, "orderBy": "PATH"\}/);
    assert.match((tool.inputSchema.properties as any).path.description as string, /prefix/i);
  });

  it('announces the configured scope in every page tool description', async () => {
    const tools = await listTools('CTF2026');
    for (const name of [
      'wiki_list_pages',
      'wiki_get_page',
      'wiki_search',
      'wiki_create_page',
      'wiki_update_page',
      'wiki_delete_page',
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      assert.match(tool.description ?? '', /restricted to the wiki section "ctf2026"/, `${name} description`);
    }
  });

  it('says nothing about a scope when none is configured', async () => {
    const tools = await listTools('');
    for (const tool of tools) {
      assert.doesNotMatch(tool.description ?? '', /restricted to the wiki section/);
    }
  });
});
