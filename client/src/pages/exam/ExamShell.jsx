import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatScore } from '../../lib/format.js';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatClock } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAntiCheat } from '../../hooks/useAntiCheat.js';
import { useCountdown } from '../../hooks/useCountdown.js';
import CodeEditor from '../../components/CodeEditor.jsx';
import { PageLoader, Spinner } from '../../components/ui.jsx';
import ProblemPane from './ProblemPane.jsx';
import ResultPane from './ResultPane.jsx';
import ExamGate from './ExamGate.jsx';
import ExamEnded from './ExamEnded.jsx';
import ProfileGate from '../../components/ProfileGate.jsx';
import FullscreenCountdown from './FullscreenCountdown.jsx';
import McqPanel from './McqPanel.jsx';
import NatPanel from './NatPanel.jsx';
import QuestionPalette, { paletteState, PALETTE_STATES } from './QuestionPalette.jsx';
import Logo from '../../components/Logo.jsx';

const HEARTBEAT_MS = 10_000;
const AUTOSAVE_MS = 2500;

// Grading is queued, so the result is polled for. Backs off as it waits: under a
// full-class rush a submission can sit in the queue for a while, and 500 clients
// polling hard would add load exactly when there is least to spare.
const POLL_START_MS = 400;
const POLL_MAX_MS = 2500;
const POLL_GIVE_UP_MS = 180_000;

async function pollForResult(submissionId) {
  const deadline = Date.now() + POLL_GIVE_UP_MS;
  let wait = POLL_START_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    wait = Math.min(Math.round(wait * 1.4), POLL_MAX_MS);

    try {
      const res = await api.get(`/exam/submissions/${submissionId}/result`);
      if (res.status !== 'pending') return res.result;
    } catch (err) {
      // The submission is already saved and queued server-side, so a network
      // blip while waiting is no reason to abandon it — keep asking. A real
      // HTTP error (the attempt was terminated, say) still surfaces.
      if (err.status !== 0) throw err;
    }
  }
  throw new Error('Still grading — your submission is saved and will be scored shortly');
}

/**
 * A random id.
 *
 * crypto.randomUUID exists only in a secure context, and a college commonly
 * serves this over plain HTTP on a LAN address — where it is undefined. Falling
 * back keeps the exam working there rather than throwing at the worst moment.
 */
function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Idempotency key for one press of Run or Submit. If the connection drops and
 * we resend, the server recognises the token and hands back the submission it
 * already made instead of filing the answer twice.
 */
const newClientToken = randomId;

