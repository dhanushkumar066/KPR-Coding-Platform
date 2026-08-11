import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import CodeEditor from '../../components/CodeEditor.jsx';
import ProblemPane from '../exam/ProblemPane.jsx';
import McqEditor from './McqEditor.jsx';
import NatEditor from './NatEditor.jsx';
import { ErrorState, PageHeader, PageLoader, Spinner, VerdictBadge } from '../../components/ui.jsx';

/** Trailing blank lines are harmless, so they don't count as an argument. */
const countArgLines = (testCase) =>
  String(testCase.input ?? '').replace(/\n+$/, '').split('\n').length;

/**
 * Whether a case is written in the labelled form LeetCode displays —
 * `nums = [2,7,11,15], target = 9`. The server accepts it and converts, so the
 * line count means nothing here.
 */
const isLabelledInput = (testCase, form) => {
  const text = String(testCase.input ?? '');
  const names = (form.functionSpec?.params || []).map((p) => p.name).filter(Boolean);
  if (!names.length) return false;
  return names.every((n) => new RegExp(`(^|[\\n,])\\s*${n}\\s*=`).test(text));
};

/** Warns the teacher when a case supplies the wrong number of argument lines. */
const argCountMismatch = (testCase, form) => {
  if (!String(testCase.input ?? '').trim()) return false;
  // A design problem is always two lines: the operations, then their arguments.
  if (form.ioMode === 'class') return countArgLines(testCase) !== 2;
  if (form.ioMode !== 'function') return false;
  if (isLabelledInput(testCase, form)) return false;
  return countArgLines(testCase) !== form.functionSpec.params.length;
};

const emptyMcq = () => ({
  multiSelect: false,
  shuffleOptions: true,
  partialCredit: true,
  negativeMarks: 0,
  negativeFraction: 0,
  options: [
    { text: '', isCorrect: true, explanation: '' },
    { text: '', isCorrect: false, explanation: '' },
    { text: '', isCorrect: false, explanation: '' },
    { text: '', isCorrect: false, explanation: '' },
  ],
});

const emptyQuestion = (overrides = {}) => ({
  kind: 'coding',
  // Which workspace this belongs to. GATE questions carry GATE's marking
  // conventions and a paper section; see the server's services/gateRules.js.
  style: 'standard',
  section: '',
  nat: { answerMin: 0, answerMax: 0, unit: '' },
  mcq: emptyMcq(),
  title: '',
  statement: '',
  constraints: '',
  inputFormat: '',
  outputFormat: '',
  difficulty: 'easy',
  tags: [],
  marks: 10,
  timeLimitSec: 2,
  memoryLimitMb: 256,
  // LeetCode style by default; stdin is the deliberate exception.
  ioMode: 'function',
  functionSpec: {
    name: '',
    returnType: 'int',
    outputParam: '',
    params: [{ name: '', type: 'int', harnessOnly: false, of: '' }],
  },
  classSpec: { name: '', constructorParams: [], methods: [{ name: '', returnType: 'void', params: [] }] },
  answerCompare: { ignoreOrder: false, ignoreInnerOrder: false, tolerance: 0 },
  testCases: [
    { input: '', expectedOutput: '', points: 1, isSample: true, explanation: '' },
    { input: '', expectedOutput: '', points: 1, isSample: false, explanation: '' },
  ],
  starterCode: {},
  referenceSolution: { language: 'python', code: '' },
  ...overrides,
});

/** GATE's own section split. Free text, so a paper may name its subject. */
const GATE_SECTIONS = ['General Aptitude', 'Core Subject'];

