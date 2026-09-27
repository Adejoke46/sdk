/**
 * Backend Template Aggregator
 */

import { generateClientFile, generateErrorHandlerFile } from './client';
import { generateExpressRoutes } from './express';
import { generateNextJsRoutes } from './nextjs';
import { generateFastifyRoutes } from './fastify';
import type { GenerateBackendOptions, GeneratedFile } from './types';

export * from './types';
export * from './client';
export * from './express';
export * from './nextjs';
export * from './fastify';

function generateBackendReadme(options: GenerateBackendOptions): string {
  return `# Dorisio Backend Integration (${options.framework})

Production-ready backend route handlers generated with \`dorisio generate-backend\`.

## Features
- **Validation**: Request body validation powered by Zod.
- **Client Setup**: Configured \`DorisioClient\` singleton with sandbox fallback.
- **Error Handling**: Standardized JSON responses for \`ApiError\`, \`ZodError\`, and network exceptions.
- **Webhooks**: Built-in HMAC-SHA256 signature verification.

## Environment Variables
Add these to your \`.env\` or server environment:
\`\`\`env
DORISIO_API_URL=https://api.dorisio.com
DORISIO_API_TOKEN=your-service-api-token
DORISIO_SANDBOX=false
DORISIO_WEBHOOK_SECRET=your-webhook-secret
\`\`\`

## Quick Usage
\`\`\`ts
// Import into your application server:
import { dorisio } from './dorisio';
\`\`\`
`;
}

/**
 * Generate files for the specified backend framework and language.
 */
export function buildBackendFiles(options: GenerateBackendOptions): GeneratedFile[] {
  const language = options.language || 'typescript';
  const isTs = language === 'typescript' || language === 'ts';
  const ext = isTs ? 'ts' : 'js';
  const includeWebhooks = options.includeWebhooks !== false;

  const files: GeneratedFile[] = [];

  // 1. Shared SDK Client Singleton
  files.push({
    path: `dorisio.${ext}`,
    content: generateClientFile(language),
  });

  // 2. Shared Error Handling Helper
  files.push({
    path: `errorHandler.${ext}`,
    content: generateErrorHandlerFile(language),
  });

  // 3. Framework-specific Route Handlers
  let routeFiles: Record<string, string> = {};
  if (options.framework === 'express') {
    routeFiles = generateExpressRoutes(language, includeWebhooks);
  } else if (options.framework === 'nextjs' || options.framework === 'next') {
    routeFiles = generateNextJsRoutes(language, includeWebhooks);
  } else if (options.framework === 'fastify') {
    routeFiles = generateFastifyRoutes(language, includeWebhooks);
  }

  for (const [relPath, content] of Object.entries(routeFiles)) {
    files.push({
      path: relPath,
      content,
    });
  }

  // 4. Integration README
  files.push({
    path: 'DORISIO_BACKEND_SETUP.md',
    content: generateBackendReadme(options),
  });

  return files;
}
