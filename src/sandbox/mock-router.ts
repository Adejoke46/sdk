/**
 * Sandbox Mock Router
 *
 * Routes HTTP requests to deterministic mock responses when the SDK is in
 * sandbox mode. Maintains a request history for offline test assertions.
 */

import * as MockData from './mock-data';

export interface SandboxHistoryEntry {
  method: string;
  path: string;
  body?: unknown;
  response: unknown;
  timestamp: string;
  durationMs: number;
}

export interface MockRouterOptions {
  seed?: number;
  latency?: number;
  errorRate?: number;
}

/**
 * Generates mock API responses and records sandbox request history.
 */
export class MockRouter {
  private seed: number;
  private latency: number;
  private errorRate: number;
  private counter = 0;
  private history: SandboxHistoryEntry[] = [];

  constructor(options: MockRouterOptions = {}) {
    this.seed = options.seed ?? 42;
    this.latency = options.latency ?? 0;
    this.errorRate = options.errorRate ?? 0;
  }

  setSeed(seed: number): void {
    this.seed = seed;
    this.counter = 0;
  }

  setLatency(latency: number): void {
    this.latency = Math.max(0, latency);
  }

  setErrorRate(errorRate: number): void {
    this.errorRate = Math.max(0, Math.min(1, errorRate));
  }

