export type BackendFramework = 'express' | 'nextjs' | 'next' | 'fastify';
export type Language = 'typescript' | 'javascript' | 'ts' | 'js';

export interface GenerateBackendOptions {
  framework: BackendFramework;
  output: string;
  language?: Language;
  includeWebhooks?: boolean;
  cwd?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}
