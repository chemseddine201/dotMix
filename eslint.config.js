import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      ".history/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "TypeScript enums and const enums are forbidden per Architecture Guardrails and erasableSyntaxOnly. Use as const objects with union types instead."
        }
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    // Compiler and AST packages must never import @mix/runtime
    files: [
      "packages/diagnostics/**/*.ts",
      "packages/ast/**/*.ts",
      "packages/compiler-frontend/**/*.ts",
      "packages/compiler-semantic/**/*.ts",
      "packages/compiler-css/**/*.ts",
      "packages/compiler-codegen/**/*.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mix/runtime", "@mix/runtime/*"],
              message: "Architecture Invariant Violation: Compiler packages are strictly forbidden from depending on or importing @mix/runtime."
            }
          ]
        }
      ]
    }
  },
  {
    // Core runtime must be platform-neutral with zero DOM globals
    files: ["packages/runtime/src/core/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "DOM globals forbidden in pure core reactivity." },
        { name: "document", message: "DOM globals forbidden in pure core reactivity." },
        { name: "Node", message: "DOM globals forbidden in pure core reactivity." },
        { name: "HTMLElement", message: "DOM globals forbidden in pure core reactivity." },
        { name: "AbortSignal", message: "DOM globals forbidden in pure core reactivity. Use pure CancellationToken." },
        { name: "AbortController", message: "DOM globals forbidden in pure core reactivity. Use pure CancellationToken." }
      ]
    }
  },
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
