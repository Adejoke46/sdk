import { describe, expect, it } from 'vitest';
import {
  normalizeCreator,
  normalizeTransaction,
  normalizeTransactionHistory,
  normalizeWallet,
} from './normalizers';
import { CreatorMapper, TransactionMapper, WalletMapper } from './mappers';

const creator = {
  id: 'creator-1',
  userId: 'user-1',
  username: 'alice',
  displayName: 'Alice',
  bio: 'Builds useful things',
  avatar: null,
  verified: true,
  isPublic: true,
  totalEarnings: 120,
  pendingBalance: 15,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const wallet = {
  id: 'wallet-1',
  userId: 'user-1',
  publicKey: 'GABC123',
  name: 'Primary',
  verified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const transaction = {
  id: 'tx-1',
  fromUserId: 'user-1',
  creatorId: 'creator-1',
  amount: 25,
  message: 'Thank you',
  status: 'confirmed',
  stellarTxHash: 'hash-1',
  createdAt: '2026-01-03T00:00:00.000Z',
};

describe('normalizer snapshots', () => {
  const withStableTimestamp = <T extends { createdAt?: string }>(value: T): T => ({
    ...value,
    ...(value.createdAt ? { createdAt: '<generated>' } : {}),
  });

  it('normalizes creator, wallet, and transaction responses', () => {
    expect(normalizeCreator({ ...creator, extra: 'ignored' })).toMatchSnapshot('creator');
    expect(normalizeWallet({ ...wallet, extra: 'ignored' })).toMatchSnapshot('wallet');
    expect(normalizeTransaction({ ...transaction, extra: 'ignored' })).toMatchSnapshot(
      'transaction'
    );
  });

  it('normalizes history and mapper output consistently', () => {
    const history = normalizeTransactionHistory({
      transactions: [transaction],
      total: 1,
      page: 1,
      pageSize: 20,
      extra: 'ignored',
    });
    expect(history).toMatchSnapshot('history');
    expect({
      creator: CreatorMapper.fromApi(creator),
      wallet: WalletMapper.fromApi(wallet),
      transaction: TransactionMapper.fromApi(transaction),
      history: TransactionMapper.mapHistory({ transactions: [transaction], total: 1 }),
    }).toMatchSnapshot('mappers');
  });

  it('applies schema defaults for missing optional fields and rejects invalid input', () => {
    expect(withStableTimestamp(normalizeCreator({ id: 'creator-minimal' }))).toMatchSnapshot(
      'creator-minimal'
    );
    expect(withStableTimestamp(normalizeWallet({ id: 'wallet-minimal' }))).toMatchSnapshot(
      'wallet-minimal'
    );
    expect(withStableTimestamp(normalizeTransaction({ id: 'tx-minimal' }))).toMatchSnapshot(
      'transaction-minimal'
    );
    expect(() => normalizeCreator(null)).toThrow();
    expect(() => normalizeWallet({ id: 42 })).toThrow();
  });
});
