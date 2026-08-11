import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { getLanguage } from '../config/languages.js';

/**
 * Post-test AI review (§7).
 *
 * This is explanatory feedback ONLY. It never sees or influences a score —
 * grading is decided entirely by the test-case comparison in grader.js
 * (non-negotiable #3). It is also never reachable while an attempt is still in
 * progress; the route enforces that before calling in here.
 */

let client = null;
function getClient() {
  if (!env.anthropicApiKey) return null;
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

export const isAiReviewConfigured = () => Boolean(env.anthropicApiKey);

const SYSTEM_PROMPT = `You are a patient programming tutor reviewing a student's exam submission after the exam has finished.

Write for a college student who is learning. Your goals, in order:
1. Explain concretely where their code went wrong — point at the actual logic, not vague advice.
2. State the time and space complexity of what they wrote.
3. Describe a cleaner or more efficient approach.

Rules:
- Never state, guess at, or dispute the student's marks. Scoring is not your job and the score shown to them is final unless their teacher changes it.
- If the code is fully correct, say so plainly and focus on complexity and style.
- Be direct and encouraging. No flattery, no scolding.
- Refer to the failing cases you are given by their number. You are shown whether each hidden case passed, but never its input or expected output — do not speculate about or try to reconstruct hidden test data.
- Keep it under 400 words. Use short markdown sections: **What went wrong**, **Complexity**, **A better approach**. Include a small code sketch only if it clarifies the approach.`;

function buildPrompt({ question, submission }) {
  const language = getLanguage(submission.language);

  const caseSummary = submission.results
    .map((r) => {
      const label = r.isSample ? `Sample case ${r.index + 1}` : `Hidden case ${r.index + 1}`;
      return `- ${label}: ${r.passed ? 'passed' : `FAILED (${r.verdict})`}`;
    })
    .join('\n');

  // Compile/runtime errors are the single most useful signal, so surface them.
  const firstFailure = submission.results.find((r) => !r.passed);
  const errorContext = firstFailure
    ? [
        firstFailure.compileOutput && `Compiler output:\n${firstFailure.compileOutput}`,
        firstFailure.stderr && `Runtime stderr:\n${firstFailure.stderr}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    : '';

  return `## Problem
${question.title}

${question.statement}

${question.constraints ? `Constraints:\n${question.constraints}` : ''}

## The student's submission
Language: ${language?.label || submission.language}
Overall verdict: ${submission.verdict}
Cases passed: ${submission.passedCount} of ${submission.totalCount}

\`\`\`${language?.monaco || ''}
${submission.code}
\`\`\`

## Per-case outcome
${caseSummary}
${errorContext ? `\n## Error output\n${errorContext}` : ''}

Review this submission for the student.`;
}

/**
 * @returns {Promise<{ok: boolean, content?: string, model?: string, error?: string}>}
 */
export async function generateReview({ question, submission }) {
  const anthropic = getClient();
  if (!anthropic) {
    return { ok: false, error: 'AI review is not configured on this server' };
  }

  try {
    const message = await anthropic.messages.create({
      model: env.aiReviewModel,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: buildPrompt({ question, submission }) }],
    });

    if (message.stop_reason === 'refusal') {
      return { ok: false, error: 'The model declined to review this submission' };
    }

    const content = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!content) return { ok: false, error: 'The model returned an empty review' };

    return { ok: true, content, model: message.model };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'The review service is busy — try again in a moment' };
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'The AI review API key is invalid' };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: 'Could not reach the review service' };
    }
    console.error('[aiReview] failed', err);
    return { ok: false, error: 'The review could not be generated' };
  }
}
