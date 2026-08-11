import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = 'info', ttl = 4500) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, message, tone }]);
      if (ttl) setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (m) => push(m, 'ok'),
      error: (m) => push(m, 'bad', 6500),
      warn: (m) => push(m, 'warn'),
      info: (m) => push(m, 'info'),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="card flex items-start gap-2 px-3 py-2 text-sm"
            style={{
              borderLeft: `3px solid var(--${t.tone === 'ok' ? 'ok' : t.tone === 'bad' ? 'bad' : t.tone === 'warn' ? 'warn' : 'info'})`,
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-[var(--text-faint)] hover:text-[var(--text)]"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};
