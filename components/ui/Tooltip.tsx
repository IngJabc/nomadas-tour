'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
  };

  const open = useCallback(() => {
    updatePosition();
    setShow(true);
  }, []);

  const close = useCallback(() => setShow(false), []);

  useEffect(() => {
    if (!show) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        tooltipRef.current && !tooltipRef.current.contains(target)
      ) {
        close();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [show, close]);

  useLayoutEffect(() => {
    if (!show || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const tooltipRect = el.getBoundingClientRect();
    const pad = 8;
    let x = pos.x;

    if (x - tooltipRect.width / 2 < pad) {
      x = tooltipRect.width / 2 + pad;
    } else if (x + tooltipRect.width / 2 > window.innerWidth - pad) {
      x = window.innerWidth - tooltipRect.width / 2 - pad;
    }

    if (x !== pos.x) {
      el.style.left = `${x}px`;
    }
  }, [show, pos.x]);

  return (
    <span
      ref={triggerRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onClick={(e) => { e.stopPropagation(); show ? close() : open(); }}
    >
      {children}
      {show && createPortal(
        <span
          ref={tooltipRef}
          className="pointer-events-none fixed px-2.5 py-1.5 rounded-lg bg-[var(--color-brand-navy)] text-white text-[11px] font-[family-name:var(--font-body)] font-medium whitespace-nowrap shadow-lg z-[9999]"
          style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }}
          role="tooltip"
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}
