/**
 * Mock Data Generators for Sandbox Mode
 *
 * Generates realistic, optionally deterministic mock responses for offline testing.
 */

export interface MockDataOptions {
  count?: number;
  seed?: number;
}

/**
 * Pseudo-random number generator seeded by value
 */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Deterministic id from seed (avoids uuid randomness in sandbox tests)
 */
export function seededId(seed: number, prefix = 'mock'): string {
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += Math.floor(seededRandom(seed + i) * 16).toString(16);
  }
  return `${prefix}-${hex}`;
}

function seededAddress(seed: number): string {
  let rest = '';
  for (let i = 0; i < 54; i++) {
    rest += Math.floor(seededRandom(seed + 100 + i) * 36)
      .toString(36)
      .toUpperCase();
  }
  return `GA${rest}`.slice(0, 56);
}

function seededHash(seed: number): string {
  let hex = '';
  for (let i = 0; i < 64; i++) {
    hex += Math.floor(seededRandom(seed + 200 + i) * 16).toString(16);
  }
  return `0x${hex}`;
}

/**
 * Mock transaction generator
 */
export function generateMockTransaction(seed = 1) {
  const status = (['pending', 'confirmed', 'failed'] as const)[
    Math.floor(seededRandom(seed + 1) * 3)
  ];
  const createdAt = new Date(Date.UTC(2024, 0, 1) + Math.floor(seededRandom(seed + 3) * 30) * 86400000);

  const creatorId = seededId(seed + 10, 'creator');
  const fromUserId = seededId(seed + 11, 'user');
  return {
    id: seededId(seed, 'tx'),
    amount: Math.floor(seededRandom(seed) * 500) + 1,
    currency: 'USD',
    status,
    creatorId,
    fromUserId,
    senderId: fromUserId,
    message: (
      [
        'Great content!',
        'Love your work',
        'Keep it up!',
        'Amazing video',
        'Thanks for sharing',
        undefined,
      ] as const
    )[Math.floor(seededRandom(seed + 2) * 6)],
    transactionHash: seededHash(seed),
    stellarTxHash: seededHash(seed),
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    confirmedAt:
      status === 'confirmed' || status === 'failed'
        ? new Date(createdAt.getTime() + 5 * 60 * 1000).toISOString()
        : null,
  };
}

/**
 * Mock transactions history generator
 */
export function generateMockTransactionHistory(options: MockDataOptions = {}) {
  const count = options.count || 20;
  const base = options.seed || 0;
  const transactions = Array.from({ length: count }, (_, i) => generateMockTransaction(base + i));

  return {
    transactions,
    total: Math.floor(seededRandom(base + 99) * 1000),
    page: 1,
    pageSize: count,
  };
}

export function generateMockTransactionStats(seed = 1) {
  return {
    totalTransactions: Math.floor(seededRandom(seed) * 500),
    totalAmount: Math.floor(seededRandom(seed + 1) * 50000),
    averageAmount: Math.floor(seededRandom(seed + 2) * 100) + 1,
    lastTransactionDate: new Date().toISOString(),
  };
}

export function generateMockExport(seed = 1) {
  return `id,amount,status\n${seededId(seed, 'tx')},${Math.floor(seededRandom(seed) * 100)},confirmed\n`;
}

/**
 * Mock creator generator
 */
