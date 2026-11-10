/**
 * @mix/runtime/forms/validators — Built-in synchronous form field validators (D-124).
 */

import type { ValidatorFn } from "./types.js";

export const validators = {
  required(message = "This field is required"): ValidatorFn<unknown> {
    return (val) => {
      if (
        val === null ||
        val === undefined ||
        val === "" ||
        (Array.isArray(val) && val.length === 0)
      ) {
        return message;
      }
      return null;
    };
  },

  minLength(min: number, message?: string): ValidatorFn<unknown> {
    return (val) => {
      if (val && typeof (val as { length?: number }).length === "number") {
        if ((val as { length: number }).length < min) {
          return message || `Must be at least ${min} characters`;
        }
      }
      return null;
    };
  },

  maxLength(max: number, message?: string): ValidatorFn<unknown> {
    return (val) => {
      if (val && typeof (val as { length?: number }).length === "number") {
        if ((val as { length: number }).length > max) {
          return message || `Must be at most ${max} characters`;
        }
      }
      return null;
    };
  },

  pattern(regex: RegExp, message = "Invalid format"): ValidatorFn<unknown> {
    return (val) => {
      if (val !== null && val !== undefined && val !== "" && !regex.test(String(val))) {
        return message;
      }
      return null;
    };
  },

  email(message = "Invalid email address"): ValidatorFn<unknown> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return (val) => {
      if (
        val !== null &&
        val !== undefined &&
        val !== "" &&
        !emailRegex.test(String(val))
      ) {
        return message;
      }
      return null;
    };
  },

  min(minVal: number, message?: string): ValidatorFn<unknown> {
    return (val) => {
      if (typeof val === "number" && !Number.isNaN(val) && val < minVal) {
        return message || `Must be at least ${minVal}`;
      }
      return null;
    };
  },

  max(maxVal: number, message?: string): ValidatorFn<unknown> {
    return (val) => {
      if (typeof val === "number" && !Number.isNaN(val) && val > maxVal) {
        return message || `Must be at most ${maxVal}`;
      }
      return null;
    };
  },

  custom<T = unknown>(
    predicate: (value: T) => boolean,
    message = "Invalid value"
  ): ValidatorFn<T> {
    return (val) => (predicate(val) ? null : message);
  }
};
