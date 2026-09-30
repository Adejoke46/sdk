/**
 * Distributed Tracing Support
 *
 * Implements OpenTelemetry support for distributed tracing.
 * Allows tracing of SDK operations across multiple services.
 */

/**
 * Trace context for request correlation
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceState?: string;
}

/**
 * Span attributes for OpenTelemetry
 */
export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
  'http.method'?: string;
  'http.url'?: string;
  'http.status_code'?: number;
  'http.request.body.size'?: number;
  'http.response.body.size'?: number;
  'error.type'?: string;
  'error.message'?: string;
  'http.client.duration'?: number;
  'span.kind'?: string;
}

/**
 * Span event for recording events within a span
 */
export interface SpanEvent {
  name: string;
  timestamp?: number;
  attributes?: SpanAttributes;
}

/**
 * Span status enumeration
 */
export enum SpanStatus {
  Unset = 'UNSET',
  Ok = 'OK',
  Error = 'ERROR',
}

/**
 * Span interface for recording trace information
 */
export interface Span {
  /**
   * Set attribute on span
   */
  setAttribute(key: string, value: string | number | boolean): void;
  /**
   * Set multiple attributes
   */
  setAttributes(attributes: SpanAttributes): void;
  /**
   * Add an event to the span
   */
  addEvent(name: string, attributes?: SpanAttributes): void;
  /**
   * Set span status
   */
  setStatus(status: SpanStatus, message?: string): void;
  /**
   * Record an exception
   */
  recordException(exception: Error): void;
  /**
   * End the span
   */
  end(endTime?: number): void;
  /**
   * Get span context
   */
  getContext(): TraceContext;
}

/**
 * In-memory span implementation for when OpenTelemetry is not available
 */
class InMemorySpan implements Span {
  private context: TraceContext;
  private attributes: SpanAttributes = {};
  private events: SpanEvent[] = [];
  private status: SpanStatus = SpanStatus.Unset;
  private statusMessage?: string;
  private startTime: number;
  private ended = false;

  constructor(traceId: string, spanId: string, parentSpanId?: string) {
    this.context = { traceId, spanId, parentSpanId };
    this.startTime = Date.now();
  }

  setAttribute(key: string, value: string | number | boolean): void {
    if (!this.ended) {
      this.attributes[key] = value;
    }
  }

  setAttributes(attributes: SpanAttributes): void {
    if (!this.ended) {
      Object.assign(this.attributes, attributes);
    }
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    if (!this.ended) {
      this.events.push({
        name,
        timestamp: Date.now(),
        attributes,
      });
    }
  }

  setStatus(status: SpanStatus, message?: string): void {
    if (!this.ended) {
      this.status = status;
      this.statusMessage = message;
    }
  }

  recordException(exception: Error): void {
    if (!this.ended) {
      this.setAttribute('error.type', exception.name);
      this.setAttribute('error.message', exception.message);
      this.addEvent('exception', {
        'error.type': exception.name,
        'error.message': exception.message,
      });
    }
  }

  end(endTime?: number): void {
    this.ended = true;
    const duration = (endTime || Date.now()) - this.startTime;
    this.setAttribute('span.duration_ms', duration);
  }

  getContext(): TraceContext {
    return { ...this.context };
  }

  /**
   * Get span data (for debugging/testing)
   */
  getData() {
    return {
      context: this.context,
      attributes: this.attributes,
      events: this.events,
      status: this.status,
      statusMessage: this.statusMessage,
      duration: Date.now() - this.startTime,
    };
  }
}

/**
 * Distributed tracing provider
 */
export class DistributedTracingProvider {
  private tracer?: any; // OpenTelemetry tracer instance
  private isAvailable = false;
  private rootTraceId?: string;
  private spanStack: Span[] = [];

  constructor(tracerProvider?: any) {
    if (tracerProvider) {
      this.tracer = tracerProvider.getTracer('dorisio-sdk');
      this.isAvailable = true;
    }
  }

