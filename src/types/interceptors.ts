import type { RequestOptions } from '../http/http-client';

export type InterceptorId = number;

export type RequestInterceptor = (
  options: RequestOptions
) => RequestOptions | Promise<RequestOptions>;
export type ResponseInterceptor = <T>(response: T) => T | Promise<T>;
export type ErrorInterceptor = (error: unknown) => unknown | Promise<unknown>;