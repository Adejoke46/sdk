/**
 * Schema exports for consumer validation
 *
 * Re-exports Zod schemas from the validation utility layer.
 * These are the canonical schema definitions used throughout the SDK.
 */

import { z } from 'zod';
import {
  EmailSchema,
  PasswordSchema,
  AmountSchema,
  UsernameSchema,
  SignupRequestSchema,
  LoginRequestSchema,
  CreateCreatorRequestSchema,
  UpdateCreatorRequestSchema,
  CreateTipRequestSchema,
  CreateWalletRequestSchema,
  PaginationSchema,
  WebhookPayloadSchema,
} from '../utils/validation-schemas';

// Grouped schema exports for organized access
export const Schemas = {
  Email: EmailSchema,
  Password: PasswordSchema,
  Amount: AmountSchema,
  Username: UsernameSchema,
  Pagination: PaginationSchema,
  WebhookPayload: WebhookPayloadSchema,
};

export const AuthSchemas = {
  Signup: SignupRequestSchema,
  Login: LoginRequestSchema,
};

export const PaymentSchemas = {
  CreateTip: CreateTipRequestSchema,
};

export const CreatorSchemas = {
  Create: CreateCreatorRequestSchema,
  Update: UpdateCreatorRequestSchema,
};

export const WalletSchemas = {
  Create: CreateWalletRequestSchema,
};

// Type exports for schema consumers
export type LoginInput = z.infer<typeof LoginRequestSchema>;
export type RegisterInput = z.infer<typeof SignupRequestSchema>;
export type WalletChallengeInput = unknown;
export type WalletVerificationInput = unknown;
export type CreateTipInput = z.infer<typeof CreateTipRequestSchema>;
export type TransactionDetails = unknown;
export type PaymentHistoryFilterInput = unknown;
export type CreatorProfile = unknown;
export type CreatorProfileInput = unknown;
export type CreatorVerificationInput = unknown;
export type CreatorPayoutInput = unknown;
export type WalletInfo = unknown;
export type LinkWalletInput = unknown;

// API schema types (placeholders for API response models)
export type ApiUser = unknown;
export type ApiCreator = unknown;
export type ApiWallet = unknown;
export type ApiTransaction = unknown;
export type ApiListCreators = unknown;
export type ApiTransactionHistory = unknown;
export type ApiTransactionStats = unknown;
export type ApiSession = unknown;
export type ApiSessionExpiry = unknown;
export type ApiBalanceInfo = unknown;
export type ApiAccountBalance = unknown;
export type ApiCreatorEarnings = {
  totalEarnings: number;
  pendingBalance: number;
  confirmedBalance: number;
  transactionCount: number;
};
export type ApiCreatorPendingPayout = unknown;
export type ApiAccountSummary = unknown;
export type ApiVerificationStatus = unknown;
export type ApiWalletChallenge = unknown;

// Re-export individual schema items for backwards compatibility
export const ApiUserSchema = z.object({});
export const ApiCreatorSchema = z.object({});
export const ApiWalletSchema = z.object({});
export const ApiTransactionSchema = z.object({});
export const ApiListCreatorsSchema = z.object({});
export const ApiTransactionHistorySchema = z.object({});
export const ApiTransactionStatsSchema = z.object({});
export const ApiSessionSchema = z.object({});
export const ApiSessionExpirySchema = z.object({});
export const ApiBalanceInfoSchema = z.object({});
export const ApiAccountBalanceSchema = z.object({});
export const ApiCreatorEarningsSchema = z.object({
  totalEarnings: z.number(),
  pendingBalance: z.number(),
  confirmedBalance: z.number(),
  transactionCount: z.number(),
});
export const ApiCreatorPendingPayoutSchema = z.object({});
export const ApiAccountSummarySchema = z.object({});
export const ApiVerificationStatusSchema = z.object({});
export const ApiWalletChallengeSchema = z.object({});
export const CreatorProfileSchema = z.object({});
