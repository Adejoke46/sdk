/**
 * useCreator Hook
 *
 * Hook for creator-related operations.
 */

import { useState, useCallback, useDebugValue } from 'react';
import {
  Creator,
  CreatorProfile,
  CreateCreatorRequest,
  UpdateCreatorRequest,
} from '../types/models';
import { ApiError } from '../types/errors';
import { useDorisio } from './DorisioProvider';
import { formatDebugValue } from './debug-format';

interface UseCreatorState {
  creator: Creator | null;
  profile: CreatorProfile | null;
  loading: boolean;
  error: ApiError | null;
}

interface UseCreatorActions {
  fetchCreator: (creatorId: string) => Creator | null | Promise<Creator | null>;
  fetchProfile: (username: string) => CreatorProfile | null | Promise<CreatorProfile | null>;
  createCreator: (data: CreateCreatorRequest) => Promise<Creator | null>;
  updateCreator: (creatorId: string, data: UpdateCreatorRequest) => Promise<Creator | null>;
  clearError: () => void;
}

export interface UseCreatorOptions {
  useSuspense?: boolean;
}

interface CreatorSuspenseEntry {
  data: Creator | null;
  promise: Promise<Creator | null>;
  resolved: boolean;
}

const creatorSuspenseCache = new Map<string, CreatorSuspenseEntry>();

/**
 * @returns State and action handlers for creator operations
 *
 * @debugValue Displays `{ loading, error, creator, profile }` in React DevTools.
 *   - `loading` (boolean): whether a request is in flight
 *   - `error` (string | null): last error message, if any
 *   - `creator` (object | null): { id, username } of the current creator, or null
 *   - `profile` (object | null): { username, bio } of the creator profile, or null
 *
 * @example
 * ```tsx
 * import { useCreator } from 'dorisio-sdk/react';
 *
 * function CreatorProfileView({ creatorId }: { creatorId: string }) {
 *   const { creator, loading, error, fetchCreator } = useCreator();
 *
 *   useEffect(() => {
 *     fetchCreator(creatorId);
 *   }, [creatorId, fetchCreator]);
 *
 *   if (loading) return <div>Loading creator...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!creator) return null;
 *
 *   return (
 *     <div>
 *       <h1>{creator.name}</h1>
 *       <p>{creator.bio}</p>
 *       {creator.verified && <span>Verified</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export { creatorSuspenseCache };

export function useCreator(options: UseCreatorOptions = {}): UseCreatorState & UseCreatorActions {
  const { useSuspense = false } = options;
  const { client, setError: setParentError } = useDorisio();
  const [state, setState] = useState<UseCreatorState>({
    creator: null,
    profile: null,
    loading: false,
    error: null,
  });

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: ApiError | null) => {
    setState((prev) => ({ ...prev, error }));
    if (error && setParentError) {
      setParentError({ message: error.message, code: error.code || 'CREATOR_ERROR' });
    }
  }, [setParentError]);

  const fetchCreator = useCallback(
    (creatorId: string): Creator | null | Promise<Creator | null> => {
      if (useSuspense) {
        const cached = creatorSuspenseCache.get(creatorId);
        if (cached?.resolved) {
          return cached.data;
        }
        if (cached?.promise && !cached.resolved) {
          throw cached.promise;
        }

        const responsePromise = client.request('GET', `/creators/${creatorId}`, undefined, {
          timeout: 10000,
        });
        const entry: CreatorSuspenseEntry = {
          data: null,
          promise: null as unknown as Promise<Creator | null>,
          resolved: false,
        };
        const dataPromise = responsePromise.then(
          (response) => {
            const data = response.success && response.data ? (response.data as Creator) : null;
            entry.resolved = true;
            entry.data = data;
            return data;
          },
          () => {
            entry.resolved = true;
            entry.data = null;
            return null;
          }
        );
        entry.promise = dataPromise;
        creatorSuspenseCache.set(creatorId, entry);
        throw dataPromise;
      }

      return (async () => {
        setLoading(true);
        setError(null);

        try {
          const response = await client.request('GET', `/creators/${creatorId}`, undefined, {
            timeout: 10000,
          });

          if (response.success && response.data) {
            setState((prev) => ({
              ...prev,
              creator: response.data as Creator,
            }));
            return response.data as Creator;
          }

          return null;
        } catch (err) {
          const error = err as ApiError;
          setError(error);
          return null;
        } finally {
          setLoading(false);
        }
      })();
    },
    [client, setError, setLoading, useSuspense]
  );

  const fetchProfile = useCallback(
    (username: string): CreatorProfile | null | Promise<CreatorProfile | null> => {
      if (useSuspense) {
        const cached = creatorSuspenseCache.get(`profile:${username}`);
        if (cached?.resolved) {
          return cached.data as CreatorProfile | null;
        }
        if (cached?.promise && !cached.resolved) {
          throw cached.promise;
        }

        const responsePromise = client.request('GET', `/creators/profile/${username}`, undefined, {
          timeout: 10000,
        });
        const entry: CreatorSuspenseEntry = {
          data: null,
          promise: null as unknown as Promise<CreatorProfile | null>,
          resolved: false,
        };
        const dataPromise = responsePromise.then(
          (response) => {
            const data = response.success && response.data ? (response.data as CreatorProfile) : null;
            entry.resolved = true;
            entry.data = data;
            return data;
          },
          () => {
            entry.resolved = true;
            entry.data = null;
            return null;
          }
        );
        entry.promise = dataPromise;
        creatorSuspenseCache.set(`profile:${username}`, entry);
        throw dataPromise;
      }

      return (async () => {
        setLoading(true);
        setError(null);

        try {
          const response = await client.request('GET', `/creators/profile/${username}`, undefined, {
            timeout: 10000,
          });

          if (response.success && response.data) {
            setState((prev) => ({
              ...prev,
              profile: response.data as CreatorProfile,
            }));
            return response.data as CreatorProfile;
          }

          return null;
        } catch (err) {
          const error = err as ApiError;
          setError(error);
          return null;
        } finally {
          setLoading(false);
        }
      })();
    },
    [client, setError, setLoading, useSuspense]
  );

  const createCreator = useCallback(
    async (data: CreateCreatorRequest): Promise<Creator | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await client.request('POST', '/creators', data, {
          timeout: 15000,
        });

        if (response.success && response.data) {
          setState((prev) => ({
            ...prev,
            creator: response.data as Creator,
          }));
          return response.data as Creator;
        }

        return null;
      } catch (err) {
        const error = err as ApiError;
        setError(error);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client, setError, setLoading]
  );

  const updateCreator = useCallback(
    async (creatorId: string, data: UpdateCreatorRequest): Promise<Creator | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await client.request('PATCH', `/creators/${creatorId}`, data, {
          timeout: 15000,
        });

        if (response.success && response.data) {
          setState((prev) => ({
            ...prev,
            creator: response.data as Creator,
          }));
          return response.data as Creator;
        }

        return null;
      } catch (err) {
        const error = err as ApiError;
        setError(error);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client, setError, setLoading]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, [setError]);

  useDebugValue(
    formatDebugValue({
      loading: state.loading,
      error: state.error?.message ?? null,
      creator: state.creator ? { id: state.creator.id, username: state.creator.username } : null,
      profile: state.profile ? { username: state.profile.username, bio: state.profile.bio } : null,
    })
  );

  return {
    ...state,
    fetchCreator,
    fetchProfile,
    createCreator,
    updateCreator,
    clearError,
  };
}
