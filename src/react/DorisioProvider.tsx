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
  useState,
  ReactNode,
  useMemo,
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
  onError,
  fallback,
  captureUnhandledRejections = true,
  children,
}: DorisioProviderProps): React.ReactElement {
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