/** One session id per browser tab, kept across reloads so refreshing resumes. */
function getSessionId(testId) {
  const key = `exam-session:${testId}`;
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = randomId();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export default function ExamShell() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const sessionId = useMemo(() => getSessionId(testId), [testId]);

  const [phase, setPhase] = useState('loading'); // loading | gate | active | ended | error
  const [error, setError] = useState(null);
  const [test, setTest] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [attempt, setAttempt] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const [editorState, setEditorState] = useState({}); // questionId -> {language, code}
  const [results, setResults] = useState({}); // questionId -> latest result
  const [attempted, setAttempted] = useState({}); // questionId -> true once submitted

  // "Run with my own input", the way LeetCode lets you edit the testcase. Run
  // only — Submit is always graded against the real cases.
  const [useCustomInput, setUseCustomInput] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const [busy, setBusy] = useState(null); // 'run' | 'submit' | 'finish'
  const [savedAt, setSavedAt] = useState(null);
  const [warnings, setWarnings] = useState(0);
  const [banner, setBanner] = useState(null);
  const [endInfo, setEndInfo] = useState(null);
  const [remainingMs, setRemainingMs] = useState(null);
  const [splitPct, setSplitPct] = useState(44);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const msLeft = useCountdown(remainingMs);
  const activeQuestion = questions[activeIdx];
  const activeState = activeQuestion ? editorState[activeQuestion.id] : null;

  const dirtyRef = useRef(new Set());
  const endedRef = useRef(false);

  // ---------------------------------------------------------------- load ----
  const load = useCallback(async () => {
    try {
      // Starting resumes an existing attempt rather than creating a second one,
      // so this is safe to repeat if the connection drops in the opening rush.
      const data = await api.post(`/exam/tests/${testId}/start`, { sessionId }, { retry: 5 });

      setTest(data.test);
      setQuestions(data.questions);
      setAttempt(data.attempt);
      setWarnings(data.attempt.warnings);
      setRemainingMs(data.attempt.timeRemainingMs);

      // Seed each editor from the auto-saved draft, else the starter stub.
      const seeded = {};
      for (const q of data.questions) {
        const draft = data.drafts[q.id];

        if (q.kind === 'mcq') {
          seeded[q.id] = {
            selectedOptions: draft?.selectedOptions ?? [],
            markedForReview: Boolean(draft?.markedForReview),
            visited: Boolean(draft?.visited),
          };
          continue;
        }

        if (q.kind === 'nat') {
          seeded[q.id] = {
            natAnswer: draft?.natAnswer ?? '',
            markedForReview: Boolean(draft?.markedForReview),
            visited: Boolean(draft?.visited),
          };
          continue;
        }

        const language =
          draft?.language && data.test.allowedLanguages.includes(draft.language)
            ? draft.language
            : data.test.allowedLanguages[0];
        seeded[q.id] = {
          language,
          code: draft?.code ?? q.starterCode?.[language] ?? '',
          // One buffer per language, like LeetCode: switching away and back
          // returns the student to what they had written there. Only the active
          // language is autosaved, so this lives for the tab's lifetime.
          buffers: {},
          markedForReview: Boolean(draft?.markedForReview),
          visited: Boolean(draft?.visited),
        };
      }
      setEditorState(seeded);
      setPhase('gate');
    } catch (err) {
      if (err.status === 409 && err.details?.status) {
        setEndInfo({ status: err.details.status });
        setPhase('ended');
        return;
      }
      // The server will not start an attempt for an unnamed student.
      if (err.status === 428 || err.details?.reason === 'profile_incomplete') {
        setPhase('profile');
        return;
      }
      setError(err);
      setPhase('error');
    }
  }, [testId, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // ------------------------------------------------------------ finishing ---
  const handleEnded = useCallback(
    (info) => {
      if (endedRef.current) return;
      endedRef.current = true;
      setEndInfo(info);
      setPhase('ended');
      document.exitFullscreen?.().catch(() => {});
    },
    []
  );

  // ---------------------------------------------------------- anti-cheat ----
  const reportViolation = useCallback(
    async ({ type, durationMs, meta }) => {
      try {
        const res = await api.post(`/exam/tests/${testId}/violation`, { type, durationMs, meta });
        setWarnings(res.warnings);
        return res;
      } catch (err) {
        // A locked attempt means the server already terminated us.
        if (err.status === 423) handleEnded({ status: 'terminated', message: err.message });
        return null;
      }
    },
    [testId, handleEnded]
  );

  const antiCheat = useAntiCheat({
    enabled: phase === 'active',
    graceMs: test?.graceMs ?? 2500,
    onReport: reportViolation,
    onTerminated: (res) => handleEnded({ status: 'terminated', message: res.message }),
  });

  // Surface every detected event immediately — fairness and deterrence (§9).
  useEffect(() => {
    const evt = antiCheat.lastEvent;
    if (!evt || phase !== 'active') return;

    const LABELS = {
      tab_switch: 'You switched away from the exam tab',
      window_blur: 'You left the exam window',
      fullscreen_exit: 'You exited fullscreen',
      large_paste: 'A large block of code was pasted into the editor',
      paste: 'Paste detected',
      copy: 'Copying is disabled during the exam',
      context_menu: 'Right-click is disabled during the exam',
      screen_overlay: 'Something was drawn over the exam window',
      focus_lost_silently: 'Another window took focus',
    };

    // Not misconduct — no banner, nothing for the student to act on.
    if (evt.type === 'second_screen') return;

    setBanner({
      id: evt.at,
      pending: evt.pending,
      counted: evt.counted,
      reason: evt.reason,
      text: LABELS[evt.type] || 'Exam rule violation detected',
      warnings: evt.warnings ?? warnings,
      limit: evt.limit ?? test?.warningLimit ?? 3,
    });

    const timer = setTimeout(() => setBanner((b) => (b?.id === evt.at ? null : b)), 7000);
    return () => clearTimeout(timer);
  }, [antiCheat.lastEvent, phase, warnings, test?.warningLimit]);

  // ----------------------------------------------------------- heartbeat ----
  useEffect(() => {
    if (phase !== 'active') return undefined;

    const beat = async () => {
      try {
        const res = await api.post(`/exam/tests/${testId}/heartbeat`, { sessionId });
        setRemainingMs(res.timeRemainingMs);
        setWarnings(res.warnings);
        if (res.status !== 'in_progress') {
          handleEnded({ status: res.status, message: res.reason });
        }
      } catch (err) {
        if (err.status === 423 || err.status === 409) {
          handleEnded({ status: 'terminated', message: err.message });
        }
        // A transient network failure is NOT a violation — just keep going (§9).
      }
    };

    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [phase, testId, sessionId, handleEnded]);

  // ------------------------------------------------------------ autosave ----
  useEffect(() => {
    if (phase !== 'active') return undefined;

    const id = setInterval(async () => {
      const pending = [...dirtyRef.current];
      if (!pending.length) return;
      dirtyRef.current.clear();

      for (const questionId of pending) {
        const state = editorState[questionId];
        if (!state) continue;
        try {
          const res = await api.post(`/exam/tests/${testId}/autosave`, {
            questionId,
            // MCQ selections, NAT answers and navigation state all travel the
            // same path as code drafts.
              markedForReview: Boolean(state.markedForReview),
              visited: Boolean(state.visited),
            ...(state.natAnswer !== undefined
              ? { natAnswer: state.natAnswer }
              : state.selectedOptions
              ? { selectedOptions: state.selectedOptions }
              : { language: state.language, code: state.code }),
          });
          setSavedAt(res.savedAt);
        } catch {
          dirtyRef.current.add(questionId); // retry on the next tick
        }
      }
    }, AUTOSAVE_MS);

    return () => clearInterval(id);
  }, [phase, testId, editorState]);

  // Moving to another question starts its custom input from that question's
  // first sample, so the box is never blank and the expected shape is obvious.
  useEffect(() => {
    if (!activeQuestion || activeQuestion.kind !== 'coding') return;
    setUseCustomInput(false);
    setCustomInput(activeQuestion.samples?.[0]?.input ?? '');
  }, [activeQuestion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Whether a question counts as answered, per kind.
   *
   * A coding question is answered once code has been submitted — not merely
   * typed — because unsubmitted code scores nothing and showing it as answered
   * would be a lie a student only discovers at the end.
   */
  const isAnswered = useCallback(
    (question) => {
      const state = editorState[question.id];
      if (!state) return false;
      if (question.kind === 'mcq') return (state.selectedOptions?.length ?? 0) > 0;
      if (question.kind === 'nat') return String(state.natAnswer ?? '').trim().length > 0;
      return Boolean(attempted[question.id]);
    },
    [editorState, attempted]
  );

  const stateOf = useCallback(
    (question) =>
      paletteState({
        visited: Boolean(editorState[question.id]?.visited),
        answered: isAnswered(question),
        marked: Boolean(editorState[question.id]?.markedForReview),
      }),
    [editorState, isAnswered]
  );

  // Opening a question is what moves it out of "Not visited".
  useEffect(() => {
    if (phase !== 'active' || !activeQuestion) return;
    if (editorState[activeQuestion.id]?.visited) return;
    setEditorState((prev) => ({
      ...prev,
      [activeQuestion.id]: { ...prev[activeQuestion.id], visited: true },
    }));
    dirtyRef.current.add(activeQuestion.id);
  }, [phase, activeQuestion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMarked = useCallback(() => {
    if (!activeQuestion) return;
    setEditorState((prev) => ({
      ...prev,
      [activeQuestion.id]: {
        ...prev[activeQuestion.id],
        markedForReview: !prev[activeQuestion.id]?.markedForReview,
      },
    }));
    dirtyRef.current.add(activeQuestion.id);
  }, [activeQuestion]);

  /** GATE's "Clear Response" — empties the answer without leaving the question. */
  const clearResponse = useCallback(() => {
    if (!activeQuestion) return;
    setEditorState((prev) => {
      const state = prev[activeQuestion.id] || {};
      const cleared =
        activeQuestion.kind === 'mcq'
          ? { selectedOptions: [] }
          : activeQuestion.kind === 'nat'
            ? { natAnswer: '' }
            : { code: activeQuestion.starterCode?.[state.language] ?? '' };
      return { ...prev, [activeQuestion.id]: { ...state, ...cleared } };
    });
    dirtyRef.current.add(activeQuestion.id);
    toast.info('Response cleared');
  }, [activeQuestion, toast]);

  const goNext = useCallback(() => {
    setActiveIdx((i) => Math.min(i + 1, questions.length - 1));
  }, [questions.length]);

  const updateEditor = useCallback((questionId, patch) => {
    setEditorState((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));
    dirtyRef.current.add(questionId);
  }, []);

  /**
   * Switches language, parking the current buffer under its own language and
   * restoring whatever was there before — or that language's starter stub the
   * first time it is opened.
   */
  const switchLanguage = useCallback(
    (question, nextLanguage) => {
      setEditorState((prev) => {
        const state = prev[question.id];
        if (!state || state.language === nextLanguage) return prev;

        const buffers = { ...(state.buffers || {}), [state.language]: state.code };
        const stub = question.starterCode?.[nextLanguage] ?? '';

        return {
          ...prev,
          [question.id]: {
            ...state,
            language: nextLanguage,
            code: buffers[nextLanguage] ?? stub,
            buffers,
          },
        };
      });
      dirtyRef.current.add(question.id);
    },
    []
  );

  /** "Reset to template" — the escape hatch when a stub has been mangled. */
  const resetToTemplate = useCallback(
    (question, language) => {
      const stub = question.starterCode?.[language] ?? '';
      if (!stub) {
        toast.warn('This question has no template to reset to');
        return;
      }
      updateEditor(question.id, { code: stub });
      toast.info(`Reset to the ${language} template`);
    },
    [toast, updateEditor]
  );

  // -------------------------------------------------------- run / submit ----
  const execute = useCallback(
    async (kind) => {
      if (!activeQuestion || !activeState) return;
      if (!activeState.code.trim()) {
        toast.warn('Write some code first');
        return;
      }

      setBusy(kind);
      try {
        // The server persists and queues, then returns immediately, so the
        // result is collected by polling. That is what lets a whole class
        // submit at once without every request hanging on the judge.
        //
        // The token makes this one press of the button, however many times the
        // network makes us send it: a retry after a dropped connection returns
        // the original submission rather than filing a second answer.
        const queued = await api.post(
          `/exam/tests/${testId}/${kind}`,
          {
            questionId: activeQuestion.id,
            language: activeState.language,
            code: activeState.code,
            clientToken: newClientToken(),
            // Only Run honours a custom input; Submit is always the real cases.
            ...(kind === 'run' && useCustomInput && customInput.trim()
              ? { customInput }
              : {}),
          },
          { retry: 5 }
        );

        const result = await pollForResult(queued.submissionId);
        setResults((prev) => ({ ...prev, [activeQuestion.id]: result }));

        if (kind === 'submit') {
          setAttempted((prev) => ({ ...prev, [activeQuestion.id]: true }));
          if (result.verdict === 'Accepted') {
            toast.success(`Accepted — ${formatScore(result.score)} / ${result.maxScore}`);
          } else if (result.status === 'error') {
            toast.error(`The judge could not run this: ${result.error}`);
          } else {
            toast.warn(`${result.verdict} — ${result.passedCount}/${result.totalCount} cases passed`);
          }
        }
      } catch (err) {
        if (err.status === 423) handleEnded({ status: 'terminated', message: err.message });
        else if (err.status === 409) handleEnded({ status: 'auto_submitted', message: err.message });
        else toast.error(err.message);
      } finally {
        setBusy(null);
      }
    },
    [activeQuestion, activeState, testId, toast, handleEnded, useCustomInput, customInput]
  );

  const finish = useCallback(async () => {
    setBusy('finish');
    try {
      // Flush anything still unsaved so nothing is lost.
      for (const questionId of [...dirtyRef.current]) {
        const state = editorState[questionId];
        if (state) {
          await api
            .post(`/exam/tests/${testId}/autosave`, {
              questionId,
                markedForReview: Boolean(state.markedForReview),
                visited: Boolean(state.visited),
              ...(state.natAnswer !== undefined
                ? { natAnswer: state.natAnswer }
                : state.selectedOptions
                ? { selectedOptions: state.selectedOptions }
                : { language: state.language, code: state.code }),
            })
            .catch(() => {});
        }
      }
      dirtyRef.current.clear();

      // Finishing is idempotent server-side (a finished attempt stays
      // finished), so it is safe to insist until it lands.
      const res = await api.post(`/exam/tests/${testId}/finish`, undefined, { retry: 3 });
      handleEnded({ status: 'submitted', score: res.score, maxScore: res.maxScore });
    } catch (err) {
      toast.error(err.message);
      setBusy(null);
    }
  }, [testId, editorState, toast, handleEnded]);

  // -------------------------------------------------------------- render ----
  if (phase === 'loading') return <PageLoader label="Opening your test…" />;

  if (phase === 'profile') {
    return (
      <ProfileGate
        onDone={() => {
          setPhase('loading');
          load();
        }}
        onCancel={() => navigate('/tests')}
      />
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card max-w-md px-6 py-8 text-center">
          <h1 className="text-lg font-bold">Cannot open this test</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{error?.message}</p>
          <button className="btn btn-primary mt-4" onClick={() => navigate('/tests')}>
            Back to my tests
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'gate') {
    return (
      <ExamGate
        test={test}
        questionCount={questions.length}
        remainingMs={msLeft}
        warnings={warnings}
        onBegin={async () => {
          await antiCheat.requestFullscreen();
          setPhase('active');
        }}
        onCancel={() => navigate('/tests')}
      />
    );
  }

  if (phase === 'ended') {
    return <ExamEnded testId={testId} info={endInfo} onExit={() => navigate('/results')} />;
  }

  const lowTime = msLeft > 0 && msLeft < 5 * 60_000;

  const fullscreenDeadlineSec = test.fullscreenGraceSec ?? 0;

  return (
    <div className="exam-locked flex h-screen flex-col overflow-hidden bg-[var(--surface-2)]">
      {fullscreenDeadlineSec > 0 && (
        <FullscreenCountdown
          lostAt={antiCheat.fullscreenLostAt}
          deadlineSec={fullscreenDeadlineSec}
          onReturn={antiCheat.requestFullscreen}
        />
      )}

      {/* ----------------------------------------------------------- chrome */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-[var(--surface)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo size={24} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight tracking-tight">{test.title}</p>
            <p className="truncate text-[0.7rem] text-[var(--text-faint)]">{user?.email}</p>
          </div>
        </div>

        {/* Question navigator with an answered indicator */}
        <nav
          className="flex items-center gap-1.5 rounded-lg border bg-[var(--surface-2)] p-1"
          aria-label="Questions"
        >
          {questions.map((q, i) => {
            // Same five states as the palette, so the bar and the panel can
            // never disagree about what a question's colour means.
            const st = stateOf(q);
            const swatch = PALETTE_STATES[st];
            const isActive = i === activeIdx;
            return (
              <button
                key={q.id}
                onClick={() => setActiveIdx(i)}
                title={`${i + 1}. ${q.title} — ${swatch.label}`}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`Question ${i + 1}, ${swatch.label}`}
                className="relative grid h-7 w-7 place-items-center text-xs font-bold transition-transform duration-150 hover:scale-110"
                style={{
                  background: swatch.bg,
                  color: swatch.fg,
                  border: `1px solid ${swatch.border}`,
                  borderRadius: swatch.radius,
                  outline: isActive ? '2px solid var(--text)' : 'none',
                  outlineOffset: '2px',
                }}
              >
                {i + 1}
                {swatch.tick && (
                  <span
                    className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full"
                    style={{ background: '#1e8449', border: '1.5px solid var(--surface)' }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          {savedAt && (
            <span className="hidden items-center gap-1.5 text-[0.7rem] text-[var(--text-faint)] lg:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
              Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}

          <span
            className="badge"
            style={{
              background: warnings > 0 ? 'var(--warn-bg)' : 'var(--surface-3)',
              color: warnings > 0 ? 'var(--warn)' : 'var(--text-muted)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 5.5v3.2m0 2.3h.01M7 2.4 1.7 11.4a1.4 1.4 0 0 0 1.2 2.1h10.2a1.4 1.4 0 0 0 1.2-2.1L9 2.4a1.2 1.2 0 0 0-2 0Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Warnings {warnings} of {test.warningLimit}
          </span>

          {!antiCheat.isFullscreen && (
            <button className="btn btn-ghost btn-sm" onClick={antiCheat.requestFullscreen}>
              Re-enter fullscreen
            </button>
          )}

          {/* The single most important element on this screen. */}
          <span
            className={`mono flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-base font-bold tabular-nums transition-colors ${
              lowTime ? 'animate-urgent' : ''
            }`}
            style={{
              background: lowTime ? 'var(--bad-bg)' : 'var(--surface-3)',
              color: lowTime ? 'var(--bad)' : 'var(--text)',
            }}
            aria-label={`Time remaining ${formatClock(msLeft)}`}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8.6" r="5.9" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8 5.4v3.4l2.1 1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {formatClock(msLeft)}
          </span>

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPaletteOpen((v) => !v)}
            aria-pressed={paletteOpen}
            title="Show every question and its state"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Palette
          </button>

          <button
            className="btn btn-danger-solid btn-sm"
            onClick={finish}
            disabled={busy === 'finish'}
          >
            {busy === 'finish' ? 'Finishing…' : 'Finish test'}
          </button>
        </div>
      </header>

      {/* --------------------------------------------------- warning banner */}
      {banner && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2 text-sm font-medium"
          style={{
            background: banner.counted ? 'var(--bad-bg)' : 'var(--warn-bg)',
            color: banner.counted ? 'var(--bad)' : 'var(--warn)',
          }}
        >
          <span className="font-bold">
            {banner.pending
              ? banner.text
              : banner.counted
                ? `Warning ${banner.warnings} of ${banner.limit}`
                : 'Noted — no warning given'}
          </span>
          <span>{banner.text}.</span>
          {!banner.pending && banner.reason && (
            <span className="opacity-80">{banner.reason}.</span>
          )}
          {banner.counted && (
            <span className="opacity-80">
              Exceeding {banner.limit} warnings ends your attempt and submits your current work.
            </span>
          )}
        </div>
      )}

      {test.paused && (
        <div
          role="alert"
          className="shrink-0 px-4 py-2 text-center text-sm font-semibold"
          style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
        >
          Your teacher has paused this test. Your clock is stopped — wait for it to resume.
        </div>
      )}

      {/* ------------------------------------------------------- split pane */}
      <div className="flex min-h-0 flex-1">
        <section
          className="min-w-[280px] border-r bg-[var(--surface)]"
          style={{ width: `${splitPct}%` }}
        >
          <ProblemPane question={activeQuestion} index={activeIdx} total={questions.length} />
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={(e) => {
            e.preventDefault();
            const onMove = (ev) => {
              const pct = (ev.clientX / window.innerWidth) * 100;
              setSplitPct(Math.min(70, Math.max(22, pct)));
            };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
          className="w-1 shrink-0 cursor-col-resize bg-[var(--border)] transition-colors hover:bg-[var(--color-brand-500)]"
        />

        {activeQuestion?.kind === 'nat' ? (
          <section className="flex min-w-0 flex-1 flex-col bg-[var(--surface)]">
            <NatPanel
              question={activeQuestion}
              value={activeState?.natAnswer ?? ''}
              savedAt={savedAt}
              onChange={(natAnswer) => updateEditor(activeQuestion.id, { natAnswer })}
            />
          </section>
        ) : activeQuestion?.kind === 'mcq' ? (
          <section className="flex min-w-0 flex-1 flex-col bg-[var(--surface)]">
            <McqPanel
              question={activeQuestion}
              selected={activeState?.selectedOptions || []}
              savedAt={savedAt}
              onChange={(selectedOptions) =>
                updateEditor(activeQuestion.id, { selectedOptions })
              }
            />
          </section>
        ) : (
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-[var(--surface)] px-3 py-2">
            <select
              className="select w-auto py-1.5 text-xs font-semibold"
              value={activeState?.language || ''}
              onChange={(e) => switchLanguage(activeQuestion, e.target.value)}
              aria-label="Language"
            >
              {test.allowedLanguages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>

            <button
              className="btn btn-ghost btn-sm text-xs"
              title="Restore this question's starter code for the selected language"
              onClick={() => resetToTemplate(activeQuestion, activeState?.language)}
              disabled={Boolean(busy)}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8M13.5 2v3.2h-3.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Reset to template
            </button>

            <div className="ml-auto flex items-center gap-2">
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)]"
                title="Run against input you type instead of the sample cases. Submit always uses the real cases."
              >
                <input
                  type="checkbox"
                  checked={useCustomInput}
                  onChange={(e) => setUseCustomInput(e.target.checked)}
                />
                Own input
              </label>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => execute('run')}
                disabled={Boolean(busy)}
              >
                {busy === 'run' ? (
                  <Spinner label="Running…" />
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .93.5l8-5.2a.6.6 0 0 0 0-1l-8-5.2a.6.6 0 0 0-.93.5Z" />
                    </svg>
                    Run
                  </>
                )}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => execute('submit')}
                disabled={Boolean(busy)}
              >
                {busy === 'submit' ? (
                  <Spinner label="Submitting…" />
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="M14 2 7.2 8.9M14 2l-4.4 12-2.4-5.1L2 6.5 14 2Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Submit
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {activeQuestion && (
              <CodeEditor
                key={activeQuestion.id}
                language={activeState?.language || 'python'}
                value={activeState?.code ?? ''}
                onChange={(code) => updateEditor(activeQuestion.id, { code })}
                onPaste={(text) => antiCheat.reportPaste(text, { questionId: activeQuestion.id })}
              />
            )}
          </div>

          {useCustomInput && (
            <div className="shrink-0 border-t bg-[var(--surface)] px-3 py-2">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[0.68rem] font-semibold uppercase text-[var(--text-faint)]">
                  Your own input
                </p>
                <span className="text-[0.68rem] text-[var(--text-faint)]">
                  {activeQuestion?.ioMode === 'function'
                    ? `one value per line, in the order of ${
                        activeQuestion.functionSpec?.params?.map((p) => p.name).join(', ') ||
                        'the parameters'
                      }`
                    : 'exactly what your program should read from standard input'}
                </span>
                <button
                  className="ml-auto text-[0.68rem] text-[var(--text-faint)] hover:text-[var(--text)]"
                  onClick={() => setCustomInput(activeQuestion?.samples?.[0]?.input ?? '')}
                >
                  Reset to sample
                </button>
              </div>
              <textarea
                className="input mono h-16 w-full resize-y text-xs"
                spellCheck={false}
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="[2,7,11,15]&#10;9"
              />
            </div>
          )}

          <div className="h-[38%] min-h-[140px] shrink-0 border-t bg-[var(--surface)]">
            <ResultPane
              result={activeQuestion ? results[activeQuestion.id] : null}
              busy={busy === 'run' || busy === 'submit'}
              busyLabel={busy === 'run' ? 'Running your code…' : 'Grading every case…'}
              samples={activeQuestion?.samples?.length}
              // So a failed sample can show what it was given and what was
              // wanted, next to what the student actually produced.
              sampleCases={activeQuestion?.samples}
            />
          </div>
        </section>
        )}

        {paletteOpen && (
          <QuestionPalette
            questions={questions}
            stateOf={stateOf}
            activeIdx={activeIdx}
            onJump={(i) => setActiveIdx(i)}
            onClose={() => setPaletteOpen(false)}
          />
        )}
      </div>

      {/* GATE's action row. "Save & Next" is the button candidates reach for
          without thinking, so it exists even though everything autosaves. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-[var(--surface)] px-4 py-2.5">
        <button className="btn btn-ghost btn-sm" onClick={clearResponse} disabled={Boolean(busy)}>
          Clear response
        </button>

        <button
          className="btn btn-sm"
          onClick={toggleMarked}
          disabled={Boolean(busy)}
          style={
            activeState?.markedForReview
              ? { background: '#6c3fa8', color: '#fff', borderColor: '#54308a' }
              : { background: 'transparent', color: '#6c3fa8', borderColor: '#6c3fa8' }
          }
        >
          {activeState?.markedForReview ? 'Unmark' : 'Mark for review'}
        </button>

        <span className="ml-auto flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
            disabled={activeIdx === 0}
          >
            Previous
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (activeQuestion) dirtyRef.current.add(activeQuestion.id);
              goNext();
            }}
            disabled={activeIdx >= questions.length - 1}
          >
            Save &amp; next
          </button>
        </span>
      </div>
    </div>
  );
}
