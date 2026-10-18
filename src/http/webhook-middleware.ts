import {
  parseWebhookPayload,
  verifyWebhookSignature,
  type WebhookPayload,
  type WebhookVerificationOptions,
} from '../utils/webhook-verifier';

export type WebhookMiddlewareOptions = Pick<WebhookVerificationOptions, 'maxAge' | 'clockSkew'> & {
  secret: string;
};

type Headers = Record<string, string | string[] | undefined>;

function verify(raw: Buffer | string, headers: Headers, options: WebhookMiddlewareOptions): WebhookPayload | null {
  const signature = headers['x-dorisio-signature'];
  const timestamp = headers['x-dorisio-timestamp'];
  if (typeof signature !== 'string' || typeof timestamp !== 'string' ||
      !verifyWebhookSignature(raw, signature, options.secret, {
        timestamp,
        maxAge: options.maxAge,
        clockSkew: options.clockSkew,
      })) return null;

  try {
    const payload = parseWebhookPayload(JSON.parse(raw.toString()));
    return payload.timestamp === Number(timestamp) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Express middleware. Mount express.raw({ type: 'application/json' }) before this
 * middleware and before any JSON parser on this route. A parsed object cannot be
 * authenticated because its original byte representation has been lost.
 * An accepted timestamp limits replay to maxAge (default five minutes); deduplicate
 * event IDs in your application if duplicate delivery within that window matters.
 */
export function createWebhookMiddleware(options: WebhookMiddlewareOptions) {
  return (
    req: { body?: unknown; headers: Headers; dorisioWebhook?: WebhookPayload },
    res: { status(code: number): { json(body: unknown): unknown } },
    next: () => void
  ): void => {
    if (!Buffer.isBuffer(req.body) && typeof req.body !== 'string') {
      res.status(400).json({ error: 'Raw webhook body required' });
      return;
    }
    const payload = verify(req.body as Buffer | string, req.headers, options);
    if (!payload) {
      res.status(401).json({ error: 'Invalid webhook signature or payload' });
      return;
    }
    req.dorisioWebhook = payload;
    next();
  };
}

/** Next.js App Router route handler wrapper. Request.text() preserves the signed body. */
export function createNextWebhookHandler(
  options: WebhookMiddlewareOptions,
  handler: (payload: WebhookPayload, request: Request) => Response | Promise<Response>
) {
  return async (request: Request): Promise<Response> => {
    const raw = await request.text();
    const payload = verify(raw, {
      'x-dorisio-signature': request.headers.get('x-dorisio-signature') ?? undefined,
      'x-dorisio-timestamp': request.headers.get('x-dorisio-timestamp') ?? undefined,
    }, options);
    if (!payload) return Response.json({ error: 'Invalid webhook signature or payload' }, { status: 401 });
    return handler(payload, request);
  };
}

/**
 * Next.js Pages Router API wrapper. Set `export const config = { api: { bodyParser: false } }`
 * in the API route so the incoming stream is still the signed raw body.
 */
export function createNextApiWebhookHandler<Res>(
  options: WebhookMiddlewareOptions,
  handler: (payload: WebhookPayload, response: Res) => void | Promise<void>
) {
  return async (
    request: AsyncIterable<Uint8Array | string> & { headers: Headers },
    response: Res & { status(code: number): { json(body: unknown): unknown } }
  ): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = verify(Buffer.concat(chunks), request.headers, options);
    if (!payload) {
      response.status(401).json({ error: 'Invalid webhook signature or payload' });
      return;
    }
    await handler(payload, response);
  };
}
