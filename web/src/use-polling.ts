import { useEffect, useRef } from 'react';

/**
 * Lightweight visibility-aware polling.
 * - Pauses when document is hidden
 * - Refreshes immediately on resume
 * - Skips ticks while `pauseWhen` is true (e.g. dirty form)
 * - Aborts in-flight request on unmount / next tick
 */
export function usePolling(
  tick: (signal: AbortSignal) => Promise<void>,
  options: {
    intervalMs: number;
    enabled?: boolean;
    /** When true, timer keeps running but skips applying the tick. */
    pauseWhen?: boolean;
    consecutiveFailureHintAfter?: number;
    onConsecutiveFailures?: (failures: number) => void;
    onRecovered?: () => void;
  },
): void {
  const {
    intervalMs,
    enabled = true,
    pauseWhen = false,
    consecutiveFailureHintAfter = 3,
    onConsecutiveFailures,
    onRecovered,
  } = options;

  const tickRef = useRef(tick);
  const pauseRef = useRef(pauseWhen);
  const failRef = useRef(0);
  tickRef.current = tick;
  pauseRef.current = pauseWhen;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (delay: number) => {
      clearTimer();
      timer = setTimeout(() => {
        void run();
      }, delay);
    };

    const run = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule(intervalMs);
        return;
      }
      if (pauseRef.current) {
        schedule(intervalMs);
        return;
      }

      controller?.abort();
      controller = new AbortController();
      try {
        await tickRef.current(controller.signal);
        if (cancelled) return;
        if (failRef.current > 0) {
          failRef.current = 0;
          onRecovered?.();
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
          // ignore
        } else {
          failRef.current += 1;
          if (failRef.current >= consecutiveFailureHintAfter) {
            onConsecutiveFailures?.(failRef.current);
          }
        }
      }
      if (!cancelled) schedule(intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void run();
      } else {
        controller?.abort();
        clearTimer();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule(intervalMs);

    return () => {
      cancelled = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, consecutiveFailureHintAfter, onConsecutiveFailures, onRecovered]);
}
