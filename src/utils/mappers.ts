/**
 * Response Mappers
 *
 * Transforms backend responses into SDK models.
 * Uses the same Zod-backed normalizers under the hood — no `any` at the
 * boundary; unknown data is narrowed before access.
 */

import { Creator, User, Transaction, Wallet, TransactionHistory } from '../types/models';
import {
  normalizeCreator,
  normalizeUser,
  normalizeTransaction,
  normalizeWallet,
} from './normalizers';

/**
 * Creator mapper
 */
export class CreatorMapper {
  /**
   * Map backend creator response to SDK model
   */
  static fromApi(data: unknown): Creator {
    return normalizeCreator(data);
  }

  /**
   * Map array of creators
   */
  static fromApiArray(data: unknown[]): Creator[] {
    return data.map((item) => this.fromApi(item));
  }
}

/**
 * User mapper
 */
export class UserMapper {
  /**
   * Map backend user response to SDK model
   */
  static fromApi(data: unknown): User {
    return normalizeUser(data);
  }
}

/**
 * Transaction mapper
 */
export class TransactionMapper {
  /**
   * Map backend transaction response to SDK model
   */
  static fromApi(data: unknown): Transaction {
    return normalizeTransaction(data);
  }

  /**
   * Map array of transactions
   */
  static fromApiArray(data: unknown[]): Transaction[] {
    return data.map((item) => this.fromApi(item));
  }

  /**
   * Map transaction history response
   */
  static mapHistory(data: unknown): TransactionHistory {
    if (!data || typeof data !== 'object') {
      return { transactions: [], total: 0, page: 1, pageSize: 20 };
    }
    const obj = data as Record<string, unknown>;
    return {
      transactions: this.fromApiArray(Array.isArray(obj['transactions']) ? obj['transactions'] : []),
      total: Number(obj['total'] ?? 0),
      page: Number(obj['page'] ?? 1),
      pageSize: Number(obj['pageSize'] ?? 20),
    };
  }
}

/**
 * Wallet mapper
 */
export class WalletMapper {
  /**
   * Map backend wallet response to SDK model
   */
  static fromApi(data: unknown): Wallet {
    return normalizeWallet(data);
  }

  /**
   * Map array of wallets
   */
  static fromApiArray(data: unknown[]): Wallet[] {
    return data.map((item) => this.fromApi(item));
  }
}

/**
 * Universal mapper
 */
export class ResponseMapper {
  /**
   * Map response based on type
   */
  static mapResponse<T>(data: unknown, type: string): T {
    switch (type) {
      case 'creator':
        return CreatorMapper.fromApi(data) as T;
      case 'user':
        return UserMapper.fromApi(data) as T;
      case 'transaction':
        return TransactionMapper.fromApi(data) as T;
      case 'wallet':
        return WalletMapper.fromApi(data) as T;
      default:
        return data as T;
    }
  }
}
