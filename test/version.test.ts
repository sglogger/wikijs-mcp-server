import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import './helpers.js'; // sets the test environment before config is loaded
import type { WikiJsClient } from '../src/wikiClient.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('version', () => {
  it('package.json and the advertised MCP server version match', async () => {
    const { SERVER_VERSION } = await import('../src/server.js');
    assert.equal(SERVER_VERSION, pkg.version, 'bump both package.json and SERVER_VERSION');
  });

  it('is reported to the client during the MCP handshake', async () => {
    const { buildServer } = await import('../src/server.js');
    const server = buildServer({ client: {} as unknown as WikiJsClient });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([server.connect(st), mcp.connect(ct)]);
    assert.equal(mcp.getServerVersion()?.version, pkg.version);
    await mcp.close();
    await server.close();
  });

  it('follows semver', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  });
});
