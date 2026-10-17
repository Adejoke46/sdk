/**
 * useAsync Hook
 *
 * Generic utility for managing async operation state (loading, error, data)
 * across SDK operations. Runs `fn` on mount and whenever `deps` change.
 * Automatically ignores resolutions that arrive after unmount or after a
 * dependency change, so no state is set on an unmounted or stale component.
 *
 * @param fn - Async function to execute.
 * @param deps - Optional dependency list; fn re-runs when deps change.
 * @returns { data, loading, error }
 *
 * @example
 * ```tsx
 * import { useAsync } from 'dorisio-sdk/react';
 *
 * function CreatorCard({ creatorId }: { creatorId: string }) {
 *   const { data: creator, loading, error } = useAsync(
 *     () => client.getCreator(creatorId),
 *     [creatorId]
 *   );
 *
 *   if (loading) return <p>Loading...</p>;
 *   if (error) return <p>Error: {error.message}</p>;
 *   return <p>{creator?.name}</p>;
 * }
 * ```
 */

import { useState, useEffect, useRef, type DependencyList } from 'react';

export interface UseAsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps?: DependencyList
): UseAsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let isCancelled = false;

    const execute = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fnRef.current();
        if (!isCancelled && !cancelledRef.current) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (!isCancelled && !cancelledRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    execute();

    return () => {
      isCancelled = true;
      cancelledRef.current = true;
    };
  }, deps ? Array.from(deps) : []);

  return { data, loading, error };
}
