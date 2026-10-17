/**
 * useUser Hook
 *
 * Hook for user/fan profile operations with offline fallback support.
 */

import { useState, useCallback, useRef } from 'react';
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
  fetchUser: (userId: string, options?: { allowCached?: boolean }) => Promise<User | null>;
  fetchCurrentUser: (options?: { allowCached?: boolean }) => Promise<User | null>;
  updateUser: (userId: string, data: UpdateUserRequest) => Promise<User | null>;
  clearError: () => void;
}

/**
 * Hook for managing authenticated user profile, fan profile fetching, and profile updates.
 *
 * When a network request fails, the hook falls back to the most recently cached user data
 * (if `allowCached` is not `false`) and marks it with `isCached: true`. Successful online
 * fetches refresh the data and update the cache. Cache entries expire after `USER_CACHE_TTL_MS`.
 *
 * @returns State and action handlers for user operations
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
export function useUser(): UseUserState & UseUserActions {
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
    async (userId: string, options: { allowCached?: boolean } = {}): Promise<User | null> => {
      const allowCached = options.allowCached ?? true;
      const cacheKey = `user:${userId}`;
      setLoading(true);

      try {
        const response = await client.request('GET', `/users/${userId}`, undefined, {
          timeout: 10000,
        });

        if (response.success && response.data) {
          const user = response.data as User;
          setCached(cacheKey, user);
          setState((prev) => ({
            ...prev,
            user,
            isAuthenticated: true,
            isCached: false,
            error: null,
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
        setState((prev) => ({ ...prev, user: null, isAuthenticated: false, isCached: false }));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client, getCached, setCached, setError, setLoading]
  );

  const fetchCurrentUser = useCallback(
    async (options: { allowCached?: boolean } = {}): Promise<User | null> => {
      const allowCached = options.allowCached ?? true;
      const cacheKey = 'user:me';
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
            user,
            isAuthenticated: true,
            isCached: false,
            error: null,
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
        setState((prev) => ({ ...prev, user: null, isAuthenticated: false, isCached: false }));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client, getCached, setCached, setError, setLoading]
  );

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

  return {
    ...state,
    fetchUser,
    fetchCurrentUser,
    updateUser,
    clearError,
  };
}
