// @ts-check
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: [
      "**/.history/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/__tmp__/**",
      "examples/**",
      "benchmarks/**",
      "reports/**",
      "packages/**/*.ts"
    ]
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        performance: "readonly",
        globalThis: "readonly",
        URL: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["tests/**/*.js", "tests/**/*.mjs"],
    languageOptions: {
      globals: {
        setTimeout: "readonly",
        clearTimeout: "readonly"
      }
    }
  },
  {
    // Pure Core Boundary: Zero Web APIs or Node APIs in core reactivity & core runtime
    files: ["packages/runtime/src/core/**/*.js", "packages/runtime/src/core/**/*.mjs"],
    rules: {
      "no-restricted-globals": [
        "error",
        { "name": "window", "message": "Forbidden in core: Core must remain pure ECMAScript." },
        { "name": "document", "message": "Forbidden in core: DOM types belong in @mix/runtime/dom." },
        { "name": "navigator", "message": "Forbidden in core: Core must remain platform-neutral." },
        { "name": "AbortController", "message": "Forbidden in core: Use pure CancellationTokenSource from core/cancellation.ts." },
        { "name": "AbortSignal", "message": "Forbidden in core: Use @mix/runtime/platform." },
        { "name": "URL", "message": "Forbidden in core: URL handling belongs in @mix/runtime/security." },
        { "name": "setTimeout", "message": "Forbidden in core: Schedulers are pluggable via RuntimeConfig." },
        { "name": "queueMicrotask", "message": "Forbidden in core." },
        { "name": "process", "message": "Forbidden in core: R-BLD-02 forbids reading process.env." }
      ]
    }
  }
];
