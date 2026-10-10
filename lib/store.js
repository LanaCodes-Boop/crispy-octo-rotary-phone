// Where appointments live.
// - Locally / on a VPS: a JSON file in DATA_DIR (default ./data).
// - On Vercel (or anywhere without a disk): Upstash Redis over its REST API, configured by the
//   env vars the Vercel ↔ Upstash integration adds (KV_REST_API_URL + KV_REST_API_TOKEN, or
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
//
// Both expose the same API: load(), save(db) and lock() → release(). Every write happens inside
// lock() so two simultaneous bookings can never grab the same slot.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const EMPTY = () => ({ bookings: [], blocks: [] });

function fileStore(dataDir) {
  const file = join(dataDir, 'db.json');
  let cache = null;
  let queue = Promise.resolve();

  return {
    kind: 'file',
    async load() {
      if (!cache) {
        try {
          cache = { ...EMPTY(), ...JSON.parse(await readFile(file, 'utf8')) };
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
          cache = EMPTY();
        }
      }
      return cache;
    },
    async save(db) {
      cache = db;
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(db, null, 2));
      await rename(tmp, file);
    },
    // In-process mutex: requests queue up and run one at a time.
    lock() {
      let release;
      const turn = new Promise((resolve) => (release = resolve));
      const ready = queue.then(() => release);
      queue = queue.then(() => turn);
      return ready;
    },
  };
}

function redisStore(url, token, key = 'younique:db') {
  const call = async (...command) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Storage error: ${body.error || res.status}`);
    return body.result;
  };

  return {
    kind: 'redis',
    async load() {
      const raw = await call('GET', key);
      return raw ? { ...EMPTY(), ...JSON.parse(raw) } : EMPTY();
    },
    async save(db) {
      await call('SET', key, JSON.stringify(db));
    },
    // Short-lived distributed lock (SET NX PX) so concurrent serverless instances take turns.
    async lock() {
      const lockKey = `${key}:lock`;
      const id = randomUUID();
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await call('SET', lockKey, id, 'NX', 'PX', '10000')) === 'OK') {
          return async () => {
            if ((await call('GET', lockKey)) === id) await call('DEL', lockKey);
          };
        }
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
      }
      throw Object.assign(new Error('The booking system is busy, please try again.'), { status: 503 });
    },
  };
}

export function createStore({ dataDir }) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url.replace(/\/$/, ''), token);
  // Serverless platforms have no lasting disk: report "no storage" instead of silently losing bookings.
  if (process.env.VERCEL) return null;
  return fileStore(dataDir);
}
