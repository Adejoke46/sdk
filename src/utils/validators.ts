/**
 * Request Validators
 *
 * Utilities for validating requests and responses.
 */

import { ValidationError } from '../types/errors';

export class RequestValidator {
  /**
   * Validate required field
   */
  static required(value: unknown, fieldName: string): void {
    if (value === undefined || value === null || value === '') {
      throw new ValidationError(`${fieldName} is required`);
    }
  }

  static nonEmptyString(value: unknown, fieldName: string): asserts value is string {
    this.required(value, fieldName);
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError(`${fieldName} must be a non-empty string`);
    }
  }

  static uuid(value: unknown, fieldName: string): asserts value is string {
    this.nonEmptyString(value, fieldName);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new ValidationError(`${fieldName} must be a valid UUID`);
    }
  }

  /**
   * Validate email format
   */
  static email(value: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      throw new ValidationError('Invalid email format');
    }
  }

  /**
   * Validate string length
   */
  static stringLength(value: string, min: number, max: number, fieldName: string): void {
    if (value.length < min || value.length > max) {
      throw new ValidationError(`${fieldName} must be between ${min} and ${max} characters`);
    }
  }

  /**
   * Validate positive number
   */
  static positiveNumber(value: number, fieldName: string): void {
    if (value <= 0) {
      throw new ValidationError(`${fieldName} must be greater than 0`);
    }
  }

  /**
   * Validate URL format
   */
  static url(value: string, fieldName: string = 'URL'): void {
    try {
      new URL(value);
    } catch {
      throw new ValidationError(`${fieldName} is not a valid URL`);
    }
  }
}
