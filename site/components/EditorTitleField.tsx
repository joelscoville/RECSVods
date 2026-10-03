import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** A full-width, wrapping title. Each completed editing session is one undo step. */
export default function EditorTitleField({ value, label, inputRef, onCommit, onExit, onSelect }: {
  value: string; label: string; inputRef: RefObject<HTMLTextAreaElement | null>;
  onCommit: (value: string) => void; onExit: () => void; onSelect: () => void;
}) {
  const [draft, setDraft] = useState<string>();
  const cancelled = useRef(false);
  const text = draft ?? value;
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    const fit = () => { element.style.height = '0px'; element.style.height = `${element.scrollHeight + 2}px`; };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (width !== element.clientWidth) { width = element.clientWidth; fit(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, inputRef]);
  return <label className="ce-field"><span className="ce-label">{label}</span>
    <textarea ref={inputRef} className="ce-title-input" rows={1} value={text}
      onFocus={() => { cancelled.current = false; setDraft(value); onSelect(); }}
      onChange={event => setDraft(event.target.value.replace(/\n/g, ' '))}
      onBlur={() => { if (!cancelled.current && draft !== undefined && draft !== value) onCommit(draft); setDraft(undefined); }}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); onExit(); }
        if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; setDraft(undefined); event.currentTarget.blur(); onExit(); }
      }} />
  </label>;
}
