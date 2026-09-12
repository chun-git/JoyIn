import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  children,
  onClose,
  initialFocus = 'safe',
  className = '',
  labelledById,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** 'safe' focuses the first non-danger control; 'first' focuses the first focusable. */
  initialFocus?: 'safe' | 'first';
  className?: string;
  labelledById?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const lockScroll = useCallback(() => {
    const { body } = document;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();

    const frame = window.requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (!root) return;
      const nodes = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (initialFocus === 'safe') {
        const safe =
          nodes.find((node) => !node.classList.contains('btn-danger') && !node.classList.contains('danger')) ??
          nodes[0];
        safe?.focus();
      } else {
        nodes[0]?.focus();
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      unlock();
      previouslyFocused.current?.focus?.();
    };
  }, [open, initialFocus, lockScroll]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal sheet-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById || titleId}
        onKeyDown={trapTab}
      >
        <h2 id={labelledById || titleId} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
