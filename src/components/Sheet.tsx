import { useEffect, useRef, type ReactNode } from 'react';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** test hook and accessible name */
  testId?: string;
}

/** Modal panel: bottom sheet on phones, centered card on wider screens. Closes on Escape and on backdrop tap. */
export function Sheet({ title, onClose, children, testId }: SheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose} data-testid={testId ? `${testId}-backdrop` : undefined}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} data-testid={testId} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="sheet-title">{title}</h2>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close" data-testid="sheet-close">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
