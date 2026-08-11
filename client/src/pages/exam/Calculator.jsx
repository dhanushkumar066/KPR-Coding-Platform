import { useCallback, useEffect, useRef, useState } from 'react';
import * as calc from '../../lib/calculator.js';

/**
 * The on-screen scientific calculator, as GATE gives candidates.
 *
 * Draggable, because it is useless if it covers the question it is meant to
 * help with — and in fullscreen a student cannot move it out of the way any
 * other way. It opens at the bottom-right, clear of the question pane.
 *
 * The arithmetic lives in lib/calculator.js and is tested separately
 * (`npm run verify:calculator`). Nothing here computes anything.
 */

const KEYS = [
  // [label, action, className, title]
  ['sin', ['unary', 'sin']], ['cos', ['unary', 'cos']], ['tan', ['unary', 'tan']],
  ['MC', ['memory', 'MC']], ['MR', ['memory', 'MR']], ['M+', ['memory', 'M+']],

  ['sin⁻¹', ['unary', 'asin']], ['cos⁻¹', ['unary', 'acos']], ['tan⁻¹', ['unary', 'atan']],
  ['MS', ['memory', 'MS']], ['M−', ['memory', 'M-']], ['n!', ['unary', 'fact']],

  ['x²', ['unary', 'sqr']], ['x³', ['unary', 'cube']], ['xʸ', ['operator', '^']],
  ['√', ['unary', 'sqrt']], ['1/x', ['unary', 'inv']], ['|x|', ['unary', 'abs']],

  ['log', ['unary', 'log']], ['ln', ['unary', 'ln']], ['eˣ', ['unary', 'exp']],
  ['10ˣ', ['unary', 'pow10']], ['π', ['constant', 'pi']], ['e', ['constant', 'e']],
];

const PAD = [
  ['7', ['digit', '7']], ['8', ['digit', '8']], ['9', ['digit', '9']], ['÷', ['operator', '/']],
  ['4', ['digit', '4']], ['5', ['digit', '5']], ['6', ['digit', '6']], ['×', ['operator', '*']],
  ['1', ['digit', '1']], ['2', ['digit', '2']], ['3', ['digit', '3']], ['−', ['operator', '-']],
  ['0', ['digit', '0']], ['.', ['dot']], ['±', ['negate']], ['+', ['operator', '+']],
];