  /**
   * Initialize OpenTelemetry tracer
   */
  initializeTracer(tracerProvider: any): void {
    this.tracer = tracerProvider.getTracer('dorisio-sdk');
    this.isAvailable = true;
  }

  /**
   * Start a new trace
   */
  startTrace(operationName: string): TraceContext {
    this.rootTraceId = this.generateTraceId();
    const span = this.startSpan(operationName, { 'span.kind': 'client' });
    return span.getContext();
  }

  /**
   * Start a new span
   */
  startSpan(operationName: string, attributes?: SpanAttributes): Span {
    const traceId = this.rootTraceId || this.generateTraceId();
    const spanId = this.generateSpanId();
    const parentSpan =
      this.spanStack.length > 0 ? this.spanStack[this.spanStack.length - 1] : undefined;
    const parentSpanId = parentSpan?.getContext().spanId;

    let span: Span;

    if (this.isAvailable && this.tracer) {
      // Use OpenTelemetry tracer if available
      try {
        span = this.tracer.startSpan(operationName, { root: !parentSpanId });
      } catch {
        // Fallback to in-memory span if OpenTelemetry fails
        span = new InMemorySpan(traceId, spanId, parentSpanId);
      }
    } else {
      // Use in-memory span
      span = new InMemorySpan(traceId, spanId, parentSpanId);
    }

    if (attributes) {
      span.setAttributes(attributes);
    }

    this.spanStack.push(span);
    return span;
  }

  /**
   * End current span
   */
  endSpan(span: Span, attributes?: SpanAttributes): void {
    if (attributes) {
      span.setAttributes(attributes);
    }
    span.end();

    if (this.spanStack.length > 0 && this.spanStack[this.spanStack.length - 1] === span) {
      this.spanStack.pop();
    }
  }

  /**
   * Create W3C trace context headers
   */
  getTraceHeaders(span: Span): Record<string, string> {
    const context = span.getContext();
    const traceParent = `00-${context.traceId}-${context.spanId}-01`;
    return {
      'traceparent': traceParent,
      'tracestate': context.traceState || '',
    };
  }

  /**
   * Extract trace context from headers (for incoming requests)
   */
  extractTraceContext(headers: Record<string, string>): Partial<TraceContext> | null {
    const traceParent = headers['traceparent'];
    if (!traceParent) {
      return null;
    }

    const parts = traceParent.split('-');
    if (parts.length !== 4) {
      return null;
    }

    return {
      traceId: parts[1],
      spanId: parts[2],
      traceState: headers['tracestate'],
    };
  }

  /**
   * Check if tracing is available
   */
  isTracingAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Get current span
   */
  getCurrentSpan(): Span | undefined {
    return this.spanStack.length > 0 ? this.spanStack[this.spanStack.length - 1] : undefined;
  }

  /**
   * Get trace ID of current trace
   */
  getCurrentTraceId(): string | undefined {
    return this.rootTraceId;
  }

  /**
   * Generate a new trace ID (128-bit)
   */
  private generateTraceId(): string {
    const random = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(random).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Generate a new span ID (64-bit)
   */
  private generateSpanId(): string {
    const random = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(random).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Reset tracing state
   */
  reset(): void {
    this.rootTraceId = undefined;
    this.spanStack = [];
  }
}

/**
 * Global tracing provider instance
 */
let tracingProvider: DistributedTracingProvider | null = null;

/**
 * Get or create global tracing provider
 */
export function getTracingProvider(): DistributedTracingProvider {
  if (!tracingProvider) {
    tracingProvider = new DistributedTracingProvider();
  }
  return tracingProvider;
}

/**
 * Initialize global tracing provider with OpenTelemetry
 */
export function initializeTracing(tracerProvider: any): void {
  if (!tracingProvider) {
    tracingProvider = new DistributedTracingProvider(tracerProvider);
  } else {
    tracingProvider.initializeTracer(tracerProvider);
  }
}
