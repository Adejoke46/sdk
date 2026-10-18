/** Express example (install express separately in your application).
 * Register this raw route BEFORE a global express.json() parser.
 * The sender must sign `${timestamp}.${rawBody}` with HMAC-SHA256 and send
 * x-dorisio-timestamp (Unix milliseconds) plus x-dorisio-signature (hex).
 * Persist processed event IDs to prevent duplicate work inside the time window.
 */
import express from 'express';
import { createWebhookMiddleware, type WebhookPayload } from 'dorisio-sdk/webhook';

const app = express();
const secret = process.env.DORISIO_WEBHOOK_SECRET;
if (!secret) throw new Error('DORISIO_WEBHOOK_SECRET is required');

app.post('/webhooks/dorisio', express.raw({ type: 'application/json' }),
  createWebhookMiddleware({ secret, maxAge: 5 * 60 * 1000 }),
  (req, res) => {
    const event = (req as typeof req & { dorisioWebhook: WebhookPayload }).dorisioWebhook;
    // Check event.id against your processed-event store before handling it.
    console.log(event);
    res.sendStatus(200);
  });

// Next.js App Router alternative (app/api/dorisio/route.ts):
// export const POST = createNextWebhookHandler({ secret }, async (event) => {
//   await processEvent(event);
//   return Response.json({ received: true });
// });

// Next.js Pages Router alternative (pages/api/dorisio.ts):
// export const config = { api: { bodyParser: false } };
// export default createNextApiWebhookHandler({ secret }, async (event, res) => {
//   await processEvent(event);
//   res.status(200).json({ received: true });
// });
