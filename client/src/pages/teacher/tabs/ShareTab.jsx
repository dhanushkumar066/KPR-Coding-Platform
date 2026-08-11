import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { formatDateTime } from '../../../lib/format.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { ErrorState, PageLoader } from '../../../components/ui.jsx';

/**
 * A link and QR code the teacher can hand out.
 *
 * The page is emphatic that this is a shortcut, not a key — access is still
 * decided by sign-in + allowlist + schedule (non-negotiable #6). A teacher who
 * believes the link is the security boundary will hand it out carelessly.
 */
export default function ShareTab({ test }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/tests/${test._id}/share`);
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  }, [test._id]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Could not copy — select the text and copy manually');
    }
  };

  if (state.loading) return <PageLoader label="Preparing the link…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const { url, qrDataUrl, published, allowlistCount, originDerived } = state.data;

  // A link nobody else can reach is the one failure mode a teacher will not
  // notice until a hall full of students has already scanned the QR.
  const localOnly = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

  const instructions = [
    `${test.title}`,
    ``,
    `Open: ${url}`,
    `Sign in with your college Google account.`,
    `Opens: ${formatDateTime(test.startAt)}`,
    `Closes: ${formatDateTime(test.endAt)}`,
    `You have ${test.durationMinutes} minutes once you start.`,
  ].join('\n');

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        {localOnly && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}
          >
            <p className="font-bold">This link only works on this computer.</p>
            <p className="mt-1">
              It points at <code className="mono">localhost</code>, which every other device reads
              as <em>itself</em>. Nobody you send it to will reach the test. Set{' '}
              <code className="mono">CLIENT_ORIGIN</code> in <code className="mono">server/.env</code>{' '}
              to the address students actually use — then reload this page.
            </p>
          </div>
        )}

        {!localOnly && originDerived && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
          >
            <p className="font-bold">Check this address before you print it.</p>
            <p className="mt-1">
              <code className="mono">CLIENT_ORIGIN</code> is not set, so this was taken from the
              address <em>you</em> opened. It is right if that is how students reach the site too —
              set <code className="mono">CLIENT_ORIGIN</code> to be certain.
            </p>
          </div>
        )}

        {!published && (
          <p
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
          >
            This test is a draft. The link works, but students will be turned away until you publish
            it.
          </p>
        )}

        <section className="card px-5 py-4">
          <h2 className="mb-1 text-sm font-bold">Test link</h2>
          <p className="hint mb-3">
            Share this however you like — chat, email, the projector. It opens this test directly.
          </p>

          <div className="flex flex-wrap gap-2">
            <input className="input mono flex-1" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button className="btn btn-primary" onClick={() => copy(url, 'Link')}>
              Copy link
            </button>
          </div>

          <div className="mt-4">
            <p className="label">Ready-to-paste instructions</p>
            <textarea className="textarea" rows={7} readOnly value={instructions} />
            <button
              className="btn btn-ghost btn-sm mt-2"
              onClick={() => copy(instructions, 'Instructions')}
            >
              Copy instructions
            </button>
          </div>
        </section>

        <section
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
        >
          <p className="font-semibold">The link is not a password.</p>
          <p className="mt-1">
            Anyone who opens it still has to sign in with a Google account on this test&apos;s
            allowlist ({allowlistCount} student{allowlistCount === 1 ? '' : 's'}), inside the
            scheduled window. If it leaks, nobody extra gets in — so you can put the QR on a
            projector without worrying.
          </p>
        </section>
      </div>

      <section className="card px-5 py-4 text-center">
        <h2 className="mb-3 text-sm font-bold">QR code</h2>
        <img
          src={qrDataUrl}
          alt={`QR code linking to ${test.title}`}
          className="mx-auto w-full max-w-[240px] rounded-lg border bg-white p-2"
        />
        <p className="hint mt-2">Put this on the projector or the handout.</p>

        <div className="mt-3 flex flex-col gap-2">
          <a
            className="btn btn-ghost btn-sm"
            href={qrDataUrl}
            download={`${test.title.replace(/[^\w\d-]+/g, '_').slice(0, 60)}_qr.png`}
          >
            Download PNG
          </a>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </section>
    </div>
  );
}
