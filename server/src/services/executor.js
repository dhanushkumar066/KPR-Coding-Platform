import { env } from '../config/env.js';
import { getLanguage } from '../config/languages.js';
import { createLimiter } from './limiter.js';
import * as judge0 from './judge0.js';
import * as local from './localExecutor.js';

/**
 * Every execution goes through one bounded queue, so a whole class submitting
 * at once becomes a steady stream into the judge rather than a stampede.
 *
 * The dev executor spawns real host processes, so its ceiling is much lower —
 * 500 concurrent compilers would take the machine down.
 */
const limiter = createLimiter({
  max: env.executor === 'judge0' ? env.judge0MaxConcurrent : env.localMaxConcurrent,
  name: 'execution',
});

export const executionStats = () => limiter.stats();

/**
 * The single door through which student code is executed. Routes to the real
 * sandbox (Judge0) or, in development only, to the host fallback. Nothing else
 * in the codebase spawns a process or calls Judge0 directly.
 */

export const usingSandbox = () => env.executor === 'judge0';

export async function executorHealth() {
  const health = usingSandbox() ? await judge0.healthCheck() : await local.healthCheck();
  return { executor: env.executor, sandboxed: usingSandbox(), ...health };
}

/**
 * @param {object} params
 * @param {string} params.languageKey
 * @param {string} params.sourceCode
 * @param {string[]} params.stdins
 * @param {number} params.timeLimitSec
 * @param {number} params.memoryLimitMb
 */
export async function runBatch({ languageKey, sourceCode, stdins, timeLimitSec, memoryLimitMb }) {
  const language = getLanguage(languageKey);
  if (!language) throw new Error(`Unsupported language: ${languageKey}`);

  return limiter.run(() => {
    if (usingSandbox()) {
      return judge0.runBatch({
        languageId: language.judge0Id,
        sourceCode,
        stdins,
        cpuTimeLimitSec: timeLimitSec,
        memoryLimitKb: Math.round(memoryLimitMb * 1024),
      });
    }

    return local.runBatch({
      language,
      sourceCode,
      stdins,
      cpuTimeLimitSec: timeLimitSec,
    });
  });
}
