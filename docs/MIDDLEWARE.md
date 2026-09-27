# Middleware

The Dorisio SDK supports middleware for request/response transformation, allowing you to modify requests before they're sent and responses after they're received.

## Basic Usage

Register middleware using the `use` method:

```typescript
import { DorisioClient } from 'dorisio-sdk';

const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  token: 'your-token',
});

client.use((ctx, next) => {
  // Transform request before sending
  ctx.body = { ...ctx.body, timestamp: new Date().toISOString() };

  // Call next middleware
  const response = next();

  // Transform response
  return response;
});
```

## Middleware Context

The middleware receives context information about the request:

```typescript
interface MiddlewareContext {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  requestId?: string;
}
```

## Request Transformation

Modify the request before it's sent:

```typescript
client.use((ctx, next) => {
  // Add timestamp to all requests
  ctx.body = { ...ctx.body, timestamp: new Date().toISOString() };

  // Add custom header
  ctx.headers = {
    ...ctx.headers,
    'X-Custom-Header': 'value',
  };

  return next();
});
```

## Response Transformation

Modify the response after it's received:

```typescript
client.use(async (ctx, next) => {
  const response = await next();

  // Transform response data
  if (response.data) {
    response.data.createdAt = new Date(response.data.createdAt);
  }

  return response;
});
```

## Middleware Chain

Middleware is executed in the order they are registered:

```typescript
client.use((ctx, next) => {
  console.log('Middleware 1 before');
  const result = next();
  console.log('Middleware 1 after');
  return result;
});

client.use((ctx, next) => {
  console.log('Middleware 2 before');
  const result = next();
  console.log('Middleware 2 after');
  return result;
});

// Output:
// Middleware 1 before
// Middleware 2 before
// Middleware 2 after
// Middleware 1 after
```

## Async Middleware

Middleware supports async operations:

```typescript
client.use(async (ctx, next) => {
  // Perform async operations
  const token = await getAuthToken();
  ctx.headers = { ...ctx.headers, Authorization: `Bearer ${token}` };

  return next();
});
```

## Short-Circuiting

You can short-circuit the middleware chain by returning a value without calling `next()`:

```typescript
client.use(async (ctx, next) => {
  // Check cache first
  const cached = await cache.get(ctx.path);
  if (cached) {
    return cached; // Skip the actual request
  }

  return next();
});
```

## Common Patterns

### Logging

```typescript
client.use(async (ctx, next) => {
  console.log(`Request: ${ctx.method} ${ctx.path}`, ctx.body);
  const response = await next();
  console.log(`Response:`, response);
  return response;
});
```

### Authentication

```typescript
client.use(async (ctx, next) => {
  const token = await getAuthToken();
  ctx.headers = {
    ...ctx.headers,
    Authorization: `Bearer ${token}`,
  };
  return next();
});
```

### Data Normalization

```typescript
client.use(async (ctx, next) => {
  const response = await next();

  // Normalize dates
  if (response.data) {
    response.data = normalizeDates(response.data);
  }

  return response;
});
```

### Field Mapping

```typescript
client.use(async (ctx, next) => {
  const response = await next();

  // Map API fields to app fields
  if (response.data) {
    response.data = {
      ...response.data,
      userId: response.data.user_id,
      createdAt: response.data.created_at,
    };
  }

  return response;
});
```

### Error Handling

```typescript
client.use(async (ctx, next) => {
  try {
    return await next();
  } catch (error) {
    // Transform errors
    console.error('Request failed:', error);
    throw new CustomError('Request failed', error);
  }
});
```

## Error Handling in Middleware

If middleware throws an error, the middleware chain is interrupted and the error is propagated:

```typescript
client.use(async (ctx, next) => {
  throw new Error('Middleware error');
  // This will never be reached
  return next();
});
```