export default function QuestionEditor() {
  const { questionId } = useParams();
  const [urlParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = !questionId;

  const [form, setForm] = useState(() => {
    const style = urlParams.get('style') === 'gate' ? 'gate' : 'standard';
    const kind = ['coding', 'mcq', 'nat'].includes(urlParams.get('kind'))
      ? urlParams.get('kind')
      : style === 'gate'
        ? 'mcq'
        : 'coding';
    return emptyQuestion({
      style,
      kind,
      // GATE only ever asks 1- and 2-mark questions, and always negatively
      // marks a single-answer MCQ by a third. Both are still editable.
      ...(style === 'gate'
        ? {
            marks: 2,
            section: 'Core Subject',
            mcq: { ...emptyMcq(), negativeFraction: kind === 'mcq' ? 1 / 3 : 0 },
          }
        : {}),
    });
  });
  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pane, setPane] = useState('problem');
  const [verify, setVerify] = useState(null);
  const [genInputs, setGenInputs] = useState('');
  const [stubLang, setStubLang] = useState('python');
  const [functionTypes, setFunctionTypes] = useState([]);
  // Return types differ from parameter types: only a return may be `void`, and
  // only a parameter may be a single `node`.
  const [returnTypes, setReturnTypes] = useState([]);
  const [functionLanguages, setFunctionLanguages] = useState([]);
  const [stubs, setStubs] = useState(null);

  // "Paste a signature" state.
  const [sigPaste, setSigPaste] = useState('');
  const [sigError, setSigError] = useState('');
  const [sigNote, setSigNote] = useState('');
  const [parsingSig, setParsingSig] = useState(false);

  /**
   * Which parts of the form the teacher has actually engaged with.
   *
   * A brand-new question should not open covered in red telling them the
   * function has no name — of course it does not, they have not written it yet.
   * Errors wait until the field has been touched or a save has been attempted.
   */
  const [touched, setTouched] = useState({});
  const [uploading, setUploading] = useState(false);
  const [usage, setUsage] = useState(null);
  // 'passed' | 'failed' | 'unchecked'. Only a *failed* check blocks publishing;
  // never having run one is a note, not an error.
  const [check, setCheck] = useState('unchecked');

  const load = useCallback(async () => {
    try {
      const [langRes, questionRes] = await Promise.all([
        api.get('/languages'),
        isNew ? Promise.resolve(null) : api.get(`/questions/${questionId}`),
      ]);
      setLanguages(langRes.languages);
      setFunctionTypes(langRes.functionTypes || []);
      setReturnTypes(langRes.returnTypes || langRes.functionTypes || []);
      setFunctionLanguages(langRes.functionLanguages || []);
      setUsage(questionRes?.usage || null);
      setCheck(questionRes?.check || 'unchecked');

      if (questionRes) {
        const q = questionRes.question;
        setForm({
          kind: q.kind || 'coding',
          style: q.style || 'standard',
          section: q.section || '',
          mcq: q.mcq?.options?.length
            ? {
                multiSelect: Boolean(q.mcq.multiSelect),
                shuffleOptions: q.mcq.shuffleOptions !== false,
                partialCredit: q.mcq.partialCredit !== false,
                negativeMarks: q.mcq.negativeMarks || 0,
                negativeFraction: q.mcq.negativeFraction || 0,
                options: q.mcq.options.map((o) => ({
                  text: o.text,
                  isCorrect: Boolean(o.isCorrect),
                  explanation: o.explanation || '',
                })),
              }
            : emptyMcq(),
          title: q.title,
          statement: q.statement || '',
          constraints: q.constraints || '',
          inputFormat: q.inputFormat || '',
          outputFormat: q.outputFormat || '',
          difficulty: q.difficulty,
          tags: q.tags || [],
          marks: q.marks,
          timeLimitSec: q.timeLimitSec,
          memoryLimitMb: q.memoryLimitMb,
          ioMode: q.ioMode || 'stdin',
          functionSpec: q.functionSpec?.name
            ? {
                name: q.functionSpec.name,
                returnType: q.functionSpec.returnType || 'int',
                outputParam: q.functionSpec.outputParam || '',
                params: (q.functionSpec.params || []).map((p) => ({
                  name: p.name,
                  type: p.type,
                  harnessOnly: Boolean(p.harnessOnly),
                  of: p.of || '',
                })),
              }
            : {
                name: '',
                returnType: 'int',
                outputParam: '',
                params: [{ name: '', type: 'int', harnessOnly: false, of: '' }],
              },
          classSpec: q.classSpec?.name
            ? {
                name: q.classSpec.name,
                constructorParams: (q.classSpec.constructorParams || []).map((p) => ({
                  name: p.name,
                  type: p.type,
                })),
                methods: (q.classSpec.methods || []).map((m) => ({
                  name: m.name,
                  returnType: m.returnType,
                  params: (m.params || []).map((p) => ({ name: p.name, type: p.type })),
                })),
              }
            : {
                name: '',
                constructorParams: [],
                methods: [{ name: '', returnType: 'void', params: [] }],
              },
          answerCompare: {
            ignoreOrder: Boolean(q.answerCompare?.ignoreOrder),
            ignoreInnerOrder: Boolean(q.answerCompare?.ignoreInnerOrder),
            tolerance: q.answerCompare?.tolerance ?? 0,
          },
          testCases: q.testCases.map(({ input, expectedOutput, points, isSample, explanation }) => ({
            input,
            expectedOutput,
            points,
            isSample,
            explanation: explanation || '',
          })),
          starterCode: q.starterCode || {},
          referenceSolution: q.referenceSolution?.language
            ? q.referenceSolution
            : { language: 'python', code: '' },
        });
      }
      setLoading(false);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }, [questionId, isNew]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /** Uploads a diagram and appends the markdown to the statement. */
  const uploadImage = async (file, input) => {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      const { markdown } = await api.post('/questions/images', body);
      setForm((f) => ({
        ...f,
        statement: f.statement.trimEnd()
          ? `${f.statement.trimEnd()}\n\n${markdown}\n`
          : `${markdown}\n`,
      }));
      toast.success('Diagram added to the statement');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (input) input.value = '';
    }
  };

  const setSpec = (patch) => {
    setTouched((t) => ({ ...t, functionSpec: true }));
    setForm((f) => ({ ...f, functionSpec: { ...f.functionSpec, ...patch } }));
  };

  const setParam = (i, patch) => {
    setTouched((t) => ({ ...t, functionSpec: true }));
    setForm((f) => ({
      ...f,
      functionSpec: {
        ...f.functionSpec,
        params: f.functionSpec.params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
      },
    }));
  };

  // Ask the server for the stubs so the preview always matches what students
  // actually receive: the generator lives in exactly one place.
  useEffect(() => {
    const generated = form.ioMode === 'function' || form.ioMode === 'class';
    if (form.kind !== 'coding' || !generated) {
      setStubs(null);
      return undefined;
    }
    const id = setTimeout(async () => {
      try {
        const body =
          form.ioMode === 'class'
            ? { classSpec: form.classSpec }
            : { functionSpec: form.functionSpec };
        setStubs(await api.post('/questions/preview-stubs', body));
      } catch {
        setStubs(null);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [form.kind, form.ioMode, form.functionSpec, form.classSpec]);

  // Node types are written as arrays in test cases, which is not guessable —
  // so the format note only appears once the signature actually uses one.
  const usesNodeType =
    ['list', 'tree'].includes(form.functionSpec.returnType) ||
    form.functionSpec.params.some((p) => ['list', 'tree', 'node'].includes(p.type));

  const isVoid = form.functionSpec.returnType === 'void';

  /** List and tree parameters a `node` parameter could be taken from. */
  const structureParams = form.functionSpec.params.filter(
    (p) => p.name && ['list', 'tree'].includes(p.type)
  );

  /**
   * Reads a pasted signature into the builder.
   *
   * The first test case is sent along so an untyped signature — JavaScript has
   * no types at all — can still produce a complete spec. Whatever comes back is
   * a starting point the teacher can correct, never a final answer.
   */
  const applyPastedSignature = async () => {
    if (!sigPaste.trim()) return;
    setParsingSig(true);
    setSigError('');
    setSigNote('');
    try {
      const first = form.testCases[0] || {};
      const res = await api.post('/questions/parse-signature', {
        source: sigPaste,
        sampleInput: first.input || '',
        sampleOutput: first.expectedOutput || '',
      });

      if (!res.ok) {
        setSigError(res.error);
        return;
      }

      setForm((f) => ({ ...f, functionSpec: res.spec }));
      setTouched((t) => ({ ...t, functionSpec: true }));

      const guessed = [
        ...res.inferred,
        ...(res.returnTypeInferred ? ['the return type'] : []),
      ];
      setSigNote(
        guessed.length
          ? `Read it. ${guessed.join(', ')} had no type in that signature — guessed from your first test case, so check ${guessed.length === 1 ? 'it' : 'them'}.`
          : 'Read it. Check the generated starter code on the right.'
      );
      setSigPaste('');
    } catch (err) {
      setSigError(err.message);
    } finally {
      setParsingSig(false);
    }
  };

  /**
   * The generated starter code for the reference solution's language.
   *
   * The reference solution has to be the same shape a student writes, so the
   * stub is the correct starting point — and offering it is what stops someone
   * pasting a whole program in here.
   */
  const referenceStub = stubs?.ok ? stubs.stubs?.[form.referenceSolution.language] : null;

  /**
   * Switching language replaces the body only when it was still the untouched
   * template — never discards real work.
   */
  const switchReferenceLanguage = (language) => {
    const current = form.referenceSolution.code.trim();
    const wasStub =
      !current ||
      Object.values(stubs?.stubs || {}).some((s) => s.trim() === current);

    setForm((f) => ({
      ...f,
      referenceSolution: {
        language,
        code: wasStub ? (stubs?.stubs?.[language] ?? '') : f.referenceSolution.code,
      },
    }));
  };

  const setClassSpec = (patch) =>
    setForm((f) => ({ ...f, classSpec: { ...f.classSpec, ...patch } }));

  const setCtorParam = (i, patch) =>
    setForm((f) => ({
      ...f,
      classSpec: {
        ...f.classSpec,
        constructorParams: f.classSpec.constructorParams.map((p, idx) =>
          idx === i ? { ...p, ...patch } : p
        ),
      },
    }));

  const setMethod = (i, patch) =>
    setForm((f) => ({
      ...f,
      classSpec: {
        ...f.classSpec,
        methods: f.classSpec.methods.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
      },
    }));

  const setMethodParam = (mi, pi, patch) =>
    setForm((f) => ({
      ...f,
      classSpec: {
        ...f.classSpec,
        methods: f.classSpec.methods.map((m, idx) =>
          idx === mi
            ? { ...m, params: m.params.map((p, j) => (j === pi ? { ...p, ...patch } : p)) }
            : m
        ),
      },
    }));

  /** Inner order only means something once the outer order is already free. */
  const setCompare = (patch) =>
    setForm((f) => {
      const next = { ...f.answerCompare, ...patch };
      if (!next.ignoreOrder) next.ignoreInnerOrder = false;
      return { ...f, answerCompare: next };
    });

  const setCase = (idx, patch) =>
    setForm((f) => ({
      ...f,
      testCases: f.testCases.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));

  const addCase = (isSample) =>
    setForm((f) => ({
      ...f,
      testCases: [
        ...f.testCases,
        { input: '', expectedOutput: '', points: 1, isSample, explanation: '' },
      ],
    }));

  const removeCase = (idx) =>
    setForm((f) => ({ ...f, testCases: f.testCases.filter((_, i) => i !== idx) }));

  const payload = () => ({
    ...form,
    marks: Number(form.marks),
    timeLimitSec: Number(form.timeLimitSec),
    memoryLimitMb: Number(form.memoryLimitMb),
    answerCompare: {
      ...form.answerCompare,
      // The number input hands back a string, and an empty box means exact.
      tolerance: Number(form.answerCompare.tolerance) || 0,
    },
    mcq: {
      ...form.mcq,
      negativeMarks: Number(form.mcq.negativeMarks) || 0,
      negativeFraction: Number(form.mcq.negativeFraction) || 0,
      options: form.mcq.options.filter((o) => o.text.trim()),
    },
    testCases: form.testCases.map((c) => ({ ...c, points: Number(c.points) })),
  });

  /**
   * Persists the question and returns its id.
   *
   * Everything that needs the question to exist on the server goes through
   * here rather than refusing and telling the teacher to go and press Save —
   * that button lives in the page header, which is far off-screen by the time
   * you are working on the reference solution at the bottom of the form.
   *
   * @returns {Promise<string|null>} the id, or null if it could not be saved
   */
  const persist = async () => {
    setTouched((t) => ({ ...t, save: true }));
    if (form.kind === 'coding' && !form.testCases.length) {
      toast.error('Add at least one test case');
      return null;
    }

    setSaving(true);
    try {
      if (isNew) {
        const { question } = await api.post('/questions', payload());
        // `replace` so Back still returns to the library rather than to a
        // "new question" form that no longer reflects anything.
        navigate(`/teacher/questions/${question._id}`, { replace: true });
        return question._id;
      }
      await api.patch(`/questions/${questionId}`, payload());
      return questionId;
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const id = await persist();
    if (id) toast.success(isNew ? 'Question created' : 'Saved');
  };

  const runReference = async () => {
    // Saves first rather than refusing — pressing "check this works" plainly
    // means "keep what I typed", and there is nothing to lose by doing it.
    const id = await persist();
    if (!id) return;

    setVerify({ loading: true });
    try {
      const res = await api.post(`/questions/${id}/verify-reference`);
      setVerify(res);
      setCheck(res.verified ? 'passed' : 'failed');
      if (res.verified) {
        toast.success('Checked — a correct solution passes every case.');
      } else {
        toast.error(
          `${res.totalCount - res.passedCount} case(s) disagree with your expected output. Publishing is blocked until this passes or you clear it.`
        );
      }
    } catch (err) {
      setVerify(null);
      toast.error(err.message);
    }
  };

  const generateOutputs = async () => {
    const inputs = genInputs
      .split('\n---\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!inputs.length) {
      return toast.warn('Add at least one input, separating cases with a --- line');
    }

    const id = await persist();
    if (!id) return;

    setVerify({ loading: true });
    try {
      const { candidates } = await api.post(`/questions/${id}/generate-outputs`, { inputs });
      setVerify(null);
      setForm((f) => ({
        ...f,
        testCases: [
          ...f.testCases,
          ...candidates.map((c) => ({
            input: c.input.endsWith('\n') ? c.input : `${c.input}\n`,
            expectedOutput: c.expectedOutput,
            points: 1,
            isSample: false,
            explanation: '',
          })),
        ],
      }));
      setGenInputs('');
      toast.success(`${candidates.length} candidate case(s) added, review the outputs then save`);
    } catch (err) {
      setVerify(null);
      toast.error(err.message);
    }
  };

  const sampleCount = form.testCases.filter((c) => c.isSample).length;
  const hiddenCount = form.testCases.length - sampleCount;
  const isFunctionMode = form.ioMode === 'function';
  const isClassMode = form.ioMode === 'class';

  /**
   * Whether to show what is wrong with the signature yet.
   *
   * An existing question is already meant to be complete, so problems show
   * immediately. A new one stays quiet until the teacher has engaged with the
   * signature or pressed Save — telling someone their empty form is empty is
   * noise, not help.
   */
  const showSpecErrors = !isNew || touched.functionSpec || touched.save;
  const isMcq = form.kind === 'mcq';
  const isNat = form.kind === 'nat';
  // Test cases, signatures and reference solutions belong to coding questions
  // alone — both other kinds are graded against a stored answer.
  const isCoding = form.kind === 'coding';
  const filledOptions = form.mcq.options.filter((o) => o.text.trim()).length;

  // Shaped exactly like Question.toStudentView() so ProblemPane can render it.
  // Must stay above the early returns below: hooks cannot run conditionally.
  const previewQuestion = useMemo(
    () => ({
      title: form.title || 'Untitled question',
      statement: form.statement || '_No statement yet._',
      constraints: form.constraints,
      inputFormat: form.inputFormat,
      outputFormat: form.outputFormat,
      difficulty: form.difficulty,
      marks: Number(form.marks) || 0,
      timeLimitSec: Number(form.timeLimitSec) || 0,
      memoryLimitMb: Number(form.memoryLimitMb) || 0,
      ioMode: form.ioMode,
      functionSpec: form.functionSpec,
      samples: form.testCases
        .filter((c) => c.isSample)
        .map((c, i) => ({
          id: `preview-${i}`,
          input: c.input,
          expectedOutput: c.expectedOutput,
          explanation: c.explanation,
        })),
      hiddenCaseCount: hiddenCount,
    }),
    [form, hiddenCount]
  );

  if (loading) return <PageLoader label="Loading question..." />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const SECTIONS = !isCoding
    ? [
        { key: 'problem', label: 'Question' },
        { key: 'options', label: isNat ? 'Answer' : `Options (${filledOptions})` },
      ]
    : [
        { key: 'problem', label: 'Problem' },
        { key: 'format', label: 'Answer format' },
        { key: 'cases', label: `Test cases (${form.testCases.length})` },
        // In function mode the starter code is generated, so nothing to edit.
        ...(isFunctionMode ? [] : [{ key: 'starter', label: 'Starter code' }]),
        { key: 'reference', label: 'Reference solution' },
      ];

  // Switching kind can remove the tab that was open, so fall back rather than
  // rendering an empty page.
  const activeSection = SECTIONS.some((s) => s.key === pane) ? pane : 'problem';

  const subtitle = isNat
    ? `Numerical answer, no negative marking, ${form.marks} marks`
    : isMcq
      ? `Multiple choice, ${filledOptions} options, ${form.marks} marks`
      : `${sampleCount} visible sample${sampleCount === 1 ? '' : 's'}, ${hiddenCount} hidden, ${form.marks} marks`;

  return (
    <>
      <PageHeader
        title={isNew ? 'New question' : form.title || 'Question'}
        subtitle={subtitle}
        back={{ to: '/teacher/questions', label: 'Question library' }}
        actions={
          <div className="flex items-center gap-2">
            {!isNew && form.kind === 'coding' && (
              <span
                className={`badge badge-${check === 'passed' ? 'ok' : check === 'failed' ? 'bad' : 'muted'}`}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  {check === 'passed' ? (
                    <path
                      d="M4 8.5 6.8 11 12 4.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : check === 'failed' ? (
                    <path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  ) : (
                    <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" fill="none" />
                  )}
                </svg>
                {check === 'passed' ? 'Checked' : check === 'failed' ? 'Check failed' : 'Not checked'}
              </span>
            )}
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner label="Saving..." /> : isNew ? 'Create question' : 'Save changes'}
            </button>
          </div>
        }
      />

      {/* A check that ran and failed is evidence the question is broken, so it
          blocks publishing. Never having run one is not evidence of anything —
          it is mentioned once, quietly, and gets out of the way. */}
      {!isNew && form.kind === 'coding' && check === 'failed' && (
        <div
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}
        >
          <p className="font-bold">Your reference solution does not pass these test cases.</p>
          <p className="mt-1">
            Something is wrong with the expected outputs, the solution, or both — and a student would
            hit the same thing. No test containing this question can be published until it passes.
          </p>
        </div>
      )}

      {!isNew && form.kind === 'coding' && check === 'unchecked' && (
        <div
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}
        >
          <span className="font-semibold">Not checked.</span> Optional — add a reference solution
          below and press <strong>Verify reference solution</strong> to confirm the expected outputs
          are right. Publishing works either way.
        </div>
      )}

      {usage?.liveTests?.length > 0 && (
        <div
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
        >
          <strong>
            This question is in a test that is running right now
            {usage.studentsSittingNow > 0
              ? `, with ${usage.studentsSittingNow} student(s) working on it`
              : ''}
            .
          </strong>{' '}
          Edits take effect immediately, so changing the statement or a test case changes what they
          are graded against. Fixing a typo is fine; reworking the problem mid-exam is not.
          <span className="mt-1 block text-xs opacity-80">
            In: {usage.liveTests.map((t) => t.title).join(', ')}
          </span>
        </div>
      )}

      <nav className="mb-4 flex flex-wrap gap-1 border-b">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setPane(s.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeSection === s.key
                ? 'border-[var(--color-brand-600)] text-[var(--color-brand-600)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {activeSection === 'problem' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <section className="card px-5 py-4">
              <h2 className="mb-1 text-sm font-bold">Question type</h2>
              <p className="hint mb-3">
                A test can mix both freely. It is multiple choice only, coding only, or a
                combination, purely by which questions you add to it.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {[
                  { key: 'coding', title: 'Coding', body: 'Graded by running their code.' },
                  { key: 'mcq', title: 'Multiple choice', body: 'Graded against an answer key.' },
                  {
                    key: 'nat',
                    title: 'Numerical answer',
                    body: "GATE's NAT — they type a number. Never negatively marked.",
                  },
                ].map((opt) => (
                  <label
                    key={opt.key}
                    className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5"
                    style={{
                      borderColor:
                        form.kind === opt.key ? 'var(--color-brand-500)' : 'var(--border)',
                      background: form.kind === opt.key ? 'var(--color-brand-50)' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      checked={form.kind === opt.key}
                      onChange={() => set({ kind: opt.key })}
                    />
                    <span>
                      <span className="block text-sm font-semibold">{opt.title}</span>
                      <span className="block text-xs text-[var(--text-muted)]">{opt.body}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="card px-5 py-4">
              <div className="flex flex-col gap-3">
                <div>
                  <label className="label" htmlFor="q-title">
                    Title
                  </label>
                  <input
                    id="q-title"
                    className="input"
                    value={form.title}
                    onChange={(e) => set({ title: e.target.value })}
                    placeholder={
                      isCoding ? 'Longest Increasing Subsequence' : 'Time complexity of binary search'
                    }
                  />
                </div>

                <div>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <label className="label" htmlFor="q-statement">
                      {isCoding ? 'Problem statement (markdown)' : 'Question text (markdown)'}
                    </label>
                    <label className="btn btn-ghost btn-sm mb-1 cursor-pointer">
                      {uploading ? <Spinner label="Uploading..." /> : '+ Add diagram'}
                      <input
                        type="file"
                        className="hidden"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        disabled={uploading}
                        onChange={(e) => uploadImage(e.target.files?.[0], e.target)}
                      />
                    </label>
                  </div>
                  <textarea
                    id="q-statement"
                    className="textarea"
                    rows={isCoding ? 10 : 6}
                    value={form.statement}
                    onChange={(e) => set({ statement: e.target.value })}
                    placeholder={'Given an array of **n** integers, find...'}
                  />
                  <p className="hint">
                    Upload a diagram for linked lists, trees or graphs. It is inserted as markdown
                    and appears in the preview and to students. PNG, JPEG, GIF or WebP, up to 3 MB.
                  </p>
                </div>

                {isCoding && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label" htmlFor="q-in">
                          Input format
                        </label>
                        <textarea
                          id="q-in"
                          className="textarea"
                          rows={3}
                          value={form.inputFormat}
                          onChange={(e) => set({ inputFormat: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor="q-out">
                          Output format
                        </label>
                        <textarea
                          id="q-out"
                          className="textarea"
                          rows={3}
                          value={form.outputFormat}
                          onChange={(e) => set({ outputFormat: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="label" htmlFor="q-constraints">
                        Constraints
                      </label>
                      <textarea
                        id="q-constraints"
                        className="textarea"
                        rows={2}
                        value={form.constraints}
                        onChange={(e) => set({ constraints: e.target.value })}
                        placeholder="1 <= n <= 10^5"
                      />
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="card px-5 py-4">
              <h2 className="mb-3 text-sm font-bold">Grading &amp; limits</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="q-style">
                    Paper style
                  </label>
                  <select
                    id="q-style"
                    className="select"
                    value={form.style}
                    onChange={(e) => {
                      const style = e.target.value;
                      // Switching to GATE applies its conventions; switching
                      // away leaves the numbers alone rather than silently
                      // dropping a deduction the teacher may have wanted.
                      set(
                        style === 'gate'
                          ? {
                              style,
                              section: form.section || 'Core Subject',
                              mcq: {
                                ...form.mcq,
                                negativeFraction:
                                  form.kind === 'mcq' && !form.mcq.multiSelect
                                    ? form.mcq.negativeFraction || 1 / 3
                                    : 0,
                                ...(form.mcq.multiSelect ? { partialCredit: false } : {}),
                              },
                            }
                          : { style }
                      );
                    }}
                  >
                    <option value="standard">Standard — a normal class test</option>
                    <option value="gate">GATE — GATE's marking and sections</option>
                  </select>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {form.style === 'gate'
                      ? 'A single-answer MCQ loses a third of its marks when wrong. MSQ and NAT never lose marks — that is GATE’s rule, not a setting.'
                      : 'Nothing is deducted for a wrong answer unless you set it below.'}
                  </p>
                </div>

                {form.style === 'gate' && (
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="q-section">
                      Paper section
                    </label>
                    <input
                      id="q-section"
                      className="input"
                      list="gate-sections"
                      placeholder="Core Subject"
                      value={form.section}
                      onChange={(e) => set({ section: e.target.value })}
                    />
                    <datalist id="gate-sections">
                      {GATE_SECTIONS.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      GATE papers are 15 marks of General Aptitude and 85 of the subject. Name your
                      own section if your paper is split differently.
                    </p>
                  </div>
                )}

                <div>
                  <label className="label" htmlFor="q-diff">
                    Difficulty
                  </label>
                  <select
                    id="q-diff"
                    className="select"
                    value={form.difficulty}
                    onChange={(e) => set({ difficulty: e.target.value })}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="q-marks">
                    Marks
                  </label>
                  <input
                    id="q-marks"
                    type="number"
                    min={0}
                    className="input"
                    value={form.marks}
                    onChange={(e) => set({ marks: e.target.value })}
                  />
                </div>

                {isCoding && (
                  <>
                    <div>
                      <label className="label" htmlFor="q-time">
                        Time limit (seconds)
                      </label>
                      <input
                        id="q-time"
                        type="number"
                        min={0.5}
                        max={20}
                        step={0.5}
                        className="input"
                        value={form.timeLimitSec}
                        onChange={(e) => set({ timeLimitSec: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="q-mem">
                        Memory limit (MB)
                      </label>
                      <input
                        id="q-mem"
                        type="number"
                        min={16}
                        max={1024}
                        step={16}
                        className="input"
                        value={form.memoryLimitMb}
                        onChange={(e) => set({ memoryLimitMb: e.target.value })}
                      />
                    </div>
                  </>
                )}

                <div className="sm:col-span-2">
                  <label className="label" htmlFor="q-tags">
                    Tags (comma separated)
                  </label>
                  <input
                    id="q-tags"
                    className="input"
                    value={form.tags.join(', ')}
                    onChange={(e) =>
                      set({
                        tags: e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="arrays, dp"
                  />
                </div>
              </div>
              {isCoding && (
                <p className="hint">
                  Judge0 enforces these limits per case, so an inefficient or infinite-looping
                  solution fails rather than hanging the exam.
                </p>
              )}
            </section>

            {isCoding && (
              <section className="card px-5 py-4">
                <h2 className="mb-1 text-sm font-bold">How the answer is checked</h2>
                <p className="hint mb-3">
                  By default the output must match the expected text exactly. Loosen it only when
                  exact matching would mark a correct answer wrong.
                </p>

                <div className="flex flex-col gap-2.5">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={form.answerCompare.ignoreOrder}
                      onChange={(e) => setCompare({ ignoreOrder: e.target.checked })}
                    />
                    <span>
                      The order of the answer does not matter
                      <span className="block text-xs text-[var(--text-muted)]">
                        For problems whose answer is a set — "3Sum", "Group Anagrams", "Subsets".
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={!form.answerCompare.ignoreOrder}
                      checked={form.answerCompare.ignoreInnerOrder}
                      onChange={(e) => setCompare({ ignoreInnerOrder: e.target.checked })}
                    />
                    <span>
                      …and the order inside each element does not matter either
                      <span className="block text-xs text-[var(--text-muted)]">
                        "3Sum" accepts <code className="mono">[0,-1,1]</code> for{' '}
                        <code className="mono">[-1,0,1]</code>. "Permutations" does not — leave this
                        off there.
                      </span>
                    </span>
                  </label>

                  <div>
                    <label className="label" htmlFor="q-tol">
                      Numeric tolerance
                    </label>
                    <input
                      id="q-tol"
                      type="number"
                      min={0}
                      max={1}
                      step={0.000001}
                      className="input w-40"
                      value={form.answerCompare.tolerance}
                      onChange={(e) => setCompare({ tolerance: e.target.value })}
                    />
                    <p className="hint mt-1">
                      0 means exact. Set it to something like 0.000001 for answers that are
                      fractions — the languages print decimals differently, so they can never be
                      compared as text.
                    </p>
                  </div>
                </div>
              </section>
            )}
          </div>

          <section className="card px-5 py-4">
            <h2 className="mb-3 text-sm font-bold">Preview, what students see</h2>
            {/* Renders the student's own ProblemPane, so this preview cannot
                drift from the real solve screen. */}
            <div className="overflow-hidden rounded-lg border">
              <ProblemPane preview question={previewQuestion} />
            </div>
          </section>
        </div>
      )}

      {activeSection === 'options' && isNat && (
        <div className="max-w-3xl">
          <NatEditor
            value={form.nat}
            onChange={(nat) => set({ nat })}
            marks={Number(form.marks) || 0}
          />
        </div>
      )}

      {activeSection === 'options' && !isNat && (
        <div className="max-w-3xl">
          <McqEditor
            value={form.mcq}
            onChange={(mcq) => set({ mcq })}
            marks={Number(form.marks) || 0}
          />
        </div>
      )}

      {activeSection === 'format' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <section className="card px-5 py-4">
              <h2 className="mb-1 text-sm font-bold">How does the student answer?</h2>
              <p className="hint mb-3">
                This decides what their editor starts with and how their code is run.
              </p>

              <div className="flex flex-col gap-2">
                {[
                  {
                    key: 'function',
                    title: 'Implement a function (LeetCode style) — default',
                    body: 'You define a signature. Every language gets a ready-made stub with the arguments already in scope, and the student just returns an answer. No reading input, no printing.',
                  },
                  {
                    key: 'class',
                    title: 'Implement a class (design problem)',
                    body: 'For LRU Cache, Min Stack, Implement Trie. You define a constructor and methods; the test case is a list of operations and their arguments, and the answer is what each one returned.',
                  },
                  {
                    key: 'stdin',
                    title: 'Standard input and output',
                    body: 'The escape hatch. The student writes a whole program that reads stdin and prints stdout, and you hand-write a stub per language. Only use this for problems the type list cannot express.',
                  },
                ].map((opt) => (
                  <label
                    key={opt.key}
                    className="flex cursor-pointer gap-2 rounded-lg border px-3 py-2.5"
                    style={{
                      borderColor:
                        form.ioMode === opt.key ? 'var(--color-brand-500)' : 'var(--border)',
                      background: form.ioMode === opt.key ? 'var(--color-brand-50)' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      checked={form.ioMode === opt.key}
                      onChange={() => set({ ioMode: opt.key })}
                    />
                    <span>
                      <span className="block text-sm font-semibold">{opt.title}</span>
                      <span className="block text-xs text-[var(--text-muted)]">{opt.body}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {isClassMode && (
              <section className="card px-5 py-4">
                <h2 className="mb-3 text-sm font-bold">Class</h2>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <label className="label" htmlFor="cls-name">
                      Class name
                    </label>
                    <input
                      id="cls-name"
                      className="input mono"
                      placeholder="LRUCache"
                      value={form.classSpec.name}
                      onChange={(e) => setClassSpec({ name: e.target.value })}
                    />
                  </div>
                </div>

                <p className="label mt-4">Constructor parameters</p>
                <div className="flex flex-col gap-2">
                  {form.classSpec.constructorParams.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 text-xs text-[var(--text-faint)]">{i + 1}.</span>
                      <input
                        className="input mono flex-1"
                        placeholder="capacity"
                        value={p.name}
                        onChange={(e) => setCtorParam(i, { name: e.target.value })}
                      />
                      <select
                        className="select mono w-auto"
                        value={p.type}
                        onChange={(e) => setCtorParam(i, { type: e.target.value })}
                      >
                        {functionTypes
                          .filter((t) => !['node', 'list', 'tree'].includes(t))
                          .map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        className="text-xs text-[var(--text-faint)] hover:text-[var(--bad)]"
                        onClick={() =>
                          setClassSpec({
                            constructorParams: form.classSpec.constructorParams.filter(
                              (_, idx) => idx !== i
                            ),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {!form.classSpec.constructorParams.length && (
                    <p className="text-xs text-[var(--text-faint)]">
                      None — the constructor takes no arguments.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-2"
                  onClick={() =>
                    setClassSpec({
                      constructorParams: [
                        ...form.classSpec.constructorParams,
                        { name: '', type: 'int' },
                      ],
                    })
                  }
                >
                  + Add constructor parameter
                </button>

                <p className="label mt-5">Methods</p>
                <div className="flex flex-col gap-3">
                  {form.classSpec.methods.map((m, mi) => (
                    <div key={mi} className="rounded-lg border px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          className="input mono flex-1"
                          placeholder="get"
                          value={m.name}
                          onChange={(e) => setMethod(mi, { name: e.target.value })}
                        />
                        <span className="text-xs text-[var(--text-faint)]">returns</span>
                        <select
                          className="select mono w-auto"
                          value={m.returnType}
                          onChange={(e) => setMethod(mi, { returnType: e.target.value })}
                        >
                          {returnTypes
                            .filter((t) => !['list', 'tree'].includes(t))
                            .map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className="text-xs text-[var(--text-faint)] hover:text-[var(--bad)]"
                          onClick={() =>
                            setClassSpec({
                              methods: form.classSpec.methods.filter((_, idx) => idx !== mi),
                            })
                          }
                          disabled={form.classSpec.methods.length === 1}
                        >
                          Remove
                        </button>
                      </div>

                      <div className="mt-2 flex flex-col gap-1.5 pl-3">
                        {m.params.map((p, pi) => (
                          <div key={pi} className="flex items-center gap-2">
                            <input
                              className="input mono flex-1 py-1 text-xs"
                              placeholder="key"
                              value={p.name}
                              onChange={(e) => setMethodParam(mi, pi, { name: e.target.value })}
                            />
                            <select
                              className="select mono w-auto py-1 text-xs"
                              value={p.type}
                              onChange={(e) => setMethodParam(mi, pi, { type: e.target.value })}
                            >
                              {functionTypes
                                .filter((t) => !['node', 'list', 'tree'].includes(t))
                                .map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              className="text-xs text-[var(--text-faint)] hover:text-[var(--bad)]"
                              onClick={() =>
                                setMethod(mi, {
                                  params: m.params.filter((_, idx) => idx !== pi),
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="self-start text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                          onClick={() =>
                            setMethod(mi, { params: [...m.params, { name: '', type: 'int' }] })
                          }
                        >
                          + parameter
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-2"
                  onClick={() =>
                    setClassSpec({
                      methods: [
                        ...form.classSpec.methods,
                        { name: '', returnType: 'void', params: [] },
                      ],
                    })
                  }
                >
                  + Add method
                </button>

                {showSpecErrors && stubs && !stubs.ok && stubs.errors?.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1">
                    {stubs.errors.map((e) => (
                      <li key={e} className="text-xs" style={{ color: 'var(--bad)' }}>
                        {e}
                      </li>
                    ))}
                  </ul>
                )}

                <div
                  className="mt-3 rounded-lg px-3 py-2 text-xs"
                  style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
                >
                  <p className="font-semibold">Writing test cases for a design problem</p>
                  <p className="mt-1">
                    Two lines, the same format LeetCode uses — the operations, then their arguments.
                    The first operation is always the constructor.
                  </p>
                  <pre className="io-block mt-1.5">{`["${form.classSpec.name || 'LRUCache'}","put","get"]
[[2],[1,1],[1]]`}</pre>
                  <p className="mt-1.5">
                    The expected output is one entry per operation, with{' '}
                    <code className="mono">null</code> for the constructor and for any method that
                    returns nothing: <code className="mono">[null,null,1]</code>
                  </p>
                </div>
              </section>
            )}

            {isFunctionMode && (
              <section className="card px-5 py-4">
                <h2 className="mb-1 text-sm font-bold">Function signature</h2>
                <p className="hint mb-3">
                  Paste the signature you already have and this fills itself in. Every field below
                  stays editable.
                </p>

                {/* Assembling a signature out of dropdowns is slow and easy to
                    get subtly wrong. A teacher setting a question almost always
                    has the shape in front of them already. */}
                <div className="mb-5 rounded-lg border bg-[var(--surface-2)] p-3">
                  <label className="label" htmlFor="sig-paste">
                    Paste a signature — any language
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="sig-paste"
                      className="input mono flex-1"
                      placeholder="int[] twoSum(int[] nums, int target)"
                      value={sigPaste}
                      onChange={(e) => setSigPaste(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyPastedSignature();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={applyPastedSignature}
                      disabled={!sigPaste.trim() || parsingSig}
                    >
                      {parsingSig ? <Spinner label="Reading…" /> : 'Read it'}
                    </button>
                  </div>

                  {sigError && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--bad)' }}>
                      {sigError}
                    </p>
                  )}
                  {sigNote && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--ok)' }}>
                      {sigNote}
                    </p>
                  )}

                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[var(--text-muted)]">
                      Examples it understands
                    </summary>
                    <ul className="mono mt-1.5 flex flex-col gap-1 text-[0.72rem] text-[var(--text-faint)]">
                      <li>def twoSum(self, nums: List[int], target: int) -&gt; List[int]:</li>
                      <li>public int[] twoSum(int[] nums, int target)</li>
                      <li>vector&lt;int&gt; twoSum(vector&lt;int&gt;&amp; nums, int target)</li>
                      <li>int* twoSum(int* nums, int numsSize, int target, int* returnSize)</li>
                      <li>var twoSum = function(nums, target)</li>
                    </ul>
                    <p className="hint mt-1.5">
                      C&apos;s size parameters are dropped automatically. An untyped JavaScript
                      signature takes its types from your first test case.
                    </p>
                  </details>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <label className="label" htmlFor="fn-name">
                      Function name
                    </label>
                    <input
                      id="fn-name"
                      className="input mono"
                      placeholder="twoSum"
                      value={form.functionSpec.name}
                      onChange={(e) => setSpec({ name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="fn-ret">
                      Returns
                    </label>
                    <select
                      id="fn-ret"
                      className="select mono w-auto"
                      value={form.functionSpec.returnType}
                      onChange={(e) => setSpec({ returnType: e.target.value })}
                    >
                      {returnTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  {isVoid && (
                    <div>
                      <label className="label" htmlFor="fn-out">
                        Answer is
                      </label>
                      <select
                        id="fn-out"
                        className="select mono w-auto"
                        value={form.functionSpec.outputParam}
                        onChange={(e) => setSpec({ outputParam: e.target.value })}
                      >
                        <option value="">choose…</option>
                        {form.functionSpec.params
                          .filter((p) => p.name && p.type !== 'node')
                          .map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>

                {isVoid && (
                  <p
                    className="mt-3 rounded-lg px-3 py-2 text-xs"
                    style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
                  >
                    The function returns nothing, so the answer is whatever state
                    the chosen parameter is left in — the student modifies it in place. This is how
                    LeetCode poses "Move Zeroes", "Rotate Image" and "Delete Node in a Linked List".
                  </p>
                )}

                <p className="label mt-4">Parameters</p>
                <div className="flex flex-col gap-2">
                  {form.functionSpec.params.map((p, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 text-xs text-[var(--text-faint)]">{i + 1}.</span>
                        <input
                          className="input mono flex-1"
                          placeholder="nums"
                          value={p.name}
                          onChange={(e) => setParam(i, { name: e.target.value })}
                        />
                        <select
                          className="select mono w-auto"
                          value={p.type}
                          onChange={(e) => setParam(i, { type: e.target.value })}
                        >
                          {functionTypes.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>

                        {/* A single node has to say which structure it came from. */}
                        {p.type === 'node' && (
                          <select
                            className="select mono w-auto"
                            title="The list or tree this node is taken from"
                            value={p.of}
                            onChange={(e) => setParam(i, { of: e.target.value })}
                          >
                            <option value="">of…</option>
                            {structureParams.map((s) => (
                              <option key={s.name} value={s.name}>
                                of {s.name}
                              </option>
                            ))}
                          </select>
                        )}

                        <button
                          type="button"
                          className="text-xs text-[var(--text-faint)] hover:text-[var(--bad)]"
                          onClick={() =>
                            setSpec({
                              params: form.functionSpec.params.filter((_, idx) => idx !== i),
                            })
                          }
                          disabled={form.functionSpec.params.length === 1}
                        >
                          Remove
                        </button>
                      </div>

                      <label className="ml-7 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <input
                          type="checkbox"
                          checked={Boolean(p.harnessOnly)}
                          onChange={(e) => setParam(i, { harnessOnly: e.target.checked })}
                        />
                        Build it but don't pass it to the student
                        {p.harnessOnly && p.name === form.functionSpec.outputParam && (
                          <span className="text-[var(--text-faint)]">— it is the answer</span>
                        )}
                      </label>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-2"
                  onClick={() =>
                    setSpec({
                      params: [
                        ...form.functionSpec.params,
                        { name: '', type: 'int', harnessOnly: false, of: '' },
                      ],
                    })
                  }
                >
                  + Add parameter
                </button>

                {showSpecErrors && stubs && !stubs.ok && stubs.errors?.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1">
                    {stubs.errors.map((e) => (
                      <li key={e} className="text-xs" style={{ color: 'var(--bad)' }}>
                        {e}
                      </li>
                    ))}
                  </ul>
                )}

                {usesNodeType && (
                  <div
                    className="mt-3 rounded-lg px-3 py-2 text-xs"
                    style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
                  >
                    <p className="font-semibold">Writing test cases for list and tree</p>
                    <p className="mt-1">
                      Write them as plain arrays — the same format LeetCode uses. The student's
                      function receives real nodes, and the expected output is the array their
                      returned nodes produce.
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      <li>
                        <code className="mono">list</code> — <code className="mono">[1,2,3]</code> is
                        1→2→3, and <code className="mono">[]</code> is an empty list
                      </li>
                      <li>
                        <code className="mono">tree</code> — level order with{' '}
                        <code className="mono">null</code> for a missing child, so{' '}
                        <code className="mono">[3,9,20,null,null,15,7]</code>
                      </li>
                      <li>
                        <code className="mono">node</code> — just the value, e.g.{' '}
                        <code className="mono">5</code>. The harness finds that node inside the
                        structure you pointed it at and passes only the node.
                      </li>
                    </ul>
                  </div>
                )}

                <p
                  className="mt-3 rounded-lg px-3 py-2 text-xs"
                  style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
                >
                  Every function question works in all {functionLanguages.length} languages (
                  {functionLanguages.join(', ')}). Floating point is not offered because the
                  languages print it differently, so use standard input/output if you need it.
                </p>
              </section>
            )}
          </div>

          {(isFunctionMode || isClassMode) && (
            <section className="card px-5 py-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold">Generated starter code</h2>
                {stubs?.ok && <span className="badge badge-ok">valid</span>}
              </div>

              {!stubs?.ok ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Finish the {isClassMode ? 'class' : 'signature'} above and the starter code for
                  every language appears here. This is exactly what each student will open onto.
                </p>
              ) : (
                <>
                  <pre className="mono mb-3 whitespace-pre-wrap text-xs text-[var(--text-muted)]">
                    {stubs.signature}
                  </pre>

                  <div className="mb-2 flex flex-wrap gap-2">
                    {Object.keys(stubs.stubs).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStubLang(key)}
                        className="btn btn-sm"
                        style={{
                          background: stubLang === key ? 'var(--color-brand-600)' : 'transparent',
                          color: stubLang === key ? '#fff' : 'var(--text)',
                          borderColor:
                            stubLang === key ? 'var(--color-brand-600)' : 'var(--border-strong)',
                        }}
                      >
                        {languages.find((l) => l.key === key)?.label || key}
                      </button>
                    ))}
                  </div>

                  <pre className="io-block max-h-72 overflow-auto">
                    {stubs.stubs[stubLang] ?? stubs.stubs.python}
                  </pre>

                  <p className="hint">
                    A hidden driver reads each test case, calls{' '}
                    <code className="mono">{form.functionSpec.name || 'yourFunction'}</code>, and
                    prints what it returns. Students never write input parsing.
                  </p>
                </>
              )}
            </section>
          )}
        </div>
      )}

      {activeSection === 'cases' && (
        <div className="flex flex-col gap-3">
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
          >
            Mark one or two cases as <strong>visible samples</strong> so students know the exact I/O
            format. Those are also the only cases <strong>Run</strong> executes. Keep the rest
            hidden. Each case carries its own points, so passing some earns proportional marks.
            {isFunctionMode && (
              <>
                {' '}
                Write the arguments the way LeetCode shows them —{' '}
                <code className="mono">nums = [2,7,11,15], target = 9</code> — or as one value per
                line without the labels. Either is accepted, and students always see the labelled
                form. The expected output is the value your function returns, e.g.{' '}
                <code className="mono">[0,1]</code>. Strings are quoted:{' '}
                <code className="mono">&quot;abc&quot;</code>.
              </>
            )}
            {isClassMode && (
              <>
                {' '}
                Because this is a design problem, each case is <strong>two lines</strong> — the
                operations, then their arguments — and the expected value is one entry per
                operation. See the example next to the class definition.
              </>
            )}
          </div>

          {form.testCases.map((c, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b bg-[var(--surface-2)] px-4 py-2">
                <span className="text-xs font-bold">Case {i + 1}</span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={c.isSample}
                    onChange={(e) => setCase(i, { isSample: e.target.checked })}
                  />
                  Visible sample
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  Points
                  <input
                    type="number"
                    min={0}
                    className="input w-16 py-0.5 text-xs"
                    value={c.points}
                    onChange={(e) => setCase(i, { points: e.target.value })}
                  />
                </label>
                <button
                  className="ml-auto text-xs text-[var(--text-faint)] hover:text-[var(--bad)]"
                  onClick={() => removeCase(i)}
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                <div>
                  <label className="label">
                    {isFunctionMode ? 'Arguments, one JSON value per line' : 'Input (stdin)'}
                  </label>
                  <textarea
                    className="textarea"
                    rows={4}
                    value={c.input}
                    onChange={(e) => setCase(i, { input: e.target.value })}
                  />
                  {isClassMode && (
                    <p className="hint">
                      Line 1: the operations. Line 2: their arguments. The first operation is the
                      constructor.
                    </p>
                  )}
                  {isFunctionMode && (
                    <p className="hint">
                      {isLabelledInput(c, form) ? 'Labelled — ' : 'In order: '}
                      {form.functionSpec.params.map((p, pi) => (
                        <span key={pi}>
                          {pi > 0 && ', '}
                          <code className="mono">{p.name || `arg${pi + 1}`}</code> ({p.type})
                        </span>
                      ))}
                      {argCountMismatch(c, form) && (
                        <span className="ml-1 font-semibold" style={{ color: 'var(--warn)' }}>
                          {' '}
                          this case has {countArgLines(c)} line(s) but the signature takes{' '}
                          {form.functionSpec.params.length}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">
                    {isFunctionMode ? 'Expected return value (JSON)' : 'Expected output (stdout)'}
                  </label>
                  <textarea
                    className="textarea"
                    rows={4}
                    value={c.expectedOutput}
                    onChange={(e) => setCase(i, { expectedOutput: e.target.value })}
                  />
                  <p className="hint">Trailing spaces and newlines are ignored when comparing.</p>
                </div>
                {c.isSample && (
                  <div className="sm:col-span-2">
                    <label className="label">Explanation (shown with the sample)</label>
                    <input
                      className="input"
                      value={c.explanation}
                      onChange={(e) => setCase(i, { explanation: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => addCase(true)}>
              + Add visible sample
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => addCase(false)}>
              + Add hidden case
            </button>
          </div>

          {hiddenCount === 0 && form.testCases.length > 0 && (
            <p
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
            >
              Every case is visible. Students will be able to see all the data they are graded on,
              so add at least one hidden case.
            </p>
          )}
        </div>
      )}

      {activeSection === 'starter' && (
        <div className="card px-5 py-4">
          <h2 className="mb-1 text-sm font-bold">Starter code</h2>
          <p className="hint mb-3">
            Optional per-language stubs pre-filled into the editor, so students spend their time on
            the algorithm rather than on boilerplate I/O.
          </p>

          <div className="mb-3 flex flex-wrap gap-2">
            {languages.map((lang) => (
              <button
                key={lang.key}
                type="button"
                onClick={() => setStubLang(lang.key)}
                className="btn btn-sm"
                style={{
                  background: stubLang === lang.key ? 'var(--color-brand-600)' : 'transparent',
                  color: stubLang === lang.key ? '#fff' : 'var(--text)',
                  borderColor:
                    stubLang === lang.key ? 'var(--color-brand-600)' : 'var(--border-strong)',
                }}
              >
                {lang.label}
                {form.starterCode[lang.key]?.trim() ? ' *' : ''}
              </button>
            ))}
          </div>

          <div className="h-80 overflow-hidden rounded-lg border">
            <CodeEditor
              key={stubLang}
              language={languages.find((l) => l.key === stubLang)?.monaco || stubLang}
              value={form.starterCode[stubLang] ?? ''}
              onChange={(code) => set({ starterCode: { ...form.starterCode, [stubLang]: code } })}
            />
          </div>

          <button
            className="btn btn-ghost btn-sm mt-3"
            onClick={() =>
              set({
                starterCode: {
                  ...form.starterCode,
                  [stubLang]: languages.find((l) => l.key === stubLang)?.defaultStub || '',
                },
              })
            }
          >
            Use the default {stubLang} stub
          </button>
        </div>
      )}

      {activeSection === 'reference' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card px-5 py-4">
            <h2 className="mb-1 text-sm font-bold">Your reference solution</h2>
            <p className="hint mb-3">
              Used to check your expected outputs are right, and to generate outputs for new inputs.
              Students never see it, and it plays no part in grading.
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select
                className="select w-auto"
                value={form.referenceSolution.language}
                onChange={(e) => switchReferenceLanguage(e.target.value)}
              >
                {languages.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </select>

              {referenceStub && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    set({ referenceSolution: { ...form.referenceSolution, code: referenceStub } })
                  }
                >
                  Start from the template
                </button>
              )}
            </div>

            {/* The mistake this prevents: writing a whole program here, when
                the platform already supplies everything around the answer. The
                compiler's complaint is "duplicate class: Main", which explains
                nothing. */}
            {(isFunctionMode || isClassMode) && (
              <p
                className="mb-3 rounded-md px-3 py-2 text-xs"
                style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
              >
                Write this exactly as a student would — the same shape as the generated starter
                code. Do not add <code className="mono">main()</code> or{' '}
                <code className="mono">class Main</code>; the platform supplies those and calls your
                answer from them.
              </p>
            )}

            <div className="h-72 overflow-hidden rounded-lg border">
              <CodeEditor
                language={
                  languages.find((l) => l.key === form.referenceSolution.language)?.monaco ||
                  'python'
                }
                value={form.referenceSolution.code}
                onChange={(code) => set({ referenceSolution: { ...form.referenceSolution, code } })}
              />
            </div>

            <button
              className="btn btn-accent btn-sm mt-3"
              onClick={runReference}
              disabled={verify?.loading}
            >
              {verify?.loading ? <Spinner label="Running..." /> : 'Check against my test cases'}
            </button>
          </section>

          <div className="flex flex-col gap-4">
            {verify && !verify.loading && (
              <section className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b px-4 py-2.5">
                  <h2 className="text-sm font-bold">Reference check</h2>
                  <VerdictBadge verdict={verify.verdict} />
                  <span className="ml-auto text-xs text-[var(--text-muted)]">
                    {verify.passedCount} / {verify.totalCount} agree
                  </span>
                </div>
                <div className="max-h-72 divide-y overflow-y-auto">
                  {verify.results.map((r) => (
                    <div key={r.index} className="px-4 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`badge badge-${r.passed ? 'ok' : 'bad'}`}>
                          Case {r.index + 1}
                        </span>
                        {!r.passed && <span>{r.verdict}</span>}
                        <span className="ml-auto text-[var(--text-faint)]">{r.timeMs} ms</span>
                      </div>
                      {!r.passed && (
                        <div className="mt-1.5">
                          <p className="text-[0.68rem] font-semibold text-[var(--text-faint)]">
                            Your solution produced
                          </p>
                          <pre className="io-block">
                            {r.stdout || r.stderr || r.compileOutput || '(nothing)'}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {verify.passedCount !== verify.totalCount && (
                  <p className="border-t px-4 py-2 text-xs text-[var(--text-muted)]">
                    A mismatch means either your expected output or your reference solution is
                    wrong. Fix it before students sit the test.
                  </p>
                )}
              </section>
            )}

            <section className="card px-5 py-4">
              <h2 className="mb-1 text-sm font-bold">Generate cases from inputs</h2>
              <p className="hint mb-3">
                Paste inputs separated by a line containing <code className="mono">---</code>. Your
                reference solution runs on each one to produce the expected output. Review them,
                then save. Grading only ever uses what you approve.
              </p>
              <textarea
                className="textarea"
                rows={6}
                value={genInputs}
                onChange={(e) => setGenInputs(e.target.value)}
                placeholder={'5 7\n---\n-3 3\n---\n0 0'}
              />
              <button
                className="btn btn-ghost btn-sm mt-2"
                onClick={generateOutputs}
                disabled={verify?.loading}
              >
                Generate expected outputs
              </button>
            </section>
          </div>
        </div>
      )}

      {/* This form is long enough that the header's Save button is far
          off-screen by the time you reach the bottom of it. Everything that
          needs saving now saves itself, but the explicit control should still
          be within reach wherever you are. */}
      <div className="sticky bottom-0 z-30 -mx-4 mt-6 border-t bg-[var(--surface)]/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--text-muted)]">
            {isNew ? 'Not saved yet' : `Editing "${form.title || 'this question'}"`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => navigate('/teacher/questions')}
              disabled={saving}
            >
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? (
                <Spinner label="Saving…" />
              ) : isNew ? (
                'Create question'
              ) : (
                'Save changes'
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