export default function Calculator({ onClose }) {
  const [state, setState] = useState(calc.initialState);
  const [pos, setPos] = useState(null);
  const dragRef = useRef(null);
  const panelRef = useRef(null);

  const dispatch = useCallback((action, value) => {
    setState((s) => {
      switch (action) {
        case 'digit': return calc.digit(s, value);
        case 'dot': return calc.dot(s);
        case 'operator': return calc.operator(s, value);
        case 'equals': return calc.equals(s);
        case 'unary': return calc.unary(s, value);
        case 'negate': return calc.negate(s);
        case 'constant': return calc.constant(s, value);
        case 'memory': return calc.memory(s, value);
        case 'backspace': return calc.backspace(s);
        case 'clear': return calc.clearAll(s);
        case 'clearEntry': return calc.clearEntry(s);
        case 'angle': return calc.setAngle(s, value);
        default: return s;
      }
    });
  }, []);

  /*
   * The number pad works while the calculator has focus.
   *
   * Deliberately scoped to this panel rather than the window: the student is
   * usually typing code, and swallowing their digits into a calculator they
   * are not looking at would be maddening.
   */
  const onKeyDown = (e) => {
    const mapped = calc.keyToAction(e.key);
    if (!mapped) return;
    e.preventDefault();
    dispatch(mapped.type, mapped.value);
  };

  // Dragging, in viewport coordinates so fullscreen behaves the same as not.
  useEffect(() => {
    const move = (e) => {
      if (!dragRef.current) return;
      const { dx, dy } = dragRef.current;
      const w = panelRef.current?.offsetWidth || 300;
      const h = panelRef.current?.offsetHeight || 420;
      setPos({
        // Kept on screen: a panel dragged off the edge in fullscreen cannot be
        // retrieved without reloading, which would cost the student their place.
        left: Math.min(Math.max(0, e.clientX - dx), window.innerWidth - w),
        top: Math.min(Math.max(0, e.clientY - dy), window.innerHeight - h),
      });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const startDrag = (e) => {
    const r = panelRef.current.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    if (!pos) setPos({ left: r.left, top: r.top });
    e.preventDefault();
  };

  const key = (label, [action, value], extra = '') => (
    <button
      key={label}
      onClick={() => dispatch(action, value)}
      className={`rounded-md border py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--surface-3)] ${extra}`}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={panelRef}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      role="dialog"
      aria-label="Scientific calculator"
      className="fixed z-50 w-[19rem] rounded-lg border shadow-xl"
      style={{
        background: 'var(--surface-2)',
        ...(pos ? { left: pos.left, top: pos.top } : { right: '1.5rem', bottom: '5rem' }),
      }}
    >
      <div
        onMouseDown={startDrag}
        className="flex cursor-move items-center gap-2 rounded-t-lg border-b px-3 py-2"
        style={{ background: 'var(--surface-3)' }}
      >
        <span className="text-xs font-bold">Calculator</span>
        <span className="text-[0.65rem] text-[var(--text-faint)]">drag to move</span>
        <button
          onClick={onClose}
          className="ml-auto rounded px-1.5 text-[var(--text-faint)] hover:text-[var(--text)]"
          aria-label="Close the calculator"
        >
          ✕
        </button>
      </div>

      {/* ------------------------------------------------------------ screen */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between text-[0.65rem] text-[var(--text-faint)]">
          <span className="mono truncate">{state.history}</span>
          {state.memory !== 0 && <span className="badge badge-muted">M</span>}
        </div>
        <div
          className="mono truncate text-right text-2xl font-bold"
          style={{ color: state.error ? 'var(--bad)' : 'var(--text)' }}
          aria-live="polite"
        >
          {state.display}
        </div>
        {state.error && (
          <p className="text-right text-[0.65rem]" style={{ color: 'var(--bad)' }}>
            {state.error}
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------ angle */}
      <div className="flex items-center gap-1 px-3 pb-2">
        {['deg', 'rad'].map((a) => (
          <button
            key={a}
            onClick={() => dispatch('angle', a)}
            className="rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase"
            style={{
              background: state.angle === a ? 'var(--color-brand-600)' : 'transparent',
              color: state.angle === a ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${state.angle === a ? 'var(--color-brand-600)' : 'var(--border)'}`,
            }}
          >
            {a}
          </button>
        ))}
        <span className="ml-auto text-[0.6rem] text-[var(--text-faint)]">
          angles in {state.angle === 'deg' ? 'degrees' : 'radians'}
        </span>
      </div>

      <div className="grid grid-cols-6 gap-1 px-3 pb-2">
        {KEYS.map(([label, action]) => key(label, action))}
      </div>

      <div className="grid grid-cols-3 gap-1 px-3 pb-1">
        <button
          onClick={() => dispatch('clear')}
          className="rounded-md border py-1.5 text-xs font-bold"
          style={{ background: 'var(--bad-bg)', color: 'var(--bad)', borderColor: 'var(--bad)' }}
        >
          C
        </button>
        {key('CE', ['clearEntry'])}
        {key('⌫', ['backspace'])}
      </div>

      <div className="grid grid-cols-4 gap-1 px-3 pb-3">
        {PAD.map(([label, action]) => key(label, action))}
        <button
          onClick={() => dispatch('equals')}
          className="col-span-4 rounded-md py-1.5 text-xs font-bold text-white"
          style={{ background: 'var(--color-brand-600)' }}
        >
          =
        </button>
      </div>
    </div>
  );
}
