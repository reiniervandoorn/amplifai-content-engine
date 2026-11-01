// Storage. The engine only uses these five calls, so a database can replace the file store by
// implementing the same interface (e.g. one table: collection, id, json).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class FileStore {
  constructor(dir) { this.dir = dir; this.queues = new Map() }
  #file(col, id) {
    if (!/^[a-z0-9_-]+$/i.test(col)) throw new Error('bad collection');
    return path.join(this.dir, col, encodeURIComponent(id) + '.json');
  }
  async get(col, id) {
    try { return JSON.parse(await fs.readFile(this.#file(col, id), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }
  // Writes to the same file wait for each other; each uses its own temporary file and an atomic rename,
  // so a reader never sees half a file and parallel jobs never collide.
  put(col, id, value) {
    const f = this.#file(col, id);
    const run = (this.queues.get(f) || Promise.resolve()).catch(() => { }).then(async () => {
      const tmp = `${f}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(value, null, 1));
      await fs.rename(tmp, f);
      return value;
    });
    this.queues.set(f, run);
    run.finally(() => { if (this.queues.get(f) === run) this.queues.delete(f) }).catch(() => { });
    return run;
  }
  async del(col, id) { await fs.rm(this.#file(col, id), { force: true }) }
  async list(col, prefix = '') {
    let names;
    try { names = await fs.readdir(path.join(this.dir, col)) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    const ids = names.filter(n => n.endsWith('.json')).map(n => decodeURIComponent(n.slice(0, -5))).filter(id => id.startsWith(prefix));
    return (await Promise.all(ids.map(id => this.get(col, id)))).filter(Boolean);
  }
}
