import { useState } from 'react';

/**
 * The institute mark, used in the header and on the sign-in page.
 *
 * The artwork lives at `client/public/kpr-logo.png` so Vite serves it from the
 * site root in both dev and a production build. If it is ever missing or
 * renamed, this falls back to a plain "KPR" wordmark rather than the browser's
 * broken-image icon — a missing asset should not make the whole app look broken.
 */
export default function Logo({ size = 28, className = '' }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className={`grid place-items-center rounded-lg font-black text-white ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.34,
          background: 'var(--color-brand-600)',
        }}
        aria-label="KPR"
      >
        KPR
      </span>
    );
  }

  return (
    <img
      src="/kpr-logo.png"
      alt="KPR Institute of Engineering and Technology"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
