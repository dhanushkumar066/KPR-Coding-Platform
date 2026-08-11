import { useEffect, useRef, useState } from 'react';

/**
 * A display-only countdown. The server owns the real deadline and ends the
 * attempt itself — this just keeps the number on screen moving between
 * heartbeats, and re-syncs whenever the server tells us the true remaining time.
 */
export function useCountdown(remainingMs) {
  const [msLeft, setMsLeft] = useState(remainingMs ?? 0);
  const targetRef = useRef(Date.now() + (remainingMs ?? 0));

  useEffect(() => {
    if (remainingMs == null) return;
    targetRef.current = Date.now() + remainingMs;
    setMsLeft(remainingMs);
  }, [remainingMs]);

  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft(Math.max(0, targetRef.current - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return msLeft;
}
