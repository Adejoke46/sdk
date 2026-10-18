/**
 * Validation Schemas
 *
 * Zod schemas for request validation.
 */

import { z } from 'zod';

// Common validators
export const EmailSchema = z.string().email('Invalid email address');
export const PasswordSchema = z.string().min(8, 'Password must be at least 8 characters');
export const AmountSchema = z.number().positive('Amount must be greater than 0');
export const UsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscore, and dash');

// Auth schemas
export const SignupRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().optional(),
});

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string(),
});

// Creator schemas
export const CreateCreatorRequestSchema = z.object({
  username: UsernameSchema,
  displayName: z.string().optional(),
  bio: z.string().max(500, 'Bio must be at most 500 characters').optional(),
});

export const UpdateCreatorRequestSchema = z.object({
  displayName: z.string().optional(),
  bio: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
  isPublic: z.boolean().optional(),
});

// Tip/Payment schemas
export const CreateTipRequestSchema = z.object({
  creatorId: z.string().min(1, 'Creator ID is required'),
  amount: AmountSchema,
  message: z.string().max(500).optional(),
});

// Wallet schemas
export const CreateWalletRequestSchema = z.object({
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
  name: z.string().optional(),
});

// Pagination schemas
export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

/** Signed webhook event. The timestamp is a Unix millisecond value. */
export const WebhookPayloadSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().int().positive().finite(),
  event: z.string().min(1),
  data: z.record(z.unknown()),
});

/**
 * Validation helper
 */
export class SchemaValidator {
  /**
   * Validate data against schema
   */
  static validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    return schema.parse(data);
  }

  /**
   * Safe validate (returns result with errors)
   */
  static safeParse<T>(schema: z.ZodSchema<T>, data: unknown): z.SafeParseReturnType<unknown, T> {
    return schema.safeParse(data);
  }

  /**
   * Get validation errors
   */
  static getErrors<T>(schema: z.ZodSchema<T>, data: unknown): Record<string, string> | null {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        const path = err.path.join('.');
        errors[path] = err.message;
      });
      return errors;
    }
    return null;
  }
}
