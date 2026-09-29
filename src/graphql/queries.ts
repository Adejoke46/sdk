/**
 * GraphQL Queries and Mutations
 *
 * Pre-defined query and mutation documents and query builder helpers
 * for flexible, type-safe data fetching while avoiding over-fetching and N+1 queries.
 */

import type { Creator, Transaction } from '../types/models';

/**
 * Standard query to fetch a single creator by ID
 */
export const GET_CREATOR = `
  query GetCreator($id: ID!) {
    creator(id: $id) {
      id
      userId
      username
      displayName
      bio
      avatar
      verified
      isPublic
      totalEarnings
      pendingBalance
      createdAt
      updatedAt
    }
  }
`;

/**
 * Resolves N+1 problem by fetching a creator and associated user account in one query
 */
export const GET_CREATOR_WITH_USER = `
  query GetCreatorWithUser($id: ID!) {
    creator(id: $id) {
      id
      userId
      username
      displayName
      bio
      avatar
      verified
      isPublic
      totalEarnings
      pendingBalance
      createdAt
      updatedAt
      user {
        id
        email
        name
        role
        verified
        avatar
        createdAt
        updatedAt
      }
    }
  }
`;

/**
 * Standard query to fetch a paginated list of creators
 */
export const LIST_CREATORS = `
  query ListCreators($page: Int, $pageSize: Int, $verified: Boolean) {
    creators(page: $page, pageSize: $pageSize, verified: $verified) {
      creators {
        id
        userId
        username
        displayName
        bio
        avatar
        verified
        isPublic
        totalEarnings
        pendingBalance
        createdAt
        updatedAt
      }
      total
      page
      pageSize
    }
  }
`;

/**
 * Query creator profile with aggregated tip statistics
 */
export const GET_CREATOR_PROFILE = `
  query GetCreatorProfile($username: String!) {
    creatorProfile(username: $username) {
      id
      userId
      username
      displayName
      bio
      avatar
      verified
      isPublic
      totalEarnings
      pendingBalance
      createdAt
      updatedAt
      stats {
        totalTips
        averageTip
        lastTipDate
      }
    }
  }
`;

/**
 * Standard query to fetch a transaction by ID
 */
export const GET_TRANSACTION = `
  query GetTransaction($id: ID!) {
    transaction(id: $id) {
      id
      fromUserId
      creatorId
      amount
      message
      status
      stellarTxHash
      transactionHash
      createdAt
      updatedAt
    }
  }
`;

/**
 * Resolves N+1 problem by fetching transaction details, sender user, and creator in a single query
 */
export const GET_TRANSACTION_WITH_DETAILS = `
  query GetTransactionWithDetails($id: ID!) {
    transaction(id: $id) {
      id
      fromUserId
      creatorId
      amount
      message
      status
      stellarTxHash
      transactionHash
      createdAt
      updatedAt
      fromUser {
        id
        email
        name
        role
        verified
        avatar
        createdAt
      }
      creator {
        id
        userId
        username
        displayName
        avatar
        verified
      }
    }
  }
`;

/**
 * Query paginated transaction history
 */
export const GET_TRANSACTION_HISTORY = `
  query GetTransactionHistory($page: Int, $pageSize: Int, $creatorId: ID, $status: String) {
    transactionHistory(page: $page, pageSize: $pageSize, creatorId: $creatorId, status: $status) {
      transactions {
        id
        fromUserId
        creatorId
        amount
        message
        status
        stellarTxHash
        transactionHash
        createdAt
        updatedAt
      }
      total
      page
      pageSize
    }
  }
`;

/**
 * Query wallet by ID
 */
export const GET_WALLET = `
  query GetWallet($id: ID!) {
    wallet(id: $id) {
      id
      userId
      publicKey
      name
      verified
      createdAt
      updatedAt
    }
  }
`;

/**
 * Query wallets by user ID
 */
export const GET_WALLETS = `
  query GetWallets($userId: ID!) {
    wallets(userId: $userId) {
      wallets {
        id
        userId
        publicKey
        name
        verified
        createdAt
        updatedAt
      }
      total
      page
      pageSize
    }
  }
`;

/**
 * Mutation to create a tip transaction
 */
export const CREATE_TIP = `
  mutation CreateTip($input: CreateTipInput!) {
    createTip(input: $input) {
      id
      fromUserId
      creatorId
      amount
      message
      status
      stellarTxHash
      transactionHash
      createdAt
      updatedAt
    }
  }
`;

