/**
 * Domain Models
 *
 * Core type definitions for Dorisio entities.
 */

/**
 * User/Fan entity
 */
export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'fan' | 'creator' | 'admin';
  verified: boolean;
  avatar?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/**
 * User profile response
 */
export interface UserProfile extends User {
  stats?: {
    totalTipsSent: number;
    totalSpent: number;
    creatorsSupported: number;
  };
}

/**
 * User update request
 */
export interface UpdateUserRequest {
  name?: string;
  avatar?: string;
}

/**
 * Wallet entity
 */
export interface Wallet {
  id: string;
  userId: string;
  publicKey: string;
  name: string | null;
  verified: boolean;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Wallet create request
 */
export interface CreateWalletRequest {
  publicKey: string;
  name?: string;
}

/**
 * Wallet update request
 */
export interface UpdateWalletRequest {
  name?: string;
}

/**
 * Creator entity
 */
export interface Creator {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatar: string | null;
  verified: boolean;
  isPublic: boolean;
  totalEarnings: number;
  pendingBalance: number;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Creator with user information
 */
export interface CreatorWithUser extends Creator {
  user: User;
}

/**
 * Creator profile response
 */
export interface CreatorProfile extends Creator {
  stats?: {
    totalTips: number;
    averageTip: number;
    lastTipDate: string | null;
  };
}

/**
 * Creator create request
 */
export interface CreateCreatorRequest {
  username: string;
  displayName?: string;
  bio?: string;
}

/**
 * Transaction entity
 */
export interface Transaction {
  id: string;
  fromUserId: string;
  creatorId: string;
  amount: number;
  message: string | null;
  status: 'pending' | 'confirmed' | 'failed';
  stellarTxHash?: string | null;
  transactionHash?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Creator update request
 */
export interface UpdateCreatorRequest {
  displayName?: string;
  bio?: string;
  avatar?: string;
  isPublic?: boolean;
}

/**
 * Transaction with user information
 */
export interface TransactionWithDetails extends Transaction {
  fromUser: User;
  creator: Creator;
}

/**
 * Transaction history response
 */
export interface TransactionHistory {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Transaction statistics
 */
export interface TransactionStats {
  totalTransactions: number;
  totalAmount: number;
  averageAmount: number;
  lastTransactionDate: string | null;
}

/**
 * Paginated list of creators response
 */
export interface CreatorListResponse {
  creators: Creator[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated list of wallets response
 */
export interface WalletListResponse {
  wallets: Wallet[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Creator earnings summary response
 */
export interface CreatorEarningsResponse {
  totalEarnings: number;
  pendingBalance: number;
  confirmedBalance: number;
  transactionCount: number;
}