  getHistory(): readonly SandboxHistoryEntry[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  reset(): void {
    this.counter = 0;
    this.history = [];
  }

  private nextSeed(): number {
    return this.seed + this.counter++;
  }

  private async simulateLatency(): Promise<void> {
    if (this.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    }
  }

  private checkError(): void {
    if (this.errorRate > 0 && Math.random() < this.errorRate) {
      throw new Error('Simulated network error in sandbox mode');
    }
  }

  /**
   * Handle a sandbox request and return a mock ApiResponse-shaped payload.
   */
  async handle(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ success: boolean; data: unknown }> {
    const started = Date.now();
    await this.simulateLatency();
    this.checkError();

    const seed = this.nextSeed();
    const response = {
      success: true as const,
      data: this.route(method.toUpperCase(), path, body, seed),
    };

    this.history.push({
      method: method.toUpperCase(),
      path,
      body,
      response,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - started,
    });

    return response;
  }

  private route(method: string, path: string, body: unknown, seed: number): unknown {
    const clean = path.split('?')[0] ?? path;

    // GraphQL queries & mutations
    if (clean.includes('/graphql') && method === 'POST') {
      return this.routeGraphQL(body, seed);
    }

    // Tips / transactions (api/v1 and bare paths)
    if (clean.includes('/transactions/tip') && method === 'POST') {
      return MockData.generateMockTip(seed, body as Record<string, unknown> | undefined);
    }
    if (clean.includes('/transactions/history') || /\/transactions\/?$/.test(clean)) {
      if (method === 'GET' && (clean.includes('history') || clean.includes('/transactions'))) {
        if (clean.includes('/stats')) {
          return MockData.generateMockTransactionStats(seed);
        }
        if (clean.includes('/export')) {
          return MockData.generateMockExport(seed);
        }
        return MockData.generateMockTransactionHistory({ seed });
      }
    }
    if (clean.includes('/transactions/creator/')) {
      return MockData.generateMockTransactionHistory({ seed, count: 10 });
    }
    if (clean.includes('/transactions/') && clean.endsWith('/build') && method === 'POST') {
      return MockData.generateMockPaymentBuild(seed);
    }
    if (clean.includes('/transactions/') && clean.endsWith('/submit') && method === 'POST') {
      return MockData.generateMockPaymentSubmit(seed);
    }
    if (clean.includes('/transactions/') && clean.endsWith('/confirm')) {
      return { ...MockData.generateMockTransaction(seed), status: 'confirmed' };
    }
    if (clean.includes('/transactions/') && clean.endsWith('/status') && method === 'PATCH') {
      const status =
        (body as { status?: string } | undefined)?.status ?? 'pending';
      return { ...MockData.generateMockTransaction(seed), status };
    }
    if (clean.includes('/transactions/') && clean.endsWith('/verified')) {
      return true;
    }
    if (/\/transactions\/[^/]+$/.test(clean) && method === 'GET') {
      return MockData.generateMockTransaction(seed);
    }

    // Creators
    if (clean.includes('/creators/') && clean.endsWith('/earnings')) {
      return MockData.generateMockCreatorEarnings(seed);
    }
    if (clean.includes('/creators/') && clean.endsWith('/payout-pending')) {
      return MockData.generateMockCreatorBalance(seed);
    }
    if (clean.includes('/creators/') && clean.endsWith('/can-payout')) {
      return true;
    }
    if (
      clean.includes('/creators/') &&
      (clean.endsWith('/verify') ||
        clean.endsWith('/request-verification') ||
        clean.endsWith('/verification-status'))
    ) {
      return MockData.generateMockVerificationStatus(seed);
    }
    if (clean.includes('/creators/profile/')) {
      return MockData.generateMockCreator(seed);
    }
    if (/\/creators\/[^/]+$/.test(clean)) {
      return method === 'PATCH' || method === 'POST'
        ? MockData.generateMockCreator(seed)
        : MockData.generateMockCreator(seed);
    }
    if (clean.includes('/creators')) {
      return MockData.generateMockCreators({ seed });
    }

    // Wallets
    if (clean.includes('/wallets/') && clean.endsWith('/balance')) {
      return MockData.generateMockWallet(seed);
    }
    if (
      clean.includes('/wallets/') &&
      (clean.endsWith('/verify') ||
        clean.endsWith('/verification-status') ||
        clean.endsWith('/verification-challenge'))
    ) {
      if (clean.endsWith('/verification-challenge')) {
        return MockData.generateMockChallenge(seed);
      }
      return MockData.generateMockVerificationStatus(seed);
    }
    if (clean === '/wallets' && method === 'POST') {
      return MockData.generateMockWallet(seed);
    }
    if (/\/wallets\/[^/]+$/.test(clean)) {
      if (method === 'DELETE') {
        return { deleted: true };
      }
      return MockData.generateMockWallet(seed);
    }
    if (clean.includes('/wallets')) {
      return [MockData.generateMockWallet(seed), MockData.generateMockWallet(seed + 1)];
    }

    // Auth / users
    if (clean.includes('/auth/refresh') || clean.includes('/auth/extend')) {
      return MockData.generateMockSession(seed);
    }
    if (clean.includes('/auth/validate')) {
      return MockData.generateMockUser(seed);
    }
    if (clean.includes('/auth/login') || clean.includes('/auth/register')) {
      return MockData.generateMockSession(seed);
    }
    if (clean.includes('/auth/logout')) {
      return { loggedOut: true };
    }
    if (clean.includes('/auth/expiry')) {
      return { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
    }
    if (clean.includes('/auth/challenge')) {
      return MockData.generateMockChallenge(seed);
    }
    if (clean.includes('/users/') && clean.endsWith('/balance')) {
      return MockData.generateMockCreatorBalance(seed);
    }
    if (clean.includes('/users/') && clean.endsWith('/wallets')) {
      return [MockData.generateMockWallet(seed)];
    }
    if (clean.includes('/users/me/summary') || clean.endsWith('/summary')) {
      return MockData.generateMockAccountSummary(seed);
    }
    if (clean.includes('/users/me') || clean.includes('/users')) {
      return MockData.generateMockUser(seed);
    }

    // Generic fallback — still deterministic
    return MockData.generateMockGeneric(seed, method, clean, body);
  }

  private routeGraphQL(body: unknown, seed: number): unknown {
    const payload = body as
      | { query?: string; variables?: Record<string, unknown>; operationName?: string }
      | undefined;
    const query = payload?.query ?? '';
    const op = payload?.operationName ?? '';
    const vars = payload?.variables ?? {};

    if (/mutation\s+CreateTip|createTip\s*\(/i.test(query) || op === 'CreateTip') {
      return {
        createTip: MockData.generateMockTip(seed, vars.input as Record<string, unknown> | undefined),
      };
    }

    if (/GetCreatorProfile|creatorProfile\s*\(/i.test(query) || op === 'GetCreatorProfile') {
      const creator = MockData.generateMockCreator(seed);
      return {
        creatorProfile: {
          ...creator,
          stats: {
            totalTips: Math.floor(MockData.seededRandom(seed + 1) * 100),
            averageTip: Math.floor(MockData.seededRandom(seed + 2) * 50) + 5,
            lastTipDate: new Date().toISOString(),
          },
        },
      };
    }

    if (/GetCreatorWithUser/i.test(query) || (query.includes('creator') && query.includes('user {'))) {
      const creator = MockData.generateMockCreator(seed);
      const user = MockData.generateMockUser(seed);
      return {
        creator: {
          ...creator,
          user,
        },
      };
    }

    if (/GetCreator\b|creator\s*\(/i.test(query) || op === 'GetCreator' || op === 'GetCreatorCustom') {
      return {
        creator: MockData.generateMockCreator(seed),
      };
    }

    if (/ListCreators\b|creators\s*\(/i.test(query) || op === 'ListCreators' || op === 'ListCreatorsCustom') {
      const mockCreators = MockData.generateMockCreators({ seed });
      return {
        creators: {
          creators: mockCreators.creators,
          total: mockCreators.total,
          page: mockCreators.page,
          pageSize: mockCreators.pageSize,
        },
      };
    }

    if (/GetTransactionWithDetails/i.test(query) || (query.includes('transaction') && query.includes('fromUser {'))) {
      const tx = MockData.generateMockTransaction(seed);
      const user = MockData.generateMockUser(seed);
      const creator = MockData.generateMockCreator(seed);
      return {
        transaction: {
          ...tx,
          fromUser: user,
          creator,
        },
      };
    }

    if (
      /GetTransactionHistory\b|transactionHistory\s*\(/i.test(query) ||
      op === 'GetTransactionHistory' ||
      op === 'GetTransactionHistoryCustom'
    ) {
      const history = MockData.generateMockTransactionHistory({ seed });
      return {
        transactionHistory: history,
      };
    }

    if (/GetTransaction\b|transaction\s*\(/i.test(query) || op === 'GetTransaction' || op === 'GetTransactionCustom') {
      return {
        transaction: MockData.generateMockTransaction(seed),
      };
    }

    if (/GetWallets\b|wallets\s*\(/i.test(query) || op === 'GetWallets') {
      const wallets = [MockData.generateMockWallet(seed), MockData.generateMockWallet(seed + 1)];
      return {
        wallets: {
          wallets,
          total: wallets.length,
          page: 1,
          pageSize: 10,
        },
      };
    }

    if (/GetWallet\b|wallet\s*\(/i.test(query) || op === 'GetWallet') {
      return {
        wallet: MockData.generateMockWallet(seed),
      };
    }

    return MockData.generateMockGeneric(seed, 'POST', '/graphql', body);
  }
}