export function generateMockCreator(seed = 1) {
  const names = ['Alice Creator', 'Bob Developer', 'Carol Artist', 'Dave Musician', 'Eve Designer'];
  const name = names[Math.floor(seededRandom(seed) * names.length)] ?? 'Creator';

  const createdAt = new Date(
    Date.UTC(2023, 0, 1) + Math.floor(seededRandom(seed + 4) * 365) * 86400000
  ).toISOString();
  return {
    id: seededId(seed, 'creator'),
    userId: seededId(seed + 5, 'user'),
    username: name.toLowerCase().replace(' ', '_'),
    displayName: name,
    bio: 'Creating amazing content for the community',
    avatar: null,
    verified: seededRandom(seed + 1) > 0.3,
    isPublic: true,
    walletAddress: seededAddress(seed),
    totalEarnings: Math.floor(seededRandom(seed + 2) * 10000),
    pendingBalance: Math.floor(seededRandom(seed + 6) * 1000),
    followerCount: Math.floor(seededRandom(seed + 3) * 100000),
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Mock creators list generator
 */
export function generateMockCreators(options: MockDataOptions = {}) {
  const count = options.count || 10;
  const base = options.seed || 0;
  const creators = Array.from({ length: count }, (_, i) => generateMockCreator(base + i));

  return {
    creators,
    total: Math.floor(seededRandom(base + 99) * 100),
    page: 1,
    pageSize: count,
  };
}

/**
 * Mock wallet generator
 */
export function generateMockWallet(seed = 1) {
  const linkedAt = new Date(
    Date.UTC(2023, 6, 1) + Math.floor(seededRandom(seed + 2) * 180) * 86400000
  ).toISOString();
  const address = seededAddress(seed);
  return {
    id: seededId(seed, 'wallet'),
    userId: seededId(seed + 3, 'user'),
    publicKey: address,
    address,
    name: 'Sandbox Wallet',
    network: seededRandom(seed) > 0.5 ? 'mainnet' : 'testnet',
    balance: Math.floor(seededRandom(seed + 1) * 10000),
    currency: 'XLM',
    verified: true,
    linkedAt,
    createdAt: linkedAt,
    updatedAt: linkedAt,
  };
}

/**
 * Mock user generator
 */
export function generateMockUser(seed = 1) {
  const firstNames = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'];
  const firstName = firstNames[Math.floor(seededRandom(seed) * firstNames.length)] ?? 'User';
  const lastName = lastNames[Math.floor(seededRandom(seed + 1) * lastNames.length)] ?? 'One';

  const createdAt = new Date(
    Date.UTC(2023, 0, 1) + Math.floor(seededRandom(seed + 3) * 365) * 86400000
  ).toISOString();
  return {
    id: seededId(seed, 'user'),
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
    name: `${firstName} ${lastName}`,
    role: (['fan', 'creator', 'admin'] as const)[Math.floor(seededRandom(seed + 2) * 3)],
    avatar: null,
    createdAt,
    updatedAt: createdAt,
    verified: seededRandom(seed + 4) > 0.2,
  };
}

/**
 * Mock session info generator
 */
export function generateMockSession(seed = 1) {
  const user = generateMockUser(seed);
  return {
    userId: user.id,
    email: user.email,
    token: `sandbox.jwt.${seededId(seed, 'tok')}`,
    user,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    expiresIn: 86400,
  };
}

/**
 * Mock creator balance generator
 */
export function generateMockCreatorBalance(seed = 1) {
  return {
    totalEarnings: Math.floor(seededRandom(seed) * 50000),
    pendingBalance: Math.floor(seededRandom(seed + 1) * 5000),
    confirmedBalance: Math.floor(seededRandom(seed + 2) * 45000),
    pending: Math.floor(seededRandom(seed + 1) * 5000),
    nextPayoutDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    minimumThreshold: 10,
    total: Math.floor(seededRandom(seed) * 50000),
    available: Math.floor(seededRandom(seed + 2) * 45000),
    wallets: [
      {
        walletId: seededId(seed, 'wallet'),
        available: Math.floor(seededRandom(seed + 3) * 1000),
        pending: Math.floor(seededRandom(seed + 4) * 100),
        currency: 'USDC',
      },
    ],
  };
}

export function generateMockCreatorEarnings(seed = 1) {
  const balance = generateMockCreatorBalance(seed);
  return {
    totalEarnings: balance.totalEarnings,
    pendingBalance: balance.pendingBalance,
    confirmedBalance: balance.confirmedBalance,
    transactionCount: Math.floor(seededRandom(seed + 5) * 200),
  };
}

export function generateMockAccountSummary(seed = 1) {
  const user = generateMockUser(seed);
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    user,
    balance: {
      total: 100,
      available: 90,
      pending: 10,
      wallets: [
        {
          walletId: seededId(seed + 2, 'wallet'),
          available: 90,
          pending: 10,
          currency: 'USDC',
        },
      ],
    },
    wallets: [generateMockWallet(seed + 2)],
    recentTips: generateMockTransactionHistory({ seed: seed + 3, count: 5 }),
  };
}

/**
 * Mock verification status generator
 */
export function generateMockVerificationStatus(seed = 1) {
  const statuses = ['unverified', 'pending', 'verified'] as const;
  const status = statuses[Math.floor(seededRandom(seed) * statuses.length)] ?? 'pending';
  return {
    status,
    verified: status === 'verified',
    verifiedAt:
      status === 'verified'
        ? new Date(Date.UTC(2024, 0, 1) + Math.floor(seededRandom(seed + 2) * 180) * 86400000).toISOString()
        : undefined,
    expiresAt: new Date(Date.UTC(2025, 0, 1)).toISOString(),
  };
}

/**
 * Mock challenge response generator
 */
export function generateMockChallenge(seed = 1) {
  return {
    challenge: seededId(seed, 'challenge'),
    expiresIn: 300,
  };
}

/**
 * Mock tip response generator
 */
export function generateMockTip(seed = 1, body?: Record<string, unknown>) {
  const status = (['pending', 'confirmed', 'failed'] as const)[
    Math.floor(seededRandom(seed + 1) * 3)
  ];
  const fromUserId = seededId(seed + 11, 'user');
  const now = new Date().toISOString();
  const hash = seededHash(seed);
  return {
    id: seededId(seed, 'tip'),
    amount: typeof body?.amount === 'number' ? body.amount : Math.floor(seededRandom(seed) * 500) + 1,
    currency: 'USD',
    creatorId:
      typeof body?.creatorId === 'string' ? body.creatorId : seededId(seed + 10, 'creator'),
    fromUserId,
    senderId: fromUserId,
    message: typeof body?.message === 'string' ? body.message : 'Thank you!',
    status,
    transactionHash: hash,
    stellarTxHash: hash,
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
  };
}

export function generateMockPaymentBuild(seed = 1) {
  return {
    tipId: seededId(seed, 'tip'),
    xdr: `AAAA${seededId(seed + 1, 'xdr')}`,
    networkPassphrase: 'Test SDF Network ; September 2015',
    fee: 100,
  };
}

export function generateMockPaymentSubmit(seed = 1) {
  return {
    tipId: seededId(seed, 'tip'),
    transactionHash: seededHash(seed),
    status: 'submitted',
  };
}

export function generateMockGeneric(
  seed: number,
  method: string,
  path: string,
  body?: unknown
) {
  return {
    id: seededId(seed, 'resp'),
    method,
    path,
    echo: body ?? null,
    sandbox: true,
  };
}
