import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';

test('built delivery registers a lazy DSH module and uses only host React as an external', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8');
  const entries = [];
  const realm = vm.createContext({
    window: { __ModuleLoader__: { load: entry => entries.push(entry) } },
    console, URL, setTimeout, clearTimeout,
  });
  vm.runInContext(source, realm, { timeout: 5000 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, manifest.name);
  const externals = [];
  const require = createRequire(import.meta.url);
  const exports = entries[0].factory(id => {
    externals.push(id);
    assert.equal(id, 'react');
    return require(id);
  });
  assert.deepEqual(externals, ['react']);
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(Array.from(exports.inject), ['slots', 'locale', 'layout']);
  assert.equal(exports.PANEL_ID, 'dsh-artplayer');
  assert.equal(Object.keys(manifest.dependencies || {}).length, 0);
  assert.equal(manifest.exports['./client'], './dist/client.js');
});
