#!/usr/bin/env node
/**
 * Dorisio CLI — scaffolding tool
 *
 * Usage:
 *   npx dorisio init
 *   npx dorisio init --framework react --auth jwt --database none --yes
 *   npx create-dorisio-app   (alias → dorisio init)
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  buildScaffoldFiles,
  type AuthMode,
  type Database,
  type Framework,
  type InitOptions,
} from './templates/index';
import { runGenerateBackend } from './generate-backend';

const FRAMEWORKS: Framework[] = ['react', 'next', 'vanilla'];
const AUTH_MODES: AuthMode[] = ['jwt', 'session', 'custom'];
const DATABASES: Database[] = ['none', 'postgres', 'sqlite'];

export interface ParsedArgs {
  command: 'init' | 'help' | 'generate-backend';
  framework?: Framework;
  auth?: AuthMode;
  database?: Database;
  yes: boolean;
  cwd: string;
}

function isFramework(v: string): v is Framework {
  return (FRAMEWORKS as string[]).includes(v);
}

function isAuth(v: string): v is AuthMode {
  return (AUTH_MODES as string[]).includes(v);
}

function isDatabase(v: string): v is Database {
  return (DATABASES as string[]).includes(v);
}

/**
 * Parse CLI argv into structured options.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const bin = path.basename(argv[1] || '');
  const yes = args.includes('--yes') || args.includes('-y');

  let command: 'init' | 'help' | 'generate-backend' = 'init';
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    command = 'help';
  } else if (args[0] === 'generate-backend') {
    command = 'generate-backend';
  } else if (args[0] === 'init' || bin === 'dorisio' || bin === 'create-dorisio-app' || args.length === 0) {
    command = 'init';
  } else if (args[0] && !args[0].startsWith('-')) {
    // unknown subcommand
    command = args[0] === 'init' ? 'init' : 'help';
  }

  const getFlag = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  };

  const frameworkRaw = getFlag('--framework');
  const authRaw = getFlag('--auth');
  const databaseRaw = getFlag('--database');
  const cwdRaw = getFlag('--cwd');

  return {
    command,
    framework: frameworkRaw && isFramework(frameworkRaw) ? frameworkRaw : undefined,
    auth: authRaw && isAuth(authRaw) ? authRaw : undefined,
    database: databaseRaw && isDatabase(databaseRaw) ? databaseRaw : undefined,
    yes,
    cwd: cwdRaw ? path.resolve(cwdRaw) : process.cwd(),
  };
}

function printHelp(): void {
  console.log(`
Dorisio CLI — scaffolding and code generation tool

Usage:
  npx dorisio init [options]
  npx dorisio generate-backend [options]

Commands:
  init              Scaffold Dorisio client into a frontend project
  generate-backend  Generate backend route handlers (Express, Next.js, Fastify)

Options (init):
  --framework <react|next|vanilla>   Target framework
  --auth <jwt|session|custom>        Authentication mode
  --database <none|postgres|sqlite>  Database hint for .env
  --cwd <path>                       Target directory (default: CWD)
  --yes, -y                          Skip interactive prompts (use defaults/flags)
  -h, --help                         Show help

Options (generate-backend):
  --framework <express|nextjs|fastify>  Target backend framework (default: express)
  --output <dir>                        Output directory (default: ./src/routes)
  --language <typescript|javascript>    Target language (default: typescript)
  --no-webhooks                         Omit webhook verification endpoint

Examples:
  npx dorisio init
  npx dorisio generate-backend --framework express --output ./src/routes
`);
}

function createRl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve((answer || '').trim()));
  });
}

async function promptChoice<T extends string>(
  rl: readline.Interface,
  label: string,
  choices: T[],
  fallback: T
): Promise<T> {
  const rendered = choices.join(' / ');
  const answer = await ask(rl, `? ${label}: (${rendered}) [${fallback}] `);
  if (!answer) return fallback;
  const match = choices.find((c) => c.toLowerCase() === answer.toLowerCase());
  if (!match) {
    console.log(`  Using default "${fallback}" (invalid choice: ${answer})`);
    return fallback;
  }
  return match;
}

/**
 * Resolve init options from flags and optional interactive prompts.
 */
export async function resolveInitOptions(parsed: ParsedArgs): Promise<InitOptions> {
  const defaults: InitOptions = {
    framework: parsed.framework || 'react',
    auth: parsed.auth || 'jwt',
    database: parsed.database || 'none',
    cwd: parsed.cwd,
  };

  if (parsed.yes || !process.stdin.isTTY) {
    return {
      framework: parsed.framework || defaults.framework,
      auth: parsed.auth || defaults.auth,
      database: parsed.database || defaults.database,
      cwd: parsed.cwd,
    };
  }

  const rl = createRl();
  try {
    const framework =
      parsed.framework ||
      (await promptChoice(rl, 'Framework', FRAMEWORKS, defaults.framework));
    const auth =
      parsed.auth || (await promptChoice(rl, 'Authentication', AUTH_MODES, defaults.auth));
    const database =
      parsed.database ||
      (await promptChoice(rl, 'Database', DATABASES, defaults.database));
    return { framework, auth, database, cwd: parsed.cwd };
  } finally {
    rl.close();
  }
}

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Write scaffold files into the target directory.
 */
export function writeScaffold(options: InitOptions): string[] {
  const files = buildScaffoldFiles(options);
  const written: string[] = [];
  for (const file of files) {
    const abs = path.join(options.cwd, file.path);
    writeFile(abs, file.content);
    written.push(file.path);
  }
  return written;
}

/**
 * Run `dorisio init`.
 */
export async function runInit(parsed: ParsedArgs): Promise<void> {
  console.log('\n🚀 Dorisio init\n');
  const options = await resolveInitOptions(parsed);
  console.log(
    `Framework: ${options.framework} | Auth: ${options.auth} | Database: ${options.database}`
  );
  console.log(`Target: ${options.cwd}\n`);

  const written = writeScaffold(options);
  for (const rel of written) {
    console.log(`✓ Created ${rel}`);
  }

  console.log('\n✨ Scaffold complete. Next steps:');
  console.log('   1. Review .env.local and set real secrets');
  console.log('   2. npm install dorisio-sdk');
  console.log('   3. Import createAppDorisioClient from src/config/dorisio');
  console.log('   See DORISIO_SETUP.md for details.\n');
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  if (parsed.command === 'generate-backend') {
    await runGenerateBackend(process.argv);
    return;
  }
  if (parsed.command === 'help') {
    printHelp();
    return;
  }
  await runInit(parsed);
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('create-app.js') ||
    process.argv[1].endsWith('create-app.ts') ||
    process.argv[1].includes(`${path.sep}cli${path.sep}create-app`));

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error('❌ dorisio init failed:', err);
    process.exit(1);
  });
}
