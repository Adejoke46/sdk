/**
 * DorisioProvider
 *
 * Comprehensive React context provider for Dorisio integration.
 * Manages client configuration, authentication state, error boundaries, and global state.
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { DorisioClient, ClientConfig } from '../client';
import { getErrorMessage, isRethrownByHook, safely } from './safe-async';

/**
 * Authentication state
 */
export interface AuthState {
  isAuthenticated: boolean;
  token?: string;
  userId?: string;
  createdAt: number;
}

/**
 * Global error state
 */
export interface ErrorState {
  message?: string;
  code?: string;
  timestamp: number;
}

/**
 * Dorisio context value
 */
export interface DorisioContextValue {
  // Client and configuration
  client: DorisioClient;
  config: ClientConfig;

  // Authentication
  auth: AuthState;
  setAuth: (auth: AuthState) => void;
  clearAuth: () => void;

  // Error handling
  error?: ErrorState;
  setError: (error: Omit<ErrorState, 'timestamp'>) => void;
  clearError: () => void;

  // Loading state
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const DorisioContext = createContext<DorisioContextValue | undefined>(undefined);

/** Runtime type guard for integrations that need to inspect context safely. */
export function isDorisioContext(value: unknown): value is DorisioContextValue {
  return Boolean(value && typeof value === 'object' && 'client' in value && 'config' in value && 'auth' in value);
}

/** Narrow context values without hiding an out-of-provider usage error. */
export function requireDorisioContext(value: DorisioContextValue | undefined): DorisioContextValue {
  if (!isDorisioContext(value)) throw new Error('useDorisio must be used within DorisioProvider');
  return value;
}

export interface DorisioProviderProps {
  client: DorisioClient;
  config: ClientConfig;
  initialAuth?: AuthState;
  /**
   * Async initialization run after the client is created and before children render.
   * Receives the client instance (e.g. to set tokens or register listeners).
   * Children stay unmounted until the returned promise settles.
   */
  onInit?: (client: DorisioClient) => Promise<void>;
  /** Called for every error reported by SDK hooks or caught by the provider's error boundary. */
  onError?: (error: ErrorState) => void;
  /** Custom UI shown when a render error is caught. Receives the error and a `reset` function. */
  fallback?: ReactNode | ((error: Error | undefined, reset: () => void) => ReactNode);
  /**
   * Log hook rejections that nothing caught (e.g. an un-awaited `createTip()` in an event
   * handler) to the console. Only rejections raised by Dorisio hooks are logged. Default: true.
   */
  captureUnhandledRejections?: boolean;
  children: ReactNode;
}

/**
 * DorisioProvider
 *
 * Main provider for Dorisio SDK integration in React applications.
 * Provides client, authentication state, and error management.
 *
 * @example
 * ```tsx
 * const client = new DorisioClient({
 *   baseUrl: 'https://api.dorisio.com',
 *   token: 'user-token',
 * });
 *
 * function App() {
 *   return (
 *     <DorisioProvider client={client} config={client.getConfig()}>
 *       <YourApp />
 *     </DorisioProvider>
 *   );
 * }
 * ```
 */
export function DorisioProvider({
  client,
  config,
  initialAuth,
  onInit,
  onError,
  fallback,
  captureUnhandledRejections = true,
  children,
}: DorisioProviderProps): React.ReactElement | null {
  if (!client || typeof client.request !== 'function') {
    throw new Error('DorisioProvider requires a valid DorisioClient instance');
  }
  // Authentication state
  const [auth, setAuthState] = useState<AuthState>(
    initialAuth || {
      isAuthenticated: false,
      createdAt: Date.now(),
    }
  );

  // Error state
  const [error, setErrorState] = useState<ErrorState | undefined>();

  // Loading state
  const [isLoading, setIsLoading] = useState(false);

  // Initialization: when onInit is provided children stay unmounted until it settles.
  const [isInitializing, setIsInitializing] = useState(() => Boolean(onInit));
  // Guarantee onInit runs exactly once even if the effect re-subscribes (e.g. when
  // `setError`/`onError` changes identity between renders).
  const didInit = useRef(false);

  // Authentication handlers
  const setAuth = useCallback(
    (newAuth: AuthState) => {
      setAuthState(newAuth);

      // Update client token if provided
      if (newAuth.token) {
        client.setToken(newAuth.token);
      }
    },
    [client]
  );

  const clearAuth = useCallback(() => {
    setAuthState({
      isAuthenticated: false,
      createdAt: Date.now(),
    });
    client.clearToken();
  }, [client]);

  // Error handlers
  const setError = useCallback(
    (errorData: Omit<ErrorState, 'timestamp'>) => {
      const errorState: ErrorState = {
        ...errorData,
        timestamp: Date.now(),
      };
      setErrorState(errorState);

      // Notify parent app of error if handler provided. A throwing handler must not
      // break the hook that reported the error (or mask the original error).
      if (onError) {
        safely('onError handler', () => onError(errorState));
      }
    },
    [onError]
  );

  const clearError = useCallback(() => {
    setErrorState(undefined);
  }, []);

  // Run onInit after the client is created, before children mount. A rejected init
  // is reported through the same error channel as hook errors; the original rejection
  // is not swallowed. A `cancelled` flag prevents state updates after unmount.
  useEffect(() => {
    if (!onInit || didInit.current) return undefined;
    didInit.current = true;

    let cancelled = false;
    const runInit = async (): Promise<void> => {
      try {
        setIsLoading(true);
        await onInit(client);
        if (!cancelled) {
          setIsLoading(false);
          setIsInitializing(false);
        }
      } catch (err) {
        if (!cancelled) {
          setIsLoading(false);
          setIsInitializing(false);
          const initializationError =
            err instanceof Error ? err : new Error(String(err));
          setError({
            message: getErrorMessage(initializationError, 'Initialization failed'),
            code: 'INIT_ERROR',
          });
        }
      }
    };

    void runInit();
    return () => {
      cancelled = true;
    };
  }, [client, onInit, setError]);

  // Global error listener: surface uncaught runtime errors through the provider
  // error channel so they are handled consistently with hook errors.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handler = (event: ErrorEvent): void => {
      const error = event.error || new Error(event.message || 'Global error');
      safely('global error listener', () =>
        setError({ message: getErrorMessage(error, 'Global error'), code: 'GLOBAL_ERROR' })
      );
    };

    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, [setError]);

  // Offline/online listeners on the client's offline event bus. Registered after
  // client creation and unregistered on unmount to avoid leaks.
  useEffect(() => {
    if (typeof client.on !== 'function' || typeof client.off !== 'function') return undefined;

    const handleOffline = (): void =>
      safely('offline listener', () =>
        setError({ message: 'Device went offline', code: 'OFFLINE' })
      );
    const handleOnline = (): void =>
      safely('online listener', () => clearError());

    client.on('offline', handleOffline);
    client.on('online', handleOnline);

    return () => {
      safely('offline listener cleanup', () => client.off('offline', handleOffline));
      safely('online listener cleanup', () => client.off('online', handleOnline));
    };
  }, [client, setError, clearError]);

  // Log hook rejections nobody caught. Async errors never reach React error boundaries,
  // so this is the only place they can be surfaced.
  useEffect(() => {
    if (!captureUnhandledRejections || typeof window === 'undefined') return undefined;

    const handler = (event: PromiseRejectionEvent): void => {
      if (!isRethrownByHook(event.reason)) return;
      console.error(
        '[dorisio] Unhandled promise rejection from a Dorisio hook action. ' +
          'Await it in try/catch or add .catch(); the error is also available in hook state.',
        event.reason
      );
    };

    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, [captureUnhandledRejections]);

  // Report errors caught by the boundary to the same channel as hook errors
  const reportRenderError = useCallback(
    (err: Error) =>
      setError({ message: getErrorMessage(err, 'Render error'), code: 'RENDER_ERROR' }),
    [setError]
  );

  // Create context value
  const value: DorisioContextValue = useMemo(
    () => ({
      client,
      config,
      auth,
      setAuth,
      clearAuth,
      error,
      setError,
      clearError,
      isLoading,
      setIsLoading,
    }),
    [client, config, auth, setAuth, clearAuth, error, setError, clearError, isLoading]
  );

  // Children mount only after initialization completes (when onInit is provided).
  if (isInitializing) return null;

  return (
    <DorisioContext.Provider value={value}>
      <ErrorBoundary onError={reportRenderError} fallback={fallback}>
        {children}
      </ErrorBoundary>
    </DorisioContext.Provider>
  );
}

