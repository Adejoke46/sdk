import { Component, ErrorInfo, ReactNode } from 'react';
import { DorisioError } from '../types/errors';

export interface DorisioBoundaryProps {
  children: ReactNode;
  /** Invoked when a `DorisioError` is caught. Receives the error and React error info. */
  onError?: (error: DorisioError, errorInfo: ErrorInfo) => void;
  /**
   * UI rendered when an error is caught. Either a static ReactNode or a render
   * prop receiving the caught error and a `reset` function that clears the
   * boundary state and re-renders the children.
   */
  fallback?: ReactNode | ((error: Error | undefined, reset: () => void) => ReactNode);
}

export interface DorisioBoundaryState {
  hasError: boolean;
  error: Error | undefined;
}

export class DorisioBoundary extends Component<DorisioBoundaryProps, DorisioBoundaryState> {
  constructor(props: DorisioBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: undefined };
  }

  static getDerivedStateFromError(error: unknown): DorisioBoundaryState {
    return {
      hasError: true,
      error: error instanceof Error ? error : new Error(String(error ?? 'An unknown error occurred')),
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error('[dorisio] DorisioBoundary caught error:', error, errorInfo);
    const sdkError = error instanceof DorisioError ? error : undefined;
    const { onError } = this.props;
    if (sdkError && onError) {
      onError(sdkError, errorInfo);
    }
  }

  private reset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback } = this.props;
      const reset = this.reset;
      if (fallback !== undefined) {
        if (typeof fallback === 'function') {
          return fallback(this.state.error, reset);
        }
        return fallback;
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
            onClick={reset}
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
