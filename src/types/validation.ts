import { ValidationError } from './errors';

/** Structural interfaces keep Joi optional while accepting Zod schemas. */
export type ValidationSchema<T = unknown> =
  | { parse(value: unknown): T }
  | {
      validate(
        value: unknown,
        options?: { abortEarly?: boolean }
      ): {
        value: T;
        error?: {
          message: string;
          details?: readonly { path?: readonly (string | number)[]; message: string }[];
        };
      };
    };

export interface ValidationSchemas {
  request?: ValidationSchema;
  response?: ValidationSchema;
}

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

export class SchemaValidationError extends ValidationError {
  readonly phase: 'request' | 'response';
  readonly issues: readonly SchemaValidationIssue[];

  constructor(
    phase: 'request' | 'response',
    issues: readonly SchemaValidationIssue[],
    requestId?: string
  ) {
    super(
      `${phase} validation failed: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
      { phase, issues },
      requestId
    );
    this.name = 'SchemaValidationError';
    this.phase = phase;
    this.issues = issues;
  }
}
