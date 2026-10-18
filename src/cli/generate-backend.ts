#!/usr/bin/env node
/**
 * Dorisio CLI — backend code generation tool
 *
 * Usage:
 *   npx dorisio generate-backend --framework express --output ./src/routes
 *   npx dorisio generate-backend --framework nextjs --output ./app/api/dorisio
 *   npx dorisio generate-backend --framework fastify --output ./src/routes --language javascript
 */

import fs from 'fs';
import path from 'path';
import {
  buildBackendFiles,
  type BackendFramework,
  type Language,
  type GenerateBackendOptions,
} from '../templates/backend/index';

export const SUPPORTED_FRAMEWORKS: BackendFramework[] = ['express', 'nextjs', 'next', 'fastify'];

export interface ParsedGenerateBackendArgs {
  framework: BackendFramework;
  output: string;
  language: Language;
  includeWebhooks: boolean;
  help: boolean;
  cwd: string;
}

export function parseGenerateBackendArgs(argv: string[]): ParsedGenerateBackendArgs {
  const args = argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');

  const getFlag = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  };

  const frameworkRaw = (getFlag('--framework') || getFlag('-f') || 'express').toLowerCase();
  let framework: BackendFramework = 'express';
  if (frameworkRaw === 'next' || frameworkRaw === 'nextjs') {
    framework = 'nextjs';
  } else if (frameworkRaw === 'fastify') {
    framework = 'fastify';
  } else if (frameworkRaw === 'express') {
    framework = 'express';
  }

  const outputRaw = getFlag('--output') || getFlag('-o') || './src/routes';
  const langRaw = (getFlag('--language') || getFlag('--lang') || '').toLowerCase();
  const isJs = args.includes('--javascript') || args.includes('--js') || langRaw === 'js' || langRaw === 'javascript';
  const language: Language = isJs ? 'javascript' : 'typescript';

  const includeWebhooks = !args.includes('--no-webhooks');
  const cwdRaw = getFlag('--cwd');

  return {
    framework,
    output: outputRaw,
    language,
    includeWebhooks,
    help,
    cwd: cwdRaw ? path.resolve(cwdRaw) : process.cwd(),
  };
}

export function printGenerateBackendHelp(): void {
  console.log(`
Dorisio CLI — generate backend integration route handlers

Usage:
  npx dorisio generate-backend [options]

Options:
  --framework, -f <express|nextjs|fastify>  Target backend framework (default: express)
  --output, -o <dir>                         Destination output directory (default: ./src/routes)
  --language, --lang <typescript|javascript> Language format (default: typescript)
  --javascript, --js                         Generate JavaScript instead of TypeScript
  --no-webhooks                              Omit webhook verification endpoint
  --cwd <path>                               Working directory base (default: current directory)
  -h, --help                                 Display help information

Examples:
  npx dorisio generate-backend --framework express --output ./src/routes
  npx dorisio generate-backend --framework nextjs --output ./app/api/dorisio
  npx dorisio generate-backend --framework fastify --output ./src/routes --javascript
`);
}

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Write generated backend files to disk.
 */
export function writeBackendFiles(options: GenerateBackendOptions): string[] {
  const files = buildBackendFiles(options);
  const targetDir = path.isAbsolute(options.output)
    ? options.output
    : path.join(options.cwd || process.cwd(), options.output);

  const written: string[] = [];
  for (const file of files) {
    const fullPath = path.join(targetDir, file.path);
    writeFile(fullPath, file.content);
    written.push(fullPath);
  }
  return written;
}

/**
 * Run backend code generation.
 */
export async function runGenerateBackend(argv: string[]): Promise<string[]> {
  const parsed = parseGenerateBackendArgs(argv);

  if (parsed.help) {
    printGenerateBackendHelp();
    return [];
  }

  console.log('\n⚙️  Generating Dorisio Backend Routes...\n');
  console.log(`Framework: ${parsed.framework}`);
  console.log(`Language:  ${parsed.language}`);
  console.log(`Output:    ${parsed.output}`);
  console.log(`Webhooks:  ${parsed.includeWebhooks ? 'Enabled' : 'Disabled'}\n`);

  const written = writeBackendFiles({
    framework: parsed.framework,
    output: parsed.output,
    language: parsed.language,
    includeWebhooks: parsed.includeWebhooks,
    cwd: parsed.cwd,
  });

  for (const file of written) {
    console.log(`✓ Created ${path.relative(parsed.cwd, file)}`);
  }

  console.log('\n✨ Backend integration handlers generated successfully!\n');
  return written;
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('generate-backend.js') ||
    process.argv[1].endsWith('generate-backend.ts') ||
    process.argv[1].includes('generate-backend'));

if (isDirectRun) {
  runGenerateBackend(process.argv).catch((err: unknown) => {
    console.error('❌ Backend generation failed:', err);
    process.exit(1);
  });
}
