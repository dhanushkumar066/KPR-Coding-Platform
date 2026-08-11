import { Link } from 'react-router-dom';

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)]"
        style={{ borderTopColor: 'var(--color-brand-500)' }}
      />
      {label}
    </div>
  );
}

export function PageLoader({ label }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({ title, body, action, icon }) {
  return (
    <div className="animate-fade-up card flex flex-col items-center gap-2 border-dashed px-6 py-14 text-center">
      {icon && (
        <div className="mb-1 grid h-12 w-12 place-items-center rounded-lg bg-[var(--surface-3)] text-[var(--text-faint)]">
          {icon}
        </div>
      )}
      <p className="text-base font-bold">{title}</p>
      {body && <p className="max-w-md text-sm text-[var(--text-muted)]">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="animate-fade-up card px-6 py-10 text-center">
      <div
        className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full"
        style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 8v5m0 3.5h.01M10.3 3.9 2.4 17.4A2 2 0 0 0 4.1 20.4h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="font-bold text-[var(--bad)]">Something went wrong</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">
        {error?.message || String(error)}
      </p>
      {onRetry && (
        <button className="btn btn-ghost mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link
            to={back.to}
            className="mb-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--color-brand-600)]"
          >
            <span aria-hidden="true">←</span> {back.label}
          </Link>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const VERDICT_TONE = {
  Accepted: 'ok',
  'Partially Accepted': 'warn',
  'Wrong Answer': 'bad',
  'Time Limit Exceeded': 'warn',
  'Runtime Error': 'bad',
  'Compile Error': 'bad',
  'Judge Error': 'muted',
  Pending: 'muted',
  // Not a real verdict — shown when a student runs their own input, where
  // "Accepted" would wrongly suggest the answer was checked.
  Ran: 'ok',
};

/**
 * Icons paired with every verdict.
 *
 * The design system forbids conveying status by colour alone — around 8% of men
 * cannot reliably separate the green "Accepted" from the red "Wrong Answer".
 */
const VERDICT_ICON = {
  ok: (
    <path
      d="M4 8.5 6.8 11 12 4.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  bad: (
    <path
      d="M4.5 4.5l7 7m0-7l-7 7"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  ),
  warn: (
    <path
      d="M8 4.5v4m0 2.2h.01"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  ),
  muted: (
    <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" fill="none" />
  ),
};

export function VerdictBadge({ verdict, className = '' }) {
  const tone = VERDICT_TONE[verdict] || 'muted';
  return (
    <span className={`badge badge-${tone} ${className}`}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {VERDICT_ICON[tone]}
      </svg>
      {verdict}
    </span>
  );
}

export function Stat({ label, value, tone }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
        {label}
      </p>
      <p
        className="mt-0.5 text-xl font-bold tabular-nums"
        style={tone ? { color: `var(--${tone})` } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, width = 'max-w-lg' }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className={`card w-full ${width} overflow-hidden`} style={{ boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-lg leading-none text-[var(--text-faint)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t bg-[var(--surface-2)] px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
