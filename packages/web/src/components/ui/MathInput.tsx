'use client';

import { useState, useEffect, useRef } from 'react';
import { cn, evalMathExpr } from '@/lib/utils';

interface MathInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  step?: number | string;
  className?: string;
  inputMode?: 'decimal' | 'numeric';
}

const OPS = ['+', '\u2212', '\u00d7', '\u00f7'] as const;
const OP_MAP: Record<string, string> = { '+': '+', '\u2212': '-', '\u00d7': '*', '\u00f7': '/' };

/**
 * A number input that also accepts simple math expressions.
 * Users can type e.g. "150-32" and it evaluates to "118" on blur.
 * Operator buttons appear above the input on focus for mobile number pads.
 */
export function MathInput({ label, value, onChange, min, step, className, inputMode }: MathInputProps) {
  const [raw, setRaw] = useState(value);
  const [hasExpr, setHasExpr] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes
  useEffect(() => {
    setRaw(value);
    setHasExpr(false);
  }, [value]);

  function updateRaw(v: string) {
    setRaw(v);
    const isMath = /[+\-*/]/.test(v.replace(/^-/, ''));
    setHasExpr(isMath);
    if (!isMath) {
      onChange(v);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    updateRaw(e.target.value);
  }

  function handleBlur() {
    setFocused(false);
    if (hasExpr) {
      const result = evalMathExpr(raw);
      if (result != null) {
        const str = String(result);
        setRaw(str);
        onChange(str);
        setHasExpr(false);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && hasExpr) {
      e.preventDefault();
      handleBlur();
    }
  }

  function insertOp(displayOp: string) {
    const actualOp = OP_MAP[displayOp];
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? raw.length;
    const end = el.selectionEnd ?? raw.length;
    const next = raw.slice(0, start) + actualOp + raw.slice(end);
    updateRaw(next);
    // Restore cursor position after the inserted operator
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + 1;
      el.setSelectionRange(pos, pos);
    });
  }

  const inputId = label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      {/* Operator buttons — show when input is focused */}
      <div
        className={`flex gap-1.5 overflow-hidden transition-all duration-150 ${
          focused ? 'max-h-9 opacity-100 pb-1.5' : 'max-h-0 opacity-0 pb-0'
        }`}
      >
        {OPS.map((op) => (
          <button
            key={op}
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => {
              e.preventDefault();
              insertOp(op);
            }}
            className="flex-1 h-7 rounded-md bg-gray-100 dark:bg-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-gray-600 transition-colors"
          >
            {op}
          </button>
        ))}
      </div>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode={inputMode ?? 'decimal'}
          value={raw}
          onChange={handleChange}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          min={min}
          step={step}
          className={cn(
            'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder:text-gray-500',
            hasExpr && 'border-amber-400 dark:border-amber-500',
            className,
          )}
        />
        {hasExpr && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-amber-500 font-medium pointer-events-none">
            = {evalMathExpr(raw)?.toFixed(1) ?? '?'}
          </span>
        )}
      </div>
    </div>
  );
}
