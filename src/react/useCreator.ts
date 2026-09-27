/**
 * useCreator Hook
 *
 * Hook for creator-related operations.
 */

import { useState, useCallback } from 'react';
import {
  Creator,
  CreatorProfile,
  CreateCreatorRequest,
  UpdateCreatorRequest,
} from '../types/models';
import { ApiError } from '../types/errors';
import { useDorisio } from './DorisioProvider';

interface UseCreatorState {
  creator: Creator | null;
  profile: CreatorProfile | null;
  loading: boolean;
  error: ApiError | null;
}

interface UseCreatorActions {
  fetchCreator: (creatorId: string) => Promise<Creator | null>;
  fetchProfile: (username: string) => Promise<CreatorProfile | null>;
  createCreator: (data: CreateCreatorRequest) => Promise<Creator | null>;
  updateCreator: (creatorId: string, data: UpdateCreatorRequest) => Promise<Creator | null>;
  clearError: () => void;
}

/**
 * Hook for managing creator profiles, identity fetching, and profile updates.
 *
 * @returns State and action handlers for creator operations
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
export function useCreator(): UseCreatorState & UseCreatorActions {
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
    async (creatorId: string): Promise<Creator | null> => {
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
    },
    [client, setError, setLoading]
  );

  const fetchProfile = useCallback(
    async (username: string): Promise<CreatorProfile | null> => {
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
    },
    [client, setError, setLoading]
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

  return {
    ...state,
    fetchCreator,
    fetchProfile,
    createCreator,
    updateCreator,
    clearError,
  };
}