/**
 * useDorisio hook
 *
 * Get access to Dorisio context and client within a component.
 * Must be used within a DorisioProvider.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { client, auth, setError } = useDorisio();
 *   // Use client and context...
 * }
 * ```
 */
export function useDorisio(): DorisioContextValue {
  return requireDorisioContext(useContext(DorisioContext));
}

/**
 * Error Boundary component
 * Catches errors thrown while rendering (sync only — React error boundaries cannot see
 * rejected promises) and displays fallback UI. Async failures are reported by the hooks
 * themselves through `setError` / `onError`.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error) => void;
  fallback?: DorisioProviderProps['fallback'];
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Dorisio Error Boundary caught error:', error, errorInfo);
    const { onError } = this.props;
    if (onError) safely('error boundary onError', () => onError(error));
  }

  private reset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback } = this.props;
      if (fallback !== undefined) {
        return typeof fallback === 'function' ? fallback(this.state.error, this.reset) : fallback;
      }
      return (
        <div
          style={{
            padding: '20px',
            margin: '20px',
            border: '1px solid #ff6b6b',
            borderRadius: '8px',
            backgroundColor: '#ffe0e0',
            color: '#c92a2a',
          }}
        >
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button
            onClick={this.reset}
            style={{
              padding: '8px 16px',
              backgroundColor: '#c92a2a',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
