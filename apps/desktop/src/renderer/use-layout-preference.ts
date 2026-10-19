import { useEffect, useState } from 'react';

export function useLayoutPreference(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try { const saved = localStorage.getItem(key); return saved === null ? initial : saved === 'true'; }
    catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, String(value)); } catch { /* Session controls still work without storage. */ }
  }, [key, value]);
  return [value, setValue] as const;
}
