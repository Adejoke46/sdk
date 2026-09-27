/**
 * Next.js App Router Route Handlers Template
 */

import { Language } from './types';

export function generateNextJsRoutes(lang: Language, includeWebhooks = true): Record<string, string> {
  const isTs = lang === 'typescript' || lang === 'ts';
  const ext = isTs ? 'ts' : 'js';

  const files: Record<string, string> = {};

  // app/api/dorisio/tips/route.ts
  files[`tips/route.${ext}`] = isTs
    ? `import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dorisio } from '../dorisio';
import { formatDorisioError } from '../errorHandler';

const CreateTipBodySchema = z.object({
  creatorId: z.string().min(1, 'creatorId is required'),
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.enum(['USD', 'EUR', 'XLM']).default('USD'),
  message: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const validated = CreateTipBodySchema.parse(json);

    const tip = await dorisio.createTip({
      creatorId: validated.creatorId,
      amount: validated.amount,
      currency: validated.currency,
      message: validated.message,
      idempotencyKey: validated.idempotencyKey,
    });

    return NextResponse.json({ success: true, data: tip }, { status: 200 });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return NextResponse.json(formatted, { status: formatted.statusCode });
  }
}
`
    : `import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dorisio } from '../dorisio';
import { formatDorisioError } from '../errorHandler';

const CreateTipBodySchema = z.object({
  creatorId: z.string().min(1, 'creatorId is required'),
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.enum(['USD', 'EUR', 'XLM']).default('USD'),
  message: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req) {
  try {
    const json = await req.json();
    const validated = CreateTipBodySchema.parse(json);

    const tip = await dorisio.createTip({
      creatorId: validated.creatorId,
      amount: validated.amount,
      currency: validated.currency,
      message: validated.message,
      idempotencyKey: validated.idempotencyKey,
    });

    return NextResponse.json({ success: true, data: tip }, { status: 200 });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return NextResponse.json(formatted, { status: formatted.statusCode });
  }
}
`;

  // app/api/dorisio/tips/[id]/route.ts
  files[`tips/[id]/route.${ext}`] = isTs
    ? `import { NextRequest, NextResponse } from 'next/server';
import { dorisio } from '../../dorisio';
import { formatDorisioError } from '../../errorHandler';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tip = await dorisio.getTipStatus(params.id);
    return NextResponse.json({ success: true, data: tip }, { status: 200 });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return NextResponse.json(formatted, { status: formatted.statusCode });
  }
}
`
    : `import { NextResponse } from 'next/server';
import { dorisio } from '../../dorisio';
import { formatDorisioError } from '../../errorHandler';

export async function GET(_req, { params }) {
  try {
    const tip = await dorisio.getTipStatus(params.id);
    return NextResponse.json({ success: true, data: tip }, { status: 200 });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return NextResponse.json(formatted, { status: formatted.statusCode });
  }
}
`;

  // app/api/dorisio/creators/[id]/route.ts
  files[`creators/[id]/route.${ext}`] = isTs
    ? `import { NextRequest, NextResponse } from 'next/server';
import { dorisio } from '../../dorisio';
import { formatDorisioError } from '../../errorHandler';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const creator = await dorisio.getCreator(params.id);
    return NextResponse.json({ success: true, data: creator }, { status: 200 });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return NextResponse.json(formatted, { status: formatted.statusCode });
  }
}
`
    : `import { NextResponse } from 'next/server';
import { dorisio } from '../../dorisio';
import { formatDorisioError } from '../../errorHandler';

export async function GET(_req, { params }) {
  try {
    const creator = await dorisio.getCreator(params.id);
    return NextResponse.json({ success: true, data: creator }, { status: 200 });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return NextResponse.json(formatted, { status: formatted.statusCode });
  }
}
`;

  // app/api/dorisio/wallets/route.ts
  files[`wallets/route.${ext}`] = isTs
    ? `import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dorisio } from '../dorisio';
import { formatDorisioError } from '../errorHandler';

const ConnectWalletSchema = z.object({
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
  name: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = ConnectWalletSchema.parse(body);

    const wallet = await dorisio.connectWallet({
      publicKey: validated.publicKey,
      name: validated.name,
    });

    return NextResponse.json({ success: true, data: wallet }, { status: 201 });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return NextResponse.json(formatted, { status: formatted.statusCode });
  }
}
`
    : `import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dorisio } from '../dorisio';
import { formatDorisioError } from '../errorHandler';

const ConnectWalletSchema = z.object({
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
  name: z.string().optional(),
});

export async function POST(req) {
  try {
    const body = await req.json();
    const validated = ConnectWalletSchema.parse(body);

    const wallet = await dorisio.connectWallet({
      publicKey: validated.publicKey,
      name: validated.name,
    });

    return NextResponse.json({ success: true, data: wallet }, { status: 201 });
  } catch (err) {
    const formatted = formatDorisioError(err);
    return NextResponse.json(formatted, { status: formatted.statusCode });
  }
}
`;

  if (includeWebhooks) {
    // app/api/dorisio/webhooks/route.ts
    files[`webhooks/route.${ext}`] = isTs
      ? `import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from 'dorisio-sdk/webhook';

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-dorisio-signature');
  const webhookSecret = process.env.DORISIO_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ success: false, error: 'Webhook secret not configured' }, { status: 500 });
  }

  if (!signature) {
    return NextResponse.json({ success: false, error: 'Missing X-Dorisio-Signature header' }, { status: 401 });
  }

  const payload = await req.text();
  const isValid = verifyWebhookSignature(payload, signature, webhookSecret);

  if (!isValid) {
    return NextResponse.json({ success: false, error: 'Invalid webhook signature' }, { status: 401 });
  }

  const event = JSON.parse(payload);
  console.log(\`[Dorisio Webhook] Received \${event.event} at \${event.timestamp}\`);

  return NextResponse.json({ received: true }, { status: 200 });
}
`
      : `import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from 'dorisio-sdk/webhook';

export async function POST(req) {
  const signature = req.headers.get('x-dorisio-signature');
  const webhookSecret = process.env.DORISIO_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ success: false, error: 'Webhook secret not configured' }, { status: 500 });
  }

  if (!signature) {
    return NextResponse.json({ success: false, error: 'Missing X-Dorisio-Signature header' }, { status: 401 });
  }

  const payload = await req.text();
  const isValid = verifyWebhookSignature(payload, signature, webhookSecret);

  if (!isValid) {
    return NextResponse.json({ success: false, error: 'Invalid webhook signature' }, { status: 401 });
  }

  const event = JSON.parse(payload);
  console.log(\`[Dorisio Webhook] Received \${event.event} at \${event.timestamp}\`);

  return NextResponse.json({ received: true }, { status: 200 });
}
`;
  }

  return files;
}
