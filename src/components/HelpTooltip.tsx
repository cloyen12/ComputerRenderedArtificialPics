import { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface HelpTooltipProps {
  title: string;
  what: string;
  why: string;
}

export function HelpTooltip({ title, what, why }: HelpTooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const open = hovered || pinned;

  useEffect(() => {
    if (!pinned) return;
    function handleOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPinned(false);
        setHovered(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPinned(false);
        setHovered(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [pinned]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={`Ayuda sobre ${title}`}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-emerald-500 ${
          open ? 'text-emerald-300' : 'text-slate-400 hover:text-emerald-300'
        }`}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute top-full left-1/2 z-50 mt-2 w-64 -translate-x-1/2 rounded-lg border border-slate-700 bg-[#0B0F17] p-3 text-left shadow-xl"
        >
          <p className="text-[11px] font-semibold text-slate-100">{title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            <span className="font-medium text-emerald-400">Qué es:</span> {what}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            <span className="font-medium text-slate-200">Por qué ajustarlo:</span> {why}
          </p>
        </div>
      )}
    </span>
  );
}
