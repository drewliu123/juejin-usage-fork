import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseClaudeIncremental } from '../src/parsers/claude.js';
import { resetJsonlWalkCache, statFileSync } from '../src/parsers/shared.js';
import { resetProjectNameCache } from '../src/project-name.js';
import { resetCursorsCache, saveCursors } from '../src/queue/index.js';
import type { CursorsFile } from '../src/types.js';
import { isolateAgentHome, seedClaudeSession, SEEDED_CLAUDE } from './platform-fixtures.js';

const SEEDED_DEDUP = 'msg_seed_claude:req_seed_claude';

test('saveCursors replaces cursors.json without leaving a temp file behind', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-cursors-atomic-'));
  resetCursorsCache(dir);
  try {
    await saveCursors(dir, { claude: { files: {}, seenHashes: ['a'], seenUsage: {} } });
    await saveCursors(dir, { claude: { files: {}, seenHashes: ['b'], seenUsage: {} } });
    const raw = await readFile(join(dir, 'cursors.json'), 'utf8');
    assert.deepEqual(JSON.parse(raw).claude.seenHashes, ['b']);
    assert.deepEqual(await readdir(dir), ['cursors.json']);
  } finally {
    resetCursorsCache(dir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveCursors still persists when the temp file cannot be created', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-cursors-fallback-'));
  resetCursorsCache(dir);
  try {
    // A directory squatting on the temp path makes the temp write fail.
    await mkdir(join(dir, `cursors.json.${process.pid}.tmp`));
    await saveCursors(dir, { claude: { files: {}, seenHashes: ['c'], seenUsage: {} } });
    const raw = await readFile(join(dir, 'cursors.json'), 'utf8');
    assert.deepEqual(JSON.parse(raw).claude.seenHashes, ['c']);
  } finally {
    resetCursorsCache(dir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('statFileSync returns stats for a file and null when it is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-statsync-'));
  try {
    const file = join(dir, 'a.jsonl');
    await writeFile(file, 'x\n', 'utf8');
    assert.equal(statFileSync(file)?.size, 2);
    assert.equal(statFileSync(join(dir, 'missing.jsonl')), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('claude seenHashes keeps only unmigrated legacy keys and still dedups a rescan', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-claude-hashes-'));
  const restore = isolateAgentHome(home);
  resetJsonlWalkCache();
  resetProjectNameCache();
  try {
    await seedClaudeSession(home);
    const cursors: CursorsFile = {
      claude: { files: {}, seenHashes: ['legacy_only_key'], seenUsage: {} },
    };

    const first = await parseClaudeIncremental(cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(first.result.eventsParsed, SEEDED_CLAUDE.events);
    assert.ok(first.cursors.claude?.seenUsage?.[SEEDED_DEDUP]);
    // Keys already in seenUsage are not mirrored into seenHashes any more.
    assert.deepEqual(first.cursors.claude?.seenHashes, ['legacy_only_key']);

    // Forget file offsets so the same transcript is read again from 0.
    first.cursors.claude!.files = {};
    const second = await parseClaudeIncremental(first.cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(second.result.eventsParsed, 0);
    assert.equal(second.result.buckets.length, 0);
  } finally {
    restore();
    resetJsonlWalkCache();
    await rm(home, { recursive: true, force: true });
  }
});
