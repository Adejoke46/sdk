import crypto from 'crypto';
import { WebhookPayloadSchema } from './validation-schemas';

/**
 * Webhook event payload structure
 */
export interface WebhookPayload {
  id: string;
  timestamp: number;
  event: string;
  data: Record<string, any>;
}

export interface WebhookVerificationOptions {
  /** Unix timestamp in milliseconds from x-dorisio-timestamp. Required for replay protection. */
  timestamp: number | string;
  /** Maximum age in milliseconds (default: five minutes). */
  maxAge?: number;
  /** Allowed future clock skew in milliseconds (default: five minutes). */
  clockSkew?: number;
  /** Override the current time in milliseconds, useful for deterministic tests. */
  now?: number;
}

/**
 * Verifies webhook signature to ensure authenticity
 * Uses HMAC-SHA256 for signature verification
 *
 * @param payload - The webhook payload (JSON string or object)
 * @param signature - The signature header from the webhook request
 * @param secret - Your webhook secret from Dorisio dashboard
 * @param options - Pass the signed timestamp to enforce replay protection. Without options,
 * verification retains the original body-only signature behavior for existing integrations.
 * Timestamp mode signs `${timestamp}.${rawBody}` and rejects timestamps older than maxAge
 * or further in the future than clockSkew. A timestamp window alone does not prevent
 * duplicate delivery within that window; persist event IDs if exactly-once processing is needed.
 * @returns true if signature is valid, false otherwise
 *
 * @example
 * ```ts
 * const isValid = verifyWebhookSignature(
 *   JSON.stringify(payload),
 *   req.headers['x-dorisio-signature'] as string,
 *   process.env.DORISIO_WEBHOOK_SECRET!
 * );
 * if (!isValid) throw new Error('Invalid webhook signature');
 * ```
 */
export function verifyWebhookSignature(
  payload: string | Buffer | Record<string, any>,
  signature: string,
  secret: string,
  options?: WebhookVerificationOptions
): boolean {
  try {
    if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature) || !secret) return false;
    const payloadBytes = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
    let signedBytes = payloadBytes;
    if (options) {
      const timestamp = String(options.timestamp);
      const maxAge = options.maxAge ?? 5 * 60 * 1000;
      const clockSkew = options.clockSkew ?? 5 * 60 * 1000;
      const now = options.now ?? Date.now();
      if (!/^[1-9]\d*$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) ||
          !Number.isFinite(maxAge) || maxAge < 0 || !Number.isFinite(clockSkew) || clockSkew < 0 ||
          !Number.isFinite(now) || Number(timestamp) < now - maxAge ||
          Number(timestamp) > now + clockSkew) return false;
      signedBytes = Buffer.concat([Buffer.from(`${timestamp}.`), payloadBytes]);
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedBytes)
      .digest();

    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expectedSignature);
  } catch {
    return false;
  }
}

/**
 * Parse and validate webhook payload structure
 *
 * @param payload - The raw webhook payload
 * @returns Parsed webhook payload if valid
 * @throws Error if payload structure is invalid
 *
 * @example
 * ```ts
 * const event = parseWebhookPayload(req.body);
 * if (event.event === 'tip.confirmed') {
 *   const tipData = event.data as TipConfirmedData;
 *   // Handle confirmed tip
 * }
 * ```
 */
export function parseWebhookPayload(payload: unknown): WebhookPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid webhook payload: must be an object');
  }

  const p = payload as Record<string, unknown>;

  if (!p.id || typeof p.id !== 'string') {
    throw new Error('Invalid webhook payload: missing or invalid id');
  }

  if (!p.timestamp || typeof p.timestamp !== 'number') {
    throw new Error('Invalid webhook payload: missing or invalid timestamp');
  }

  if (!p.event || typeof p.event !== 'string') {
    throw new Error('Invalid webhook payload: missing or invalid event');
  }

  if (!p.data || typeof p.data !== 'object' || Array.isArray(p.data)) {
    throw new Error('Invalid webhook payload: missing or invalid data');
  }

  const result = WebhookPayloadSchema.safeParse(payload);
  if (!result.success) throw new Error('Invalid webhook payload: malformed fields');
  return result.data as WebhookPayload;
}

/**
 * Webhook event types
 */
export enum WebhookEventType {
  TIP_CREATED = 'tip.created',
  TIP_CONFIRMED = 'tip.confirmed',
  TIP_FAILED = 'tip.failed',
  PAYMENT_SUCCEEDED = 'payment.succeeded',
  PAYMENT_FAILED = 'payment.failed',
  WALLET_VERIFIED = 'wallet.verified',
  WITHDRAWAL_COMPLETED = 'withdrawal.completed',
}

/**
 * Webhook event handler type
 */
export type WebhookEventHandler = (event: WebhookPayload) => void | Promise<void>;
