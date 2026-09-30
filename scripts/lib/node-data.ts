/** Node-side fetcher for the snapshots in public/data. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonFetcher } from '../../src/data/snapshots';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(ROOT, 'public', 'data');

export const nodeFetcher: JsonFetcher = async (path) => JSON.parse(readFileSync(join(DATA_DIR, path), 'utf8'));
