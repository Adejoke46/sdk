import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  generateOpenApiSpec,
  generateDocumentationHtml,
  saveOpenApiSpec,
} from './generate-openapi';

describe('OpenAPI Spec Generator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('generates a valid OpenAPI 3.0.3 specification object', () => {
    const spec = generateOpenApiSpec();

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Dorisio API');
    expect(spec.info.version).toBe('0.1.0');
    expect(spec.servers).toHaveLength(2);
    expect(spec.tags.length).toBeGreaterThanOrEqual(5);
  });

  it('includes all core client endpoint paths', () => {
    const spec = generateOpenApiSpec();
    const paths = Object.keys(spec.paths);

    // Creators
    expect(paths).toContain('/creators');
    expect(paths).toContain('/creators/{creatorId}');
    expect(paths).toContain('/creators/{username}/profile');
    expect(paths).toContain('/creators/{creatorId}/verify');

    // Wallets
    expect(paths).toContain('/wallets');
    expect(paths).toContain('/wallets/{walletId}');
    expect(paths).toContain('/wallets/{walletId}/balance');
    expect(paths).toContain('/wallets/{walletId}/verify');
    expect(paths).toContain('/wallets/{walletId}/verify/challenge');

    // Transactions / Payments
    expect(paths).toContain('/transactions/tip');
    expect(paths).toContain('/transactions/history');
    expect(paths).toContain('/transactions/stats');
    expect(paths).toContain('/transactions/{tipId}/build');
    expect(paths).toContain('/transactions/{tipId}/submit');
    expect(paths).toContain('/transactions/{tipId}/confirm');
    expect(paths).toContain('/transactions/{transactionId}');

    // Auth
    expect(paths).toContain('/auth/login');
    expect(paths).toContain('/auth/register');
    expect(paths).toContain('/auth/refresh');
    expect(paths).toContain('/auth/validate');
    expect(paths).toContain('/auth/logout');
    expect(paths).toContain('/auth/expiry');

    // Webhooks
    expect(paths).toContain('/webhooks');
  });

  it('includes complete component schemas matching SDK types', () => {
    const spec = generateOpenApiSpec();
    const schemas = spec.components.schemas;

    expect(schemas.User).toBeDefined();
    expect(schemas.Wallet).toBeDefined();
    expect(schemas.Creator).toBeDefined();
    expect(schemas.Transaction).toBeDefined();
    expect(schemas.CreateTipRequest).toBeDefined();
    expect(schemas.BuildTransactionRequest).toBeDefined();
    expect(schemas.BuildTransactionResponse).toBeDefined();
    expect(schemas.SessionInfo).toBeDefined();
    expect(schemas.ApiError).toBeDefined();

    // Verify properties on Transaction schema
    expect(schemas.Transaction?.properties?.id).toBeDefined();
    expect(schemas.Transaction?.properties?.amount).toBeDefined();
    expect(schemas.Transaction?.properties?.status).toBeDefined();
  });

  it('includes Idempotency-Key parameter on tip creation', () => {
    const spec = generateOpenApiSpec();
    const postTip = spec.paths['/transactions/tip']?.post;

    expect(postTip).toBeDefined();
    const idempotencyHeader = postTip?.parameters?.find(
      (p) => p.name === 'Idempotency-Key' && p.in === 'header'
    );
    expect(idempotencyHeader).toBeDefined();
  });

  it('generates documentation HTML viewer correctly', () => {
    const html = generateDocumentationHtml('./custom-openapi.json');
    expect(html).toContain('Dorisio API Reference');
    expect(html).toContain('<redoc spec-url="./custom-openapi.json"></redoc>');
    expect(html).toContain('redoc.standalone.js');
  });

  it('saves OpenAPI spec and HTML documentation to file system', () => {
    const targets = ['docs/openapi.json', 'openapi.json'];
    const written = saveOpenApiSpec(targets, tempDir);

    expect(written.length).toBeGreaterThanOrEqual(2);

    const jsonPath = path.join(tempDir, 'docs', 'openapi.json');
    expect(fs.existsSync(jsonPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(parsed.openapi).toBe('3.0.3');
    expect(parsed.info.title).toBe('Dorisio API');

    const htmlPath = path.join(tempDir, 'docs', 'api.html');
    expect(fs.existsSync(htmlPath)).toBe(true);
  });
});
