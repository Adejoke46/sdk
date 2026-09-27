/**
 * Express Route Handlers Template
 */

import { Language } from './types';

export function generateExpressRoutes(lang: Language, includeWebhooks = true): Record<string, string> {
  const isTs = lang === 'typescript' || lang === 'ts';
  const ext = isTs ? 'ts' : 'js';

  const files: Record<string, string> = {};

  // Tips Route Handler
  files[`tips.${ext}`] = isTs
    ? `import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { dorisio } from './dorisio';
import { formatDorisioError } from './errorHandler';

export const tipsRouter = Router();

const CreateTipBodySchema = z.object({
  creatorId: z.string().min(1, 'creatorId is required'),
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.enum(['USD', 'EUR', 'XLM']).default('USD'),
  message: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * POST /api/tips - Create a new payment tip
 */
tipsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const validated = CreateTipBodySchema.parse(req.body);
    const tip = await dorisio.createTip({
      creatorId: validated.creatorId,
      amount: validated.amount,
      currency: validated.currency,
      message: validated.message,
      idempotencyKey: validated.idempotencyKey,
    });
    return res.status(200).json({ success: true, data: tip });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});

/**
 * GET /api/tips/:id - Get status and details of a tip
 */
tipsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const tipId = req.params.id;
    if (!tipId) {
      return res.status(400).json({ success: false, error: 'Tip ID is required' });
    }
    const tip = await dorisio.getTipStatus(tipId);
    return res.status(200).json({ success: true, data: tip });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});
`
    : `import { Router } from 'express';
import { z } from 'zod';
import { dorisio } from './dorisio';
import { formatDorisioError } from './errorHandler';

export const tipsRouter = Router();

const CreateTipBodySchema = z.object({
  creatorId: z.string().min(1, 'creatorId is required'),
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.enum(['USD', 'EUR', 'XLM']).default('USD'),
  message: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * POST /api/tips - Create a new payment tip
 */
tipsRouter.post('/', async (req, res) => {
  try {
    const validated = CreateTipBodySchema.parse(req.body);
    const tip = await dorisio.createTip({
      creatorId: validated.creatorId,
      amount: validated.amount,
      currency: validated.currency,
      message: validated.message,
      idempotencyKey: validated.idempotencyKey,
    });
    return res.status(200).json({ success: true, data: tip });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});

/**
 * GET /api/tips/:id - Get status and details of a tip
 */
tipsRouter.get('/:id', async (req, res) => {
  try {
    const tipId = req.params.id;
    if (!tipId) {
      return res.status(400).json({ success: false, error: 'Tip ID is required' });
    }
    const tip = await dorisio.getTipStatus(tipId);
    return res.status(200).json({ success: true, data: tip });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});
`;

  // Creators Route Handler
  files[`creators.${ext}`] = isTs
    ? `import { Router, type Request, type Response } from 'express';
import { dorisio } from './dorisio';
import { formatDorisioError } from './errorHandler';

export const creatorsRouter = Router();

/**
 * GET /api/creators/:id - Fetch creator profile
 */
creatorsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const creatorId = req.params.id;
    if (!creatorId) {
      return res.status(400).json({ success: false, error: 'Creator ID is required' });
    }
    const creator = await dorisio.getCreator(creatorId);
    return res.status(200).json({ success: true, data: creator });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});

/**
 * GET /api/creators/:id/earnings - Fetch creator earnings
 */
creatorsRouter.get('/:id/earnings', async (req: Request, res: Response) => {
  try {
    const creatorId = req.params.id;
    if (!creatorId) {
      return res.status(400).json({ success: false, error: 'Creator ID is required' });
    }
    const earnings = await dorisio.getCreatorEarnings(creatorId);
    return res.status(200).json({ success: true, data: earnings });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});
`
    : `import { Router } from 'express';
import { dorisio } from './dorisio';
import { formatDorisioError } from './errorHandler';

export const creatorsRouter = Router();

/**
 * GET /api/creators/:id - Fetch creator profile
 */
creatorsRouter.get('/:id', async (req, res) => {
  try {
    const creatorId = req.params.id;
    if (!creatorId) {
      return res.status(400).json({ success: false, error: 'Creator ID is required' });
    }
    const creator = await dorisio.getCreator(creatorId);
    return res.status(200).json({ success: true, data: creator });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});

/**
 * GET /api/creators/:id/earnings - Fetch creator earnings
 */
creatorsRouter.get('/:id/earnings', async (req, res) => {
  try {
    const creatorId = req.params.id;
    if (!creatorId) {
      return res.status(400).json({ success: false, error: 'Creator ID is required' });
    }
    const earnings = await dorisio.getCreatorEarnings(creatorId);
    return res.status(200).json({ success: true, data: earnings });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});
`;

  // Wallets Route Handler
  files[`wallets.${ext}`] = isTs
    ? `import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { dorisio } from './dorisio';
import { formatDorisioError } from './errorHandler';

export const walletsRouter = Router();

const ConnectWalletSchema = z.object({
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
  name: z.string().optional(),
});

/**
 * POST /api/wallets - Link a Stellar wallet
 */
walletsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const validated = ConnectWalletSchema.parse(req.body);
    const wallet = await dorisio.connectWallet({
      publicKey: validated.publicKey,
      name: validated.name,
    });
    return res.status(201).json({ success: true, data: wallet });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});

/**
 * GET /api/wallets/:id/balance - Query linked wallet balance
 */
walletsRouter.get('/:id/balance', async (req: Request, res: Response) => {
  try {
    const walletId = req.params.id;
    if (!walletId) {
      return res.status(400).json({ success: false, error: 'Wallet ID is required' });
    }
    const balance = await dorisio.getWalletBalance(walletId);
    return res.status(200).json({ success: true, data: balance });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});
`
    : `import { Router } from 'express';
import { z } from 'zod';
import { dorisio } from './dorisio';
import { formatDorisioError } from './errorHandler';

export const walletsRouter = Router();

const ConnectWalletSchema = z.object({
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
  name: z.string().optional(),
});

/**
 * POST /api/wallets - Link a Stellar wallet
 */
walletsRouter.post('/', async (req, res) => {
  try {
    const validated = ConnectWalletSchema.parse(req.body);
    const wallet = await dorisio.connectWallet({
      publicKey: validated.publicKey,
      name: validated.name,
    });
    return res.status(201).json({ success: true, data: wallet });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});

/**
 * GET /api/wallets/:id/balance - Query linked wallet balance
 */
walletsRouter.get('/:id/balance', async (req, res) => {
  try {
    const walletId = req.params.id;
    if (!walletId) {
      return res.status(400).json({ success: false, error: 'Wallet ID is required' });
    }
    const balance = await dorisio.getWalletBalance(walletId);
    return res.status(200).json({ success: true, data: balance });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return res.status(formatted.statusCode).json(formatted);
  }
});
`;

  // Webhooks Route Handler
  if (includeWebhooks) {
    files[`webhooks.${ext}`] = isTs
      ? `import { Router, type Request, type Response } from 'express';
import { verifyWebhookSignature } from 'dorisio-sdk/webhook';

export const webhooksRouter = Router();

/**
 * POST /api/webhooks - Process signed Dorisio webhook events
 */
webhooksRouter.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-dorisio-signature'] as string | undefined;
  const webhookSecret = process.env.DORISIO_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('DORISIO_WEBHOOK_SECRET is not set in environment');
    return res.status(500).json({ success: false, error: 'Webhook secret not configured' });
  }

  if (!signature) {
    return res.status(401).json({ success: false, error: 'Missing X-Dorisio-Signature header' });
  }

  const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const isValid = verifyWebhookSignature(payload, signature, webhookSecret);

  if (!isValid) {
    return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
  }

  const event = req.body;
  console.log(\`[Dorisio Webhook] Received \${event.event} at \${event.timestamp}\`);

  // Handle specific webhook event types
  switch (event.event) {
    case 'payment.completed':
      // Handle settled payment
      break;
    case 'payment.failed':
      // Handle failed payment
      break;
    case 'payout.processed':
      // Handle creator payout
      break;
    default:
      console.log(\`Unhandled webhook event type: \${event.event}\`);
  }

  return res.status(200).json({ received: true });
});
`
      : `import { Router } from 'express';
import { verifyWebhookSignature } from 'dorisio-sdk/webhook';

export const webhooksRouter = Router();

/**
 * POST /api/webhooks - Process signed Dorisio webhook events
 */
webhooksRouter.post('/', async (req, res) => {
  const signature = req.headers['x-dorisio-signature'];
  const webhookSecret = process.env.DORISIO_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('DORISIO_WEBHOOK_SECRET is not set in environment');
    return res.status(500).json({ success: false, error: 'Webhook secret not configured' });
  }

  if (!signature) {
    return res.status(401).json({ success: false, error: 'Missing X-Dorisio-Signature header' });
  }

  const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const isValid = verifyWebhookSignature(payload, signature, webhookSecret);

  if (!isValid) {
    return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
  }

  const event = req.body;
  console.log(\`[Dorisio Webhook] Received \${event.event} at \${event.timestamp}\`);

  // Handle specific webhook event types
  switch (event.event) {
    case 'payment.completed':
      // Handle settled payment
      break;
    case 'payment.failed':
      // Handle failed payment
      break;
    case 'payout.processed':
      // Handle creator payout
      break;
    default:
      console.log(\`Unhandled webhook event type: \${event.event}\`);
  }

  return res.status(200).json({ received: true });
});
`;
  }

  // Index aggregator
  files[`index.${ext}`] = isTs
    ? `import { Router } from 'express';
import { tipsRouter } from './tips';
import { creatorsRouter } from './creators';
import { walletsRouter } from './wallets';
${includeWebhooks ? "import { webhooksRouter } from './webhooks';" : ''}

export const dorisioRouter = Router();

dorisioRouter.use('/tips', tipsRouter);
dorisioRouter.use('/creators', creatorsRouter);
dorisioRouter.use('/wallets', walletsRouter);
${includeWebhooks ? "dorisioRouter.use('/webhooks', webhooksRouter);" : ''}

export * from './dorisio';
export * from './errorHandler';
`
    : `import { Router } from 'express';
import { tipsRouter } from './tips';
import { creatorsRouter } from './creators';
import { walletsRouter } from './wallets';
${includeWebhooks ? "import { webhooksRouter } from './webhooks';" : ''}

export const dorisioRouter = Router();

dorisioRouter.use('/tips', tipsRouter);
dorisioRouter.use('/creators', creatorsRouter);
dorisioRouter.use('/wallets', walletsRouter);
${includeWebhooks ? "dorisioRouter.use('/webhooks', webhooksRouter);" : ''}

export * from './dorisio';
export * from './errorHandler';
`;

  return files;
}
