'use client';

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'gittensor.trackedRepos';

function repoKey(fullName: string): string {
  return fullName.trim().toLowerCase();
}

function dedupe(names: string[]): Set<string> {
  const byKey = new Map<string, string>();
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const key = repoKey(name);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, name);
  }
  return new Set(byKey.values());
}

function readStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return dedupe(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeStorage(set: Set<string>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  window.dispatchEvent(new Event('tracked-repos-changed'));
}

export function useTrackedRepos() {
  const [tracked, setTracked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setTracked(readStorage());
    const handler = () => setTracked(readStorage());
    window.addEventListener('tracked-repos-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('tracked-repos-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const toggle = useCallback((fullName: string) => {
    const key = repoKey(fullName);
    if (!key) return;
    const next = readStorage();
    const existing = Array.from(next).find((name) => repoKey(name) === key);
    if (existing) next.delete(existing);
    else next.add(fullName.trim());
    writeStorage(next);
  }, []);

  const clear = useCallback(() => writeStorage(new Set()), []);

  const setMany = useCallback((names: string[]) => writeStorage(dedupe(names)), []);

  return { tracked, toggle, clear, setMany };
}

export function isTracked(set: Set<string>, fullName: string): boolean {
  const key = repoKey(fullName);
  if (!key) return false;
  for (const name of set) {
    if (repoKey(name) === key) return true;
  }
  return false;
}
