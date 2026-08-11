import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser-side detection for the anti-cheat system (§9).
 *
 * This hook only *detects and reports*. It never decides whether something
 * counts as a violation and it never terminates anything — the server does both
 * (non-negotiable #5). Everything shown to the student comes from the server's
 * reply, so a student who tampers with this file changes nothing but their own
 * warning banner.
 *
 * Fairness: a departure is timed. If the student comes back inside the grace
 * window the event is still reported (so the teacher sees it) but carries the
 * short duration, and the server forgives it. If they are still away once the
 * grace period elapses, the event is sent immediately so the live proctor feed
 * is not delayed until they return.
 */
export function useAntiCheat({ enabled, graceMs = 2500, onReport, onTerminated }) {
  const [lastEvent, setLastEvent] = useState(null);
  const awayRef = useRef(null); // { type, startedAt, sent }
  const enabledRef = useRef(enabled);
  const onReportRef = useRef(onReport);
  const onTerminatedRef = useRef(onTerminated);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    onReportRef.current = onReport;
    onTerminatedRef.current = onTerminated;
  }, [onReport, onTerminated]);

  const report = useCallback(async (type, durationMs = 0, meta = {}) => {
    if (!enabledRef.current) return null;
    // Show something the instant it happens; the server's verdict replaces it.
    setLastEvent({ type, at: Date.now(), pending: true });
    try {
      const result = await onReportRef.current?.({ type, durationMs, meta });
      if (result) {
        setLastEvent({ type, at: Date.now(), ...result });
        if (result.terminated) onTerminatedRef.current?.(result);
      }
      return result;
    } catch {
      return null;
    }
  }, []);

  /** Begins timing a departure of the given kind. */
  const beginAway = useCallback(
    (type) => {
      if (!enabledRef.current || awayRef.current) return;
      const entry = { type, startedAt: Date.now(), sent: false, timer: null };
      awayRef.current = entry;

      // Still gone once grace expires → report now so proctors see it live.
      entry.timer = setTimeout(() => {
        if (awayRef.current === entry && !entry.sent) {
          entry.sent = true;
          report(type, Date.now() - entry.startedAt, { stillAway: true });
        }
      }, graceMs + 100);
    },
    [graceMs, report]
  );

  const endAway = useCallback(() => {
    const entry = awayRef.current;
    if (!entry) return;
    awayRef.current = null;
    clearTimeout(entry.timer);
    if (!entry.sent) report(entry.type, Date.now() - entry.startedAt, { returned: true });
  }, [report]);

  // ---- Page Visibility + window focus ----
  useEffect(() => {
    if (!enabled) return undefined;

    // Switching tab or app blurs the window first, then hides the page. A
    // system overlay drawn *on top* of the page (Circle to Search, Windows
    // Click to Do, an assistant panel) hides it without the window ever losing
    // focus. That ordering is the only thing distinguishing them from here, so
    // the event is named for the observation, not for a guess at the product.
    let windowHasFocus = document.hasFocus();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        beginAway(windowHasFocus ? 'screen_overlay' : 'tab_switch');
      } else {
        endAway();
      }
    };
    const onBlur = () => {
      windowHasFocus = false;
      beginAway('window_blur');
    };
    const onFocus = () => {
      windowHasFocus = true;
      endAway();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    /*
     * Safety net for focus loss that never fired an event.
     *
     * A floating or always-on-top window — Android's floating apps, PowerToys
     * Always On Top, a picture-in-picture player, an assistant panel — can take
     * keyboard focus without the page reliably receiving `blur`, and leaves the
     * page "visible" the whole time so `visibilitychange` stays silent. Polling
     * `document.hasFocus()` catches the ones that took focus.
     *
     * What this cannot catch, and no browser API can: another app drawn *over*
     * the page that never takes focus. Nothing in the web platform reports
     * occlusion. That gap is real and is documented for teachers rather than
     * papered over.
     */
    const poll = setInterval(() => {
      const focused = document.hasFocus();
      if (!focused && windowHasFocus) {
        windowHasFocus = false;
        beginAway('focus_lost_silently');
      } else if (focused && !windowHasFocus) {
        windowHasFocus = true;
        endAway();
      }
    }, 1000);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, beginAway, endAway]);

  /*
   * A second screen, reported once when the exam opens.
   *
   * `screen.isExtended` needs no permission and is exactly where a floating
   * window of notes would live. It is not proof of anything on its own — plenty
   * of students have a monitor at home — so it is recorded for the teacher to
   * weigh rather than counted as a violation.
   */
  useEffect(() => {
    if (!enabled) return;
    if (typeof window.screen?.isExtended !== 'boolean') return;
    if (!window.screen.isExtended) return;
    report('second_screen', 0, { screens: 'extended' });
  }, [enabled, report]);

  // ---- Fullscreen ----
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  // Wall-clock moment fullscreen was lost, or null. Drives the countdown.
  const [fullscreenLostAt, setFullscreenLostAt] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const onChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);

      if (!active) {
        setFullscreenLostAt(Date.now());
        beginAway('fullscreen_exit');
      } else {
        setFullscreenLostAt(null);
        endAway();
        // Tells the server the deadline is cleared, and that fullscreen was
        // genuinely granted at least once.
        report('fullscreen_restored');
      }
    };

    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [enabled, beginAway, endAway, report]);

  const requestFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen?.();
      return true;
    } catch {
      // Browsers refuse fullscreen without a user gesture — the caller shows a prompt.
      return false;
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* nothing useful to do */
    }
  }, []);

  // ---- Editor restrictions: right-click, copy/cut/paste, selection ----
  useEffect(() => {
    if (!enabled) return undefined;

    const onContextMenu = (e) => {
      e.preventDefault();
      report('context_menu');
    };

    const isTypingField = (el) =>
      el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

    const onCopy = (e) => {
      // Copying the problem statement out is the thing worth blocking.
      if (isTypingField(e.target)) return;
      e.preventDefault();
      report('copy');
    };

    const onCut = (e) => {
      if (isTypingField(e.target)) return;
      e.preventDefault();
      report('cut' in e ? 'copy' : 'copy');
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
    };
  }, [enabled, report]);

  // ---- Screen capture and shortcut keys ----
  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (e) => {
      const key = (e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      // Windows snip (Win+Shift+S) and macOS capture (Cmd+Shift+3/4/5).
      if (e.shiftKey && e.metaKey && ['s', '3', '4', '5'].includes(key)) {
        report('snip_tool', 0, { combo: 'meta+shift+' + key });
        return;
      }
      if (mod && e.shiftKey && key === 's') {
        e.preventDefault();
        report('snip_tool', 0, { combo: 'ctrl+shift+s' });
        return;
      }

      if (mod && key === 'p') {
        e.preventDefault();
        report('print_attempt');
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        report('save_page_attempt');
        return;
      }
      if (mod && key === 'u') {
        e.preventDefault();
        report('view_source_attempt');
        return;
      }
      if (key === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c'].includes(key))) {
        e.preventDefault();
        report('devtools_suspected', 0, { key });
      }
    };

    // PrintScreen produces no keydown in Chrome on Windows — only keyup.
    const onKeyUp = (e) => {
      if ((e.key || '').toLowerCase() === 'printscreen') report('screenshot_key');
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [enabled, report]);

  /**
   * Called by the editor when a paste lands. Large pastes are the real signal,
   * but every paste is recorded with the question it happened in so the
   * submission can later be marked as containing pasted code.
   */
  const reportPaste = useCallback(
    (text, meta = {}) => {
      const length = (text || '').length;
      const lines = (text || '').split('\n').length;
      if (!length) return;
      const big = length >= 120 || lines >= 5;
      report(big ? 'large_paste' : 'paste', 0, { ...meta, length, lines });
    },
    [report]
  );

  return {
    lastEvent,
    isFullscreen,
    fullscreenLostAt,
    requestFullscreen,
    exitFullscreen,
    report,
    reportPaste,
  };
}
