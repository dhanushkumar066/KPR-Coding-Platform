/**
 * What one autosave call is allowed to change on a draft.
 *
 * This exists as a pure function, rather than inline in the route, because of
 * one property that is worth a test: **marking a question for review must never
 * disturb the answer saved against it.** GATE candidates believe marking
 * forfeits their answer; here it demonstrably cannot, and a regression would
 * silently wipe work mid-exam rather than fail loudly.
 *
 * The rules:
 *   - Navigation state (`markedForReview`, `visited`) is applied whenever it is
 *     sent, independently of the answer.
 *   - The answer is only touched when this call actually carried one. A call
 *     that sends nothing but `markedForReview: true` leaves the answer alone.
 *   - An explicit empty answer ('' for NAT, [] for MCQ) IS an answer — that is
 *     "Clear response", and it must be able to clear.
 */
export function buildDraftPatch(input, now = new Date()) {
  const { language = '', code = '', selectedOptions, natAnswer, markedForReview, visited } = input;

  const navPatch = {
    ...(markedForReview !== undefined ? { markedForReview } : {}),
    ...(visited !== undefined ? { visited } : {}),
  };

  // `code` has no undefined/absent distinction (zod defaults it to ''), so an
  // empty string cannot be told apart from "not sent". Clearing code is done by
  // saving empty code alongside a language, which the editor always does.
  const answeredThisCall =
    natAnswer !== undefined || selectedOptions !== undefined || Boolean(code);

  const answerPatch = answeredThisCall
    ? natAnswer !== undefined
      ? { natAnswer }
      : selectedOptions
        ? { selectedOptions }
        : { language, code }
    : {};

  return { ...navPatch, ...answerPatch, updatedAt: now };
}

/**
 * The five states GATE's palette shows. Kept here so the server and the client
 * cannot drift apart on what "answered" means — the client mirrors this in
 * client/src/pages/exam/QuestionPalette.jsx.
 */
export function paletteStateOf(draft = {}) {
  const answered = Boolean(
    draft.code || draft.natAnswer || (draft.selectedOptions && draft.selectedOptions.length)
  );
  const marked = Boolean(draft.markedForReview);
  if (answered && marked) return 'answeredMarked';
  if (marked) return 'marked';
  if (answered) return 'answered';
  return draft.visited ? 'notAnswered' : 'notVisited';
}
