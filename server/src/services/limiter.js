/**
 * A bounded in-process work queue.
 *
 * When a class of 500 submits at once, firing 500 parallel batches at Judge0
 * does not make it grade faster — it just exhausts its workers and every one of
 * our poll loops times out, turning correct answers into "Judge Error". This
 * caps how many are in flight and queues the rest, so throughput is the judge's
 * real capacity rather than a thundering herd.
 *
 * Deliberately not BullMQ/Redis: the master prompt says to reach for a job queue
 * only when scaling genuinely demands it, and a single Node process fronting
 * Judge0 does not.
 */
export function createLimiter({ max, name = 'work' }) {
  let active = 0;
  let peakActive = 0;
  let peakQueued = 0;
  let completed = 0;
  let rejected = 0;
  const queue = [];

  const pump = () => {
    while (active < max && queue.length) {
      const job = queue.shift();
      active += 1;
      peakActive = Math.max(peakActive, active);

      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          completed += 1;
          pump();
        });
    }
  };

  /**
   * @param {() => Promise<any>} fn
   * @param {{maxQueue?: number}} [opts] refuse rather than grow without bound
   */
  function run(fn, opts = {}) {
    const maxQueue = opts.maxQueue ?? Infinity;
    if (queue.length >= maxQueue) {
      rejected += 1;
      return Promise.reject(
        new Error(`The ${name} queue is full (${queue.length} waiting) — try again shortly`)
      );
    }
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      peakQueued = Math.max(peakQueued, queue.length);
      pump();
    });
  }

  const stats = () => ({
    name,
    max,
    active,
    queued: queue.length,
    peakActive,
    peakQueued,
    completed,
    rejected,
  });

  return { run, stats };
}
