// Research and writing take minutes, so they run as jobs: start one, then poll it or get a webhook.
// Jobs live in memory; a restart forgets running jobs (the product keeps whatever was saved).
import crypto from 'node:crypto';

export class Jobs {
  constructor({ concurrency = 2 } = {}) { this.all = new Map(); this.queue = []; this.running = 0; this.concurrency = concurrency }

  // One job per product at a time: two writers on the same guide would overwrite each other.
  busy(accountId, productId) {
    for (const j of this.all.values()) if (j.accountId === accountId && j.productId === productId && (j.status === 'queued' || j.status === 'running')) return j;
    return null;
  }

  start({ type, accountId, productId, webhook }, fn) {
    const job = { id: 'job_' + crypto.randomBytes(9).toString('base64url'), type, accountId, productId, status: 'queued', progress: [],
      createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, error: null };
    this.all.set(job.id, job);
    this.queue.push({ job, fn, webhook });
    this.#pump();
    this.#prune();
    return job;
  }

  // cancel everything still waiting for one shop (or for all shops); jobs already running are finished
  cancel(accountId) {
    let n = 0;
    this.queue = this.queue.filter(({ job }) => {
      if (accountId && job.accountId !== accountId) return true;
      job.status = 'cancelled'; job.finishedAt = new Date().toISOString(); n++;
      return false;
    });
    return { cancelled: n, stillRunning: [...this.all.values()].filter(j => (!accountId || j.accountId === accountId) && j.status === 'running').length };
  }

  get(id) { return this.all.get(id) || null }
  list(accountId) { return [...this.all.values()].filter(j => !accountId || j.accountId === accountId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) }

  #pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const { job, fn, webhook } = this.queue.shift();
      this.running++;
      job.status = 'running'; job.startedAt = new Date().toISOString();
      const say = msg => { job.progress.push({ at: new Date().toISOString(), msg }); if (job.progress.length > 50) job.progress.shift() };
      fn(say)
        .then(() => { job.status = 'done' })
        .catch(e => { job.status = 'failed'; job.error = e?.message || String(e) })
        .finally(() => {
          job.finishedAt = new Date().toISOString();
          this.running--;
          if (webhook?.url) deliver(webhook, job);
          this.#pump();
        });
    }
  }
  #prune() { // keep the last 500 finished jobs
    const done = [...this.all.values()].filter(j => j.finishedAt).sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
    for (const j of done.slice(0, Math.max(0, done.length - 500))) this.all.delete(j.id);
  }
}

// POST the finished job to the shop's webhook, signed so the receiver can check it came from us.
async function deliver({ url, secret }, job) {
  const body = JSON.stringify({ event: `job.${job.status}`, job });
  const sig = crypto.createHmac('sha256', secret || '').update(body).digest('hex');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-amplifai-signature': 'sha256=' + sig }, body, signal: AbortSignal.timeout(10000) });
      if (r.ok) return;
    } catch { }
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
}
