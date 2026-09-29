import crypto from 'crypto';

export interface RequestSignerOptions {
  /**
   * Secret key or mapping of keyId -> secret for key rotation.
   * If a string is provided, it is used as the primary secret without a key ID prefix.
   */
  secret: string | Record<string, string>;
  /** Active key ID when using key rotation with a secret map */
  keyId?: string;
  /** Header name to include signature (default: 'X-Signature') */
  signatureHeader?: string;
  /** Header name to include timestamp (default: 'X-Timestamp') */
  timestampHeader?: string;
  /** Header name to include key ID when rotating keys (default: 'X-Key-Id') */
  keyIdHeader?: string;
}

/**
 * RequestSigner computes HMAC-SHA256 signatures for HTTP requests
 * and injects signature headers for backend verification.
 */
export class RequestSigner {
  private secret: string | Record<string, string>;
  private keyId?: string;
  private signatureHeader: string;
  private timestampHeader: string;
  private keyIdHeader: string;

  constructor(options: RequestSignerOptions) {
    if (!options || !options.secret) {
      throw new Error('RequestSigner requires a secret or secret map');
    }
    this.secret = options.secret;
    this.keyId = options.keyId;
    this.signatureHeader = options.signatureHeader || 'X-Signature';
    this.timestampHeader = options.timestampHeader || 'X-Timestamp';
    this.keyIdHeader = options.keyIdHeader || 'X-Key-Id';
  }

  /**
   * Update the signing secret or secret map (supports key rotation)
   */
  public setSecret(secret: string | Record<string, string>, keyId?: string): void {
    this.secret = secret;
    if (keyId !== undefined) {
      this.keyId = keyId;
    }
  }

  /**
   * Get the active secret and key ID to use for signing
   */
  private resolveSecret(): { secretKey: string; activeKeyId?: string } {
    if (typeof this.secret === 'string') {
      return { secretKey: this.secret, activeKeyId: this.keyId };
    }
    const activeKeyId = this.keyId || Object.keys(this.secret)[0];
    if (!activeKeyId || !this.secret[activeKeyId]) {
      throw new Error('RequestSigner: No valid secret found for active key ID');
    }
    return { secretKey: this.secret[activeKeyId], activeKeyId };
  }

  /**
   * Sign request headers, method, path, and body with HMAC-SHA256.
   * Adds X-Signature, X-Timestamp, and optionally X-Key-Id headers.
   */
  public signRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
    timestampOverride?: number
  ): Record<string, string> {
    const timestamp = String(timestampOverride ?? Date.now());
    const { secretKey, activeKeyId } = this.resolveSessionSecret();

    const normalizedMethod = method.toUpperCase();
    const cleanPath = path;
    const bodyString = body !== undefined && body !== null ? JSON.stringify(body) : '';

    // Canonical string format: method\npath\ntimestamp\nbody
    const canonicalString = `${normalizedMethod}\n${cleanPath}\n${timestamp}\n${bodyString}`;

    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(canonicalString)
      .digest('hex');

    const updatedHeaders: Record<string, string> = { ...headers };
    updatedHeaders[this.signatureHeader] = signature;
    updatedHeaders[this.timestampHeader] = timestamp;
    if (activeKeyId) {
      updatedHeaders[this.keyIdHeader] = activeKeyId;
    }

    return updatedHeaders;
  }

  private resolveSessionSecret(): { secretKey: string; activeKeyId?: string } {
    return this.resolveSecret();
  }
}
