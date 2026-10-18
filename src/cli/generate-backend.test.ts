import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  parseGenerateBackendArgs,
  writeBackendFiles,
  runGenerateBackend,
} from './generate-backend';
import { buildBackendFiles } from '../templates/backend/index';

describe('generate-backend CLI', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-backend-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('argument parsing', () => {
    it('parses framework, output, and flags correctly', () => {
      const parsed = parseGenerateBackendArgs([
        'node',
        'dorisio',
        'generate-backend',
        '--framework',
        'express',
        '--output',
        './custom/routes',
        '--language',
        'typescript',
      ]);

      expect(parsed.framework).toBe('express');
      expect(parsed.output).toBe('./custom/routes');
      expect(parsed.language).toBe('typescript');
      expect(parsed.includeWebhooks).toBe(true);
      expect(parsed.help).toBe(false);
    });

    it('handles nextjs alias and javascript flag', () => {
      const parsed = parseGenerateBackendArgs([
        'node',
        'dorisio',
        'generate-backend',
        '-f',
        'next',
        '--javascript',
        '--no-webhooks',
      ]);

      expect(parsed.framework).toBe('nextjs');
      expect(parsed.language).toBe('javascript');
      expect(parsed.includeWebhooks).toBe(false);
    });

    it('defaults to express and typescript when flags omitted', () => {
      const parsed = parseGenerateBackendArgs(['node', 'dorisio', 'generate-backend']);

      expect(parsed.framework).toBe('express');
      expect(parsed.language).toBe('typescript');
      expect(parsed.output).toBe('./src/routes');
      expect(parsed.includeWebhooks).toBe(true);
    });
  });

  describe('template file generation', () => {
    it('generates complete Express route handlers and client setup', () => {
      const files = buildBackendFiles({
        framework: 'express',
        output: './src/routes',
        language: 'typescript',
        includeWebhooks: true,
      });

      const paths = files.map((f) => f.path);
      expect(paths).toContain('dorisio.ts');
      expect(paths).toContain('errorHandler.ts');
      expect(paths).toContain('tips.ts');
      expect(paths).toContain('creators.ts');
      expect(paths).toContain('wallets.ts');
      expect(paths).toContain('webhooks.ts');
      expect(paths).toContain('index.ts');
      expect(paths).toContain('DORISIO_BACKEND_SETUP.md');

      const tipsFile = files.find((f) => f.path === 'tips.ts');
      expect(tipsFile).toBeDefined();
      expect(tipsFile?.content).toContain('dorisio.createTip');
      expect(tipsFile?.content).toContain('CreateTipBodySchema');
      expect(tipsFile?.content).toContain('formatDorisioError');

      const webhooksFile = files.find((f) => f.path === 'webhooks.ts');
      expect(webhooksFile).toBeDefined();
      expect(webhooksFile?.content).toContain('verifyWebhookSignature');
      expect(webhooksFile?.content).toContain('x-dorisio-signature');
    });

    it('generates Next.js route handlers in TypeScript', () => {
      const files = buildBackendFiles({
        framework: 'nextjs',
        output: './app/api/dorisio',
        language: 'typescript',
        includeWebhooks: true,
      });

      const paths = files.map((f) => f.path);
      expect(paths).toContain('tips/route.ts');
      expect(paths).toContain('tips/[id]/route.ts');
      expect(paths).toContain('creators/[id]/route.ts');
      expect(paths).toContain('wallets/route.ts');
      expect(paths).toContain('webhooks/route.ts');

      const tipRoute = files.find((f) => f.path === 'tips/route.ts');
      expect(tipRoute).toBeDefined();
      expect(tipRoute?.content).toContain('NextRequest');
      expect(tipRoute?.content).toContain('NextResponse.json');
      expect(tipRoute?.content).toContain('dorisio.createTip');
    });

    it('generates Fastify routes in JavaScript', () => {
      const files = buildBackendFiles({
        framework: 'fastify',
        output: './routes',
        language: 'javascript',
        includeWebhooks: true,
      });

      const paths = files.map((f) => f.path);
      expect(paths).toContain('dorisio.js');
      expect(paths).toContain('errorHandler.js');
      expect(paths).toContain('routes.js');

      const routesFile = files.find((f) => f.path === 'routes.js');
      expect(routesFile).toBeDefined();
      expect(routesFile?.content).toContain('dorisioRoutes');
      expect(routesFile?.content).not.toContain(': FastifyInstance');
      expect(routesFile?.content).toContain('dorisio.createTip');
    });

    it('omits webhooks file when includeWebhooks is false', () => {
      const files = buildBackendFiles({
        framework: 'express',
        output: './src/routes',
        includeWebhooks: false,
      });

      const paths = files.map((f) => f.path);
      expect(paths).not.toContain('webhooks.ts');
    });
  });

  describe('file writing', () => {
    it('writes all generated backend files to disk', () => {
      const outputDir = path.join(tempDir, 'express-routes');
      const written = writeBackendFiles({
        framework: 'express',
        output: outputDir,
        language: 'typescript',
        includeWebhooks: true,
      });

      expect(written.length).toBeGreaterThanOrEqual(7);

      expect(fs.existsSync(path.join(outputDir, 'dorisio.ts'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'tips.ts'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'errorHandler.ts'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'index.ts'))).toBe(true);
    });

    it('executes runGenerateBackend successfully', async () => {
      const outputDir = path.join(tempDir, 'cli-test-routes');
      const written = await runGenerateBackend([
        'node',
        'dorisio',
        'generate-backend',
        '--framework',
        'express',
        '--output',
        outputDir,
        '--cwd',
        tempDir,
      ]);

      expect(written.length).toBeGreaterThanOrEqual(6);
      expect(fs.existsSync(path.join(outputDir, 'tips.ts'))).toBe(true);
    });
  });
});