/**
 * Build a customized GraphQL query requesting only specified fields
 * to eliminate over-fetching.
 */
export function buildCreatorQuery(fields?: (keyof Creator | 'user' | string)[]): string {
  const selectedFields =
    fields && fields.length > 0
      ? fields.join('\n      ')
      : `id
      userId
      username
      displayName
      bio
      avatar
      verified
      isPublic
      totalEarnings
      pendingBalance
      createdAt
      updatedAt`;

  return `query GetCreatorCustom($id: ID!) {
  creator(id: $id) {
    ${selectedFields}
  }
}`.trim();
}

/**
 * Build a customized GraphQL query to list creators with specified fields
 */
export function buildListCreatorsQuery(
  fields?: (keyof Creator | string)[],
  options?: { page?: number; pageSize?: number; verified?: boolean }
): string {
  const selectedFields =
    fields && fields.length > 0
      ? fields.join('\n        ')
      : `id
        userId
        username
        displayName
        bio
        avatar
        verified
        isPublic
        totalEarnings
        pendingBalance
        createdAt
        updatedAt`;

  const pageArg = options?.page !== undefined ? `$page: Int, ` : '';
  const pageSizeArg = options?.pageSize !== undefined ? `$pageSize: Int, ` : '';
  const verifiedArg = options?.verified !== undefined ? `$verified: Boolean` : '';
  const varDefs = [pageArg, pageSizeArg, verifiedArg].filter(Boolean).join('');
  const varClause = varDefs ? `(${varDefs.replace(/,\s*$/, '')})` : '($page: Int, $pageSize: Int, $verified: Boolean)';

  return `query ListCreatorsCustom${varClause} {
  creators(page: $page, pageSize: $pageSize, verified: $verified) {
    creators {
      ${selectedFields}
    }
    total
    page
    pageSize
  }
}`.trim();
}

/**
 * Build a customized GraphQL query for a transaction requesting only specified fields
 */
export function buildTransactionQuery(
  fields?: (keyof Transaction | 'fromUser' | 'creator' | string)[]
): string {
  const selectedFields =
    fields && fields.length > 0
      ? fields.join('\n      ')
      : `id
      fromUserId
      creatorId
      amount
      message
      status
      stellarTxHash
      transactionHash
      createdAt
      updatedAt`;

  return `query GetTransactionCustom($id: ID!) {
  transaction(id: $id) {
    ${selectedFields}
  }
}`.trim();
}

/**
 * Build a customized GraphQL query for transaction history
 */
export function buildTransactionHistoryQuery(
  fields?: (keyof Transaction | string)[]
): string {
  const selectedFields =
    fields && fields.length > 0
      ? fields.join('\n        ')
      : `id
        fromUserId
        creatorId
        amount
        message
        status
        stellarTxHash
        transactionHash
        createdAt
        updatedAt`;

  return `query GetTransactionHistoryCustom($page: Int, $pageSize: Int, $creatorId: ID, $status: String) {
  transactionHistory(page: $page, pageSize: $pageSize, creatorId: $creatorId, status: $status) {
    transactions {
      ${selectedFields}
    }
    total
    page
    pageSize
  }
}`.trim();
}

/**
 * Generic query builder for arbitrary operations
 */
export function buildCustomQuery(options: {
  operationType?: 'query' | 'mutation';
  operationName?: string;
  field: string;
  variables?: Record<string, string>;
  args?: Record<string, string>;
  fields: string[];
}): string {
  const opType = options.operationType ?? 'query';
  const opName = options.operationName ?? 'CustomOperation';
  const varEntries = options.variables ? Object.entries(options.variables) : [];
  const varDefs =
    varEntries.length > 0
      ? `(${varEntries.map(([k, v]) => `$${k}: ${v}`).join(', ')})`
      : '';
  const argEntries = options.args ? Object.entries(options.args) : [];
  const argDefs =
    argEntries.length > 0
      ? `(${argEntries.map(([k, v]) => `${k}: ${v}`).join(', ')})`
      : '';
  const fields = options.fields.join('\n    ');

  return `${opType} ${opName}${varDefs} {
  ${options.field}${argDefs} {
    ${fields}
  }
}`.trim();
}
