/**
 * Fastify Routes Template
 */

import { Language } from './types';

export function generateFastifyRoutes(lang: Language, includeWebhooks = true): Record<string, string> {
  const isTs = lang === 'typescript' || lang === 'ts';
  const ext = isTs ? 'ts' : 'js';

  const files: Record<string, string> = {};

  files[`routes.${ext}`] = isTs
    ? `import { type FastifyInstance, type FastifyPluginOptions, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dorisio } from './dorisio';
import { formatDorisioError } from './errorHandler';
${includeWebhooks ? "import { verifyWebhookSignature } from 'dorisio-sdk/webhook';" : ''}

const CreateTipBodySchema = z.object({
  creatorId: z.string().min(1, 'creatorId is required'),
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.enum(['USD', 'EUR', 'XLM']).default('USD'),
  message: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const ConnectWalletSchema = z.object({
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
  name: z.string().optional(),
});

export async function dorisioRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Create tip
  fastify.post('/api/tips', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = CreateTipBodySchema.parse(req.body);
      const tip = await dorisio.createTip({
        creatorId: validated.creatorId,
        amount: validated.amount,
        currency: validated.currency,
        message: validated.message,
        idempotencyKey: validated.idempotencyKey,
      });
      return reply.code(200).send({ success: true, data: tip });
    } catch (err) {
      const formatted = formatDorisioError(err);
      return reply.code(formatted.statusCode).send(formatted);
    }
  });

  // Get tip
  fastify.get('/api/tips/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const tip = await dorisio.getTipStatus(req.params.id);
      return reply.code(200).send({ success: true, data: tip });
    } catch (err) {
      const formatted = formatDorisioError(err);
      return reply.code(formatted.statusCode).send(formatted);
    }
  });

  // Get creator profile
  fastify.get('/api/creators/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const creator = await dorisio.getCreator(req.params.id);
      return reply.code(200).send({ success: true, data: creator });
    } catch (err) {
      const formatted = formatDorisioError(err);
      return reply.code(formatted.statusCode).send(formatted);
    }
  });

  // Connect wallet
  fastify.post('/api/wallets', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = ConnectWalletSchema.parse(req.body);
      const wallet = await dorisio.connectWallet({
        publicKey: validated.publicKey,
        name: validated.name,
      });
      return reply.code(201).send({ success: true, data: wallet });
    } catch (err) {
      const formatted = formatDorisioError(err);
      return reply.code(formatted.statusCode).send(formatted);
    }
  });

${
  includeWebhooks
    ? `  // Webhook listener
  fastify.post('/api/webhooks', async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-dorisio-signature'] as string | undefined;
    const webhookSecret = process.env.DORISIO_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return reply.code(500).send({ success: false, error: 'Webhook secret not configured' });
    }

    if (!signature) {
      return reply.code(401).send({ success: false, error: 'Missing X-Dorisio-Signature header' });
    }

    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const isValid = verifyWebhookSignature(payload, signature, webhookSecret);

    if (!isValid) {
      return reply.code(401).send({ success: false, error: 'Invalid webhook signature' });
    }

    return reply.code(200).send({ received: true });
  });`
    : ''
}
}
`
    : `import { z } from 'zod';
import { dorisio } from './dorisio';
import { formatDorisioError } from './errorHandler';
${includeWebhooks ? "import { verifyWebhookSignature } from 'dorisio-sdk/webhook';" : ''}

const CreateTipBodySchema = z.object({
  creatorId: z.string().min(1, 'creatorId is required'),
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.enum(['USD', 'EUR', 'XLM']).default('USD'),
  message: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const ConnectWalletSchema = z.object({
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
  name: z.string().optional(),
});

export async function dorisioRoutes(fastify, _opts) {
  // Create tip
  fastify.post('/api/tips', async (req, reply) => {
    try {
      const validated = CreateTipBodySchema.parse(req.body);
      const tip = await dorisio.createTip({
        creatorId: validated.creatorId,
        amount: validated.amount,
        currency: validated.currency,
        message: validated.message,
        idempotencyKey: validated.idempotencyKey,
      });
      return reply.code(200).send({ success: true, data: tip });
    } catch (err) {
      const formatted = formatDorisioError(err);
      return reply.code(formatted.statusCode).send(formatted);
    }
  });

  // Get tip
  fastify.get('/api/tips/:id', async (req, reply) => {
    try {
      const tip = await dorisio.getTipStatus(req.params.id);
      return reply.code(200).send({ success: true, data: tip });
    } catch (err) {
      const formatted = formatDorisioError(err);
      return reply.code(formatted.statusCode).send(formatted);
    }
  });

  // Get creator profile
  fastify.get('/api/creators/:id', async (req, reply) => {
    try {
      const creator = await dorisio.getCreator(req.params.id);
      return reply.code(200).send({ success: true, data: creator });
    } catch (err) {
      const formatted = formatDorisioError(err);
      return reply.code(formatted.statusCode).send(formatted);
    }
  });

  // Connect wallet
  fastify.post('/api/wallets', async (req, reply) => {
    try {
      const validated = ConnectWalletSchema.parse(req.body);
      const wallet = await dorisio.connectWallet({
        publicKey: validated.publicKey,
        name: validated.name,
      });
      return reply.code(201).send({ success: true, data: wallet });
    } catch (err) {
      const formatted = formatDorisioError(err);
      return reply.code(formatted.statusCode).send(formatted);
    }
  });

${
  includeWebhooks
    ? `  // Webhook listener
  fastify.post('/api/webhooks', async (req, reply) => {
    const signature = req.headers['x-dorisio-signature'];
    const webhookSecret = process.env.DORISIO_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return reply.code(500).send({ success: false, error: 'Webhook secret not configured' });
    }

    if (!signature) {
      return reply.code(401).send({ success: false, error: 'Missing X-Dorisio-Signature header' });
    }

    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const isValid = verifyWebhookSignature(payload, signature, webhookSecret);

    if (!isValid) {
      return reply.code(401).send({ success: false, error: 'Invalid webhook signature' });
    }

    return reply.code(200).send({ received: true });
  });`
    : ''
}
}
`;

  return files;
}
