import {
  SchemaValidationError,
  type SchemaValidationIssue,
  type ValidationSchema,
} from '../types/validation';

function formatIssues(error: unknown): SchemaValidationIssue[] {
  const source = (error && typeof error === 'object' ? error : { message: String(error) }) as {
    issues?: readonly { path?: readonly (string | number)[]; message?: string }[];
    details?: readonly { path?: readonly (string | number)[]; message?: string }[];
    message?: string;
  };
  const details = source.issues ?? source.details;
  if (details?.length) {
    return details.map((issue) => ({
      path: issue.path?.length ? issue.path.join('.') : '$',
      message: issue.message ?? 'Invalid value',
    }));
  }
  return [{ path: '$', message: source.message ?? 'Invalid value' }];
}

/** Validate and return the schema's parsed/converted value without mutating input. */
export function validateSchema<T>(
  schema: ValidationSchema<T>,
  value: unknown,
  phase: 'request' | 'response',
  requestId?: string
): T {
  try {
    if ('parse' in schema && typeof schema.parse === 'function') {
      return schema.parse(value);
    }
    if ('validate' in schema && typeof schema.validate === 'function') {
      const result = schema.validate(value, { abortEarly: false });
      if (result.error) throw result.error;
      return result.value;
    }
    throw new TypeError('Schema must provide parse() or validate()');
  } catch (error) {
    throw new SchemaValidationError(phase, formatIssues(error), requestId);
  }
}
