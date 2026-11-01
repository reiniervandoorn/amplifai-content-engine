// Research and writing take minutes, so every request runs as a job: start one, then wait for it, poll it,
// or get a callback. A queue keeps at most `concurrency` jobs talking to Claude at once.
import crypto from 'node:crypto';

export class Jobs {
  constructor({ concurrency = 2, onChange = () => { } } = {}) {
    this.all = new Map(); this.done = new Map(); this.resolve = new Map(); this.queue = []; this.running = 0; this.concurrency = concurrency; this.onChange = onChange;
  }

  start(fields, fn) {
    const job = { id: 'job_' + crypto.randomBytes(9).toString('base64url'), ...fields, status: 'queued', progress: [],
      createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, error: null, result: null };
    this.all.set(job.id, job);
    this.done.set(job.id, new Promise(r => this.resolve.set(job.id, r)));
    this.queue.push({ job, fn });
    this.onChange(job);
    this.#pump();
    return job;
  }

  // cancel everything still waiting; jobs already running stop at their next call to Claude (see app.js)
  cancelAll() {
    const n = this.queue.length;
    for (const { job } of this.queue) this.#finish(job, 'cancelled', 'Geannuleerd: noodstop');
    this.queue = [];
    return { cancelled: n, stillRunning: this.running };
  }

  get(id) { return this.all.get(id) || null }
  // resolves when the job is finished, or after ms, whichever comes first
  wait(id, ms) { return Promise.race([this.done.get(id), new Promise(r => setTimeout(r, ms).unref?.())]) }
  forget(id) { this.all.delete(id); this.done.delete(id); this.resolve.delete(id) }

  #finish(job, status, error, result = null) {
    Object.assign(job, { status, error, result, finishedAt: new Date().toISOString() });
    if (job.code === undefined) delete job.code;
    this.onChange(job);
    this.resolve.get(job.id)?.();
    // the stored copy (see app.js) answers later reads; keep memory small
    setTimeout(() => this.forget(job.id), 10 * 60e3).unref?.();
  }

  #pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const { job, fn } = this.queue.shift();
      this.running++;
      job.status = 'working'; job.startedAt = new Date().toISOString();
      this.onChange(job);
      const say = msg => { job.progress.push({ at: new Date().toISOString(), msg }); if (job.progress.length > 50) job.progress.shift() };
      fn(say)
        .then(result => this.#finish(job, 'done', null, result))
        .catch(e => { if (e?.code) job.code = e.code; this.#finish(job, 'failed', e?.message || String(e)) })
        .finally(() => { this.running--; this.#pump() });
    }
  }
}
