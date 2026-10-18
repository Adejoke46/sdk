/**
 * useUser Hook
 *
 * Hook for user/fan profile operations with offline fallback support.
 */

import { useState, useCallback, useDebugValue } from 'react';
import { formatDebugValue } from './debug-format';
import { User, UserProfile, UpdateUserRequest } from '../types/models';
import { ApiError } from '../types/errors';
import { useDorisio } from './DorisioProvider';

/** Time-to-live for cached user data (5 minutes). Respected on every cache read. */
export const USER_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedUser {
  user: User;
  fetchedAt: number;
}

interface UseUserState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: ApiError | null;
  isAuthenticated: boolean;
  /** True when the currently displayed user was served from the offline cache. */
  isCached: boolean;
}

interface UseUserActions {
  fetchUser: (userId: string) => User | null | Promise<User | null>;
  fetchCurrentUser: () => User | null | Promise<User | null>;
  updateUser: (userId: string, data: UpdateUserRequest) => Promise<User | null>;
  clearError: () => void;
}

export interface UseUserOptions {
  useSuspense?: boolean;
}

interface UserSuspenseEntry {
  data: User | null;
  promise: Promise<User | null>;
  resolved: boolean;
}

const userSuspenseCache = new Map<string, UserSuspenseEntry>();

/**
 * Hook for managing authenticated user profile, fan profile fetching, and profile updates.
 *
 * When a network request fails, the hook falls back to the most recently cached user data
 * (if `allowCached` is not `false`) and marks it with `isCached: true`. Successful online
 * fetches refresh the data and update the cache. Cache entries expire after `USER_CACHE_TTL_MS`.
 *
 * @returns State and action handlers for user operations
 *
 * @debugValue Displays `{ loading, error, user, isAuthenticated }` in React DevTools.
 *   - `loading` (boolean): whether a request is in flight
 *   - `error` (string | null): last error message, if any
 *   - `user` (object | null): { id, name } of the current user, or null
 *   - `isAuthenticated` (boolean): whether the user is authenticated
 *
 * @example
 * ```tsx
 * import { useUser } from 'dorisio-sdk/react';
 *
 * function UserProfileCard() {
 *   const { user, loading, error, isCached, fetchCurrentUser } = useUser();
 *
 *   useEffect(() => {
 *     fetchCurrentUser();
 *   }, [fetchCurrentUser]);
 *
 *   if (loading) return <p>Loading profile...</p>;
 *   if (error && !isCached) return <p className="error">{error.message}</p>;
 *   if (!user) return <p>Please log in.</p>;
 *
 *   return (
 *     <div>
 *       {isCached && <span>Offline cache</span>}
 *       <h3>{user.name}</h3>
 *       <p>{user.email}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export { userSuspenseCache };

export function useUser(options: UseUserOptions = {}): UseUserState & UseUserActions {
  const { useSuspense = false } = options;
  const { client, setError: setParentError } = useDorisio();
  const [state, setState] = useState<UseUserState>({
    user: null,
    profile: null,
    loading: false,
    error: null,
    isAuthenticated: false,
    isCached: false,
  });

  // Per-instance offline cache keyed by cache key. Respects TTL on every read.
  const cacheRef = useRef<Map<string, CachedUser>>(new Map());

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: ApiError | null) => {
    setState((prev) => ({ ...prev, error }));
    if (error && setParentError) {
      setParentError({ message: error.message, code: error.code || 'USER_ERROR' });
    }
  }, [setParentError]);

  const getCached = useCallback((cacheKey: string): User | null => {
    const entry = cacheRef.current.get(cacheKey);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > USER_CACHE_TTL_MS) {
      cacheRef.current.delete(cacheKey);
      return null;
    }
    return entry.user;
  }, []);

  const setCached = useCallback((cacheKey: string, user: User) => {
    cacheRef.current.set(cacheKey, { user, fetchedAt: Date.now() });
  }, []);

  const fetchUser = useCallback(
    (userId: string): User | null | Promise<User | null> => {
      if (useSuspense) {
        const cached = userSuspenseCache.get(userId);
        if (cached?.resolved) {
          return cached.data;
        }
        if (cached?.promise && !cached.resolved) {
          throw cached.promise;
        }

        const responsePromise = client.request('GET', `/users/${userId}`, undefined, {
          timeout: 10000,
        });
        const entry: UserSuspenseEntry = {
          data: null,
          promise: null as unknown as Promise<User | null>,
          resolved: false,
        };
        const dataPromise = responsePromise.then(
          (response) => {
            const data = response.success && response.data ? (response.data as User) : null;
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
        userSuspenseCache.set(userId, entry);
        throw dataPromise;
      }

      return (async () => {
        setLoading(true);
        setError(null);

        try {
          const response = await client.request('GET', `/users/${userId}`, undefined, {
            timeout: 10000,
          });

          if (response.success && response.data) {
            setState((prev) => ({
              ...prev,
              user: response.data as User,
            }));
            return response.data as User;
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

  const fetchCurrentUser = useCallback((): User | null | Promise<User | null> => {
    if (useSuspense) {
      const cached = userSuspenseCache.get('current');
      if (cached?.resolved) {
        return cached.data;
      }
      if (cached?.promise && !cached.resolved) {
        throw cached.promise;
      }

      const responsePromise = client.request('GET', '/users/me', undefined, {
        timeout: 10000,
      });
      const entry: UserSuspenseEntry = {
        data: null,
        promise: null as unknown as Promise<User | null>,
        resolved: false,
      };
      const dataPromise = responsePromise.then(
        (response) => {
          const data = response.success && response.data ? (response.data as User) : null;
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
      userSuspenseCache.set('current', entry);
      throw dataPromise;
    }

    return (async () => {
      setLoading(true);

      try {
        const response = await client.request('GET', '/users/me', undefined, {
          timeout: 10000,
        });

        if (response.success && response.data) {
          const user = response.data as User;
          setCached(cacheKey, user);
          setState((prev) => ({
            ...prev,
            user: response.data as User,
            isAuthenticated: true,
          }));
          return user;
        }

        return null;
      } catch (err) {
        const error = err as ApiError;

        if (allowCached) {
          const cached = getCached(cacheKey);
          if (cached) {
            setState((prev) => ({
              ...prev,
              user: cached,
              isAuthenticated: true,
              isCached: true,
              error: null,
            }));
            return cached;
          }
        }

        setError(error);
        setState((prev) => ({ ...prev, isAuthenticated: false }));
        return null;
      } finally {
        setLoading(false);
      }
    })();
  }, [client, setError, setLoading, useSuspense]);

  const updateUser = useCallback(
    async (userId: string, data: UpdateUserRequest): Promise<User | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await client.request('PATCH', `/users/${userId}`, data, {
          timeout: 15000,
        });

        if (response.success && response.data) {
          const user = response.data as User;
          setCached(`user:${userId}`, user);
          setState((prev) => ({
            ...prev,
            user,
            isAuthenticated: true,
            isCached: false,
          }));
          return user;
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
    [client, setError, setLoading, setCached]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, [setError]);

  useDebugValue(
    formatDebugValue({
      loading: state.loading,
      error: state.error?.message ?? null,
      user: state.user ? { id: state.user.id, name: state.user.name } : null,
      isAuthenticated: state.isAuthenticated,
    })
  );

  return {
    ...state,
    fetchUser,
    fetchCurrentUser,
    updateUser,
    clearError,
  };
}
