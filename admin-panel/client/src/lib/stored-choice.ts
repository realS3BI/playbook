import { useSyncExternalStore } from "react";

// Choices are shared by every view on the page and kept in the browser.
const chosen = new Map<string, string | null>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function readChoice(key: string) {
  if (!chosen.has(key)) { try { chosen.set(key, localStorage.getItem(key)); } catch { chosen.set(key, null); } }
  return chosen.get(key)!;
}
export function useStoredChoice<T extends string>(key: string, choices: readonly T[], fallback: T) {
  const stored = useSyncExternalStore(subscribe, () => readChoice(key));
  const choose = (next: T) => {
    chosen.set(key, next);
    try { localStorage.setItem(key, next); } catch {}
    listeners.forEach(listener => listener());
  };
  return [choices.includes(stored as T) ? stored as T : fallback, choose] as const;
}
