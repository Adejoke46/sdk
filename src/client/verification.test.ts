/**
 * Verification Client Tests
 * Tests for verification SDK methods covering creator identity, wallet verification,
 * challenges, and transaction verification status.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DorisioClient } from '../client';
import * as VerificationMethods from './verification';

describe('Verification Methods', () => {
  let client: DorisioClient;
  const mockRequest = vi.fn();

  beforeEach(() => {
    client = {
      request: mockRequest,
    } as any;

    client.verifyCreator = VerificationMethods.verifyCreator.bind(client as any) as any;
    client.requestCreatorVerification = VerificationMethods.requestCreatorVerification.bind(client);
    client.getCreatorVerificationStatus = VerificationMethods.getCreatorVerificationStatus.bind(client);
    client.verifyWallet = VerificationMethods.verifyWallet.bind(client as any) as any;
    client.getWalletVerificationStatus = VerificationMethods.getWalletVerificationStatus.bind(client);
    client.requestWalletVerificationChallenge =
      VerificationMethods.requestWalletVerificationChallenge.bind(client);
    client.isTransactionVerified = VerificationMethods.isTransactionVerified.bind(client);

    mockRequest.mockClear();
  });

  describe('verifyCreator', () => {
    it('verifies creator and returns normalized Creator model', async () => {
      const rawCreator = {
        id: 'c-1',
        userId: 'u-1',
        username: 'creator1',
        displayName: 'Creator One',
        verified: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawCreator,
      });

      const result = await (client.verifyCreator as any)('c-1');

      expect(result.id).toBe('c-1');
      expect(result.verified).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/creators/c-1/verify');
    });

    it('throws error when verifying creator fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Verification error' },
      });

      await expect((client.verifyCreator as any)('c-invalid')).rejects.toThrow(
        'Failed to verify creator: c-invalid'
      );
    });
  });

  describe('requestCreatorVerification', () => {
    it('submits verification request and returns verification status', async () => {
      const statusData = {
        verified: false,
        status: 'pending',
        verifiedAt: undefined,
        expiresAt: '2024-12-31T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: statusData,
      });

      const requestPayload = {
        documentType: 'passport',
        documentUrl: 'https://docs.example.com/id.pdf',
        description: 'Identity verification for creator account',
      };

      const result = await client.requestCreatorVerification('c-1', requestPayload);

      expect(result.verified).toBe(false);
      expect(result.expiresAt).toBe('2024-12-31T00:00:00Z');
      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/creators/c-1/request-verification',
        requestPayload
      );
    });

    it('throws error when request verification fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Invalid documents' },
      });

      await expect(
        client.requestCreatorVerification('c-1', { documentType: 'id' })
      ).rejects.toThrow('Failed to request verification for creator: c-1');
    });
  });

  describe('getCreatorVerificationStatus', () => {
    it('fetches creator verification status with custom status', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: {
          verified: true,
          verifiedAt: '2024-01-15T00:00:00Z',
          status: 'verified',
        },
      });

      const result = await client.getCreatorVerificationStatus('c-1');

      expect(result.verified).toBe(true);
      expect(result.verifiedAt).toBe('2024-01-15T00:00:00Z');
      expect(result.status).toBe('verified');
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/c-1/verification-status');
    });

    it('defaults status to unverified when omitted in response', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: {
          verified: false,
        },
      });

      const result = await client.getCreatorVerificationStatus('c-2');

      expect(result.verified).toBe(false);
      expect(result.status).toBe('unverified');
    });

    it('throws error when fetching creator verification status fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Creator not found' },
      });

      await expect(client.getCreatorVerificationStatus('invalid')).rejects.toThrow(
        'Failed to fetch verification status for creator: invalid'
      );
    });
  });

  describe('verifyWallet', () => {
    it('verifies wallet with proof string and returns normalized wallet', async () => {
      const rawWallet = {
        id: 'w-1',
        userId: 'u-1',
        publicKey: 'GKEY123',
        verified: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawWallet,
      });

      const result = await client.verifyWallet('w-1', 'signature_proof_abc');

      expect(result.id).toBe('w-1');
      expect(result.verified).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/wallets/w-1/verify', {
        proof: 'signature_proof_abc',
      });
    });

    it('throws error when wallet verification fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Invalid proof' },
      });

      await expect(client.verifyWallet('w-invalid', 'bad_proof')).rejects.toThrow(
        'Failed to verify wallet: w-invalid'
      );
    });
  });

  describe('getWalletVerificationStatus', () => {
    it('fetches wallet verification status', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: {
          verified: true,
          verifiedAt: '2024-01-20T00:00:00Z',
          expiresAt: '2025-01-20T00:00:00Z',
        },
      });

      const result = await client.getWalletVerificationStatus('w-10');

      expect(result.verified).toBe(true);
      expect(result.verifiedAt).toBe('2024-01-20T00:00:00Z');
      expect(result.expiresAt).toBe('2025-01-20T00:00:00Z');
      expect(mockRequest).toHaveBeenCalledWith('GET', '/wallets/w-10/verification-status');
    });

    it('throws error on failed wallet verification status query', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Wallet not found' },
      });

      await expect(client.getWalletVerificationStatus('w-missing')).rejects.toThrow(
        'Failed to fetch verification status for wallet: w-missing'
      );
    });
  });

  describe('requestWalletVerificationChallenge', () => {
    it('requests challenge for wallet verification', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: {
          challenge: 'CHALLENGE_XDR_STRING_123',
          expiresIn: 300,
        },
      });

      const result = await client.requestWalletVerificationChallenge('w-10');

      expect(result.challenge).toBe('CHALLENGE_XDR_STRING_123');
      expect(result.expiresIn).toBe(300);
      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/wallets/w-10/verification-challenge'
      );
    });

    it('throws error when challenge request fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Challenge generation failed' },
      });

      await expect(client.requestWalletVerificationChallenge('w-err')).rejects.toThrow(
        'Failed to request verification challenge for wallet: w-err'
      );
    });
  });

  describe('isTransactionVerified', () => {
    it('returns true when transaction is verified', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: true,
      });

      const verified = await client.isTransactionVerified('tx-1');
      expect(verified).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/transactions/tx-1/verified');
    });

    it('returns false when transaction is not verified', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: false,
      });

      const verified = await client.isTransactionVerified('tx-2');
      expect(verified).toBe(false);
    });

    it('throws error when transaction verification check fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Transaction not found' },
      });

      await expect(client.isTransactionVerified('tx-invalid')).rejects.toThrow(
        'Failed to check verification status for transaction: tx-invalid'
      );
    });
  });
});
