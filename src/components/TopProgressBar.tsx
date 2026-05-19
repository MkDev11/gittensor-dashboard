'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export default function TopProgressBar() {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastKey = useRef<string>('');

  useEffect(() => {
    const key = `${pathname}?${searchParams?.toString() ?? ''}`;
    if (lastKey.current === '') {
      lastKey.current = key;
      return;
    }
    if (lastKey.current === key) return;
    lastKey.current = key;

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    setVisible(true);
    setProgress(0.05);

    timersRef.current.push(setTimeout(() => setProgress(0.25), 50));
    timersRef.current.push(setTimeout(() => setProgress(0.55), 180));
    timersRef.current.push(setTimeout(() => setProgress(0.8), 380));
    timersRef.current.push(
      setTimeout(() => {
        setProgress(1);
        timersRef.current.push(
          setTimeout(() => {
            setVisible(false);
            setProgress(0);
          }, 220)
        );
      }, 600)
    );

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 99999,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 200ms',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${progress * 100}%`,
          background:
            'linear-gradient(90deg, var(--accent-emphasis) 0%, var(--accent-fg) 50%, var(--accent-emphasis) 100%)',
          backgroundSize: '200% 100%',
          boxShadow: '0 0 10px var(--accent-glow), 0 0 4px var(--accent-glow)',
          borderTopRightRadius: 2,
          borderBottomRightRadius: 2,
          transition: 'width 200ms ease',
          animation: visible ? 'gtBarShimmer 1.4s ease-in-out infinite' : 'none',
        }}
      />
    </div>
  );
}
