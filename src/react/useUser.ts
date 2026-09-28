/**
 * useUser Hook
 *
 * Hook for user/fan profile operations.
 */

import { useState, useCallback } from 'react';
import { User, UserProfile, UpdateUserRequest } from '../types/models';
import { ApiError } from '../types/errors';
import { useDorisio } from './DorisioProvider';

interface UseUserState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: ApiError | null;
  isAuthenticated: boolean;
}

interface UseUserActions {
  fetchUser: (userId: string) => Promise<User | null>;
  fetchCurrentUser: () => Promise<User | null>;
  updateUser: (userId: string, data: UpdateUserRequest) => Promise<User | null>;
  clearError: () => void;
}

/**
 * Hook for managing authenticated user profile, fan profile fetching, and profile updates.
 *
 * @returns State and action handlers for user operations
 *
 * @example
 * ```tsx
 * import { useUser } from 'dorisio-sdk/react';
 *
 * function UserProfileCard() {
 *   const { user, loading, error, fetchCurrentUser } = useUser();
 *
 *   useEffect(() => {
 *     fetchCurrentUser();
 *   }, [fetchCurrentUser]);
 *
 *   if (loading) return <p>Loading profile...</p>;
 *   if (error) return <p className="error">{error.message}</p>;
 *   if (!user) return <p>Please log in.</p>;
 *
 *   return (
 *     <div>
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
  });

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: ApiError | null) => {
    setState((prev) => ({ ...prev, error }));
    if (error && setParentError) {
      setParentError({ message: error.message, code: error.code || 'USER_ERROR' });
    }
  }, [setParentError]);

  const fetchUser = useCallback(
    async (userId: string): Promise<User | null> => {
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
    },
    [client, setError, setLoading]
  );

  const fetchCurrentUser = useCallback(async (): Promise<User | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await client.request('GET', '/users/me', undefined, {
        timeout: 10000,
      });

      if (response.success && response.data) {
        setState((prev) => ({
          ...prev,
          user: response.data as User,
          isAuthenticated: true,
        }));
        return response.data as User;
      }

      return null;
    } catch (err) {
      const error = err as ApiError;
      setError(error);
      setState((prev) => ({ ...prev, isAuthenticated: false }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [client, setError, setLoading]);

  const updateUser = useCallback(
    async (userId: string, data: UpdateUserRequest): Promise<User | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await client.request('PATCH', `/users/${userId}`, data, {
          timeout: 15000,
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
    },
    [client, setError, setLoading]
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
