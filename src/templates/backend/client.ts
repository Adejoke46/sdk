/**
 * SDK Client Setup and Error Handling Templates
 */

import { Language } from './types';

export function generateClientFile(lang: Language): string {
  const isTs = lang === 'typescript' || lang === 'ts';

  if (isTs) {
    return `/**
 * Dorisio SDK Client Setup
 *
 * Configures the backend DorisioClient singleton with environment variables.
 */

import { DorisioClient, type ClientConfig } from 'dorisio-sdk';

const isSandbox = process.env.DORISIO_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';

export const dorisioConfig: ClientConfig = {
  baseUrl: process.env.DORISIO_API_URL || 'https://api.dorisio.com',
  token: process.env.DORISIO_API_TOKEN,
  mode: isSandbox ? 'sandbox' : 'live',
  timeout: Number(process.env.DORISIO_TIMEOUT_MS) || 30000,
  sandboxSeed: Number(process.env.DORISIO_SANDBOX_SEED) || 42,
};

/**
 * Shared DorisioClient instance
 */
export const dorisio = new DorisioClient(dorisioConfig);
`;
  }

  return `/**
 * Dorisio SDK Client Setup (JavaScript)
 *
 * Configures the backend DorisioClient singleton with environment variables.
 */

import { DorisioClient } from 'dorisio-sdk';

const isSandbox = process.env.DORISIO_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';

export const dorisioConfig = {
  baseUrl: process.env.DORISIO_API_URL || 'https://api.dorisio.com',
  token: process.env.DORISIO_API_TOKEN,
  mode: isSandbox ? 'sandbox' : 'live',
  timeout: Number(process.env.DORISIO_TIMEOUT_MS) || 30000,
  sandboxSeed: Number(process.env.DORISIO_SANDBOX_SEED) || 42,
};

/**
 * Shared DorisioClient instance
 */
export const dorisio = new DorisioClient(dorisioConfig);
`;
}

export function generateErrorHandlerFile(lang: Language): string {
  const isTs = lang === 'typescript' || lang === 'ts';

  if (isTs) {
    return `/**
 * Dorisio Error Handling Helper
 *
 * Catches Dorisio SDK errors and Zod validation errors and formats
 * standard JSON HTTP responses.
 */

import { ZodError } from 'zod';
import { ApiError } from 'dorisio-sdk';

export interface FormattedErrorResponse {
  success: false;
  error: string;
  code?: string;
  statusCode: number;
  details?: unknown;
}

export function formatDorisioError(err: unknown): FormattedErrorResponse {
  if (err instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid request data',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    };
  }

  if (err instanceof ApiError) {
    return {
      success: false,
      error: err.message || 'Dorisio API error',
      code: err.code || 'API_ERROR',
      statusCode: err.statusCode || 500,
      details: err.details,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    success: false,
    error: message || 'Internal server error',
    code: 'INTERNAL_ERROR',
    statusCode: 500,
  };
}
`;
  }

  return `/**
 * Dorisio Error Handling Helper (JavaScript)
 *
 * Catches Dorisio SDK errors and Zod validation errors and formats
 * standard JSON HTTP responses.
 */

import { ZodError } from 'zod';
import { ApiError } from 'dorisio-sdk';

export function formatDorisioError(err) {
  if (err instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid request data',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    };
  }

  if (err instanceof ApiError) {
    return {
      success: false,
      error: err.message || 'Dorisio API error',
      code: err.code || 'API_ERROR',
      statusCode: err.statusCode || 500,
      details: err.details,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    success: false,
    error: message || 'Internal server error',
    code: 'INTERNAL_ERROR',
    statusCode: 500,
  };
}
`;
}
