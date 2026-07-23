import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/pocketbase/migrations/**",
      "**/pocketbase/pb_data*/**",
      "**/apps/web/public/*.js",
      "**/apps/web/src/app/tailwind.generated.css",
      "**/packages/api-types/src/openapi.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.builtin,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "unused-imports": unusedImports,
    },
    settings: {
      react: { version: "19.2" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-unsafe-declaration-merging": "warn",
      "@typescript-eslint/no-wrapper-object-types": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-empty-pattern": "warn",
      "no-extra-boolean-cast": "warn",
      "no-var": "warn",
      "no-useless-escape": "warn",
      "no-unsafe-finally": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/prefer-as-const": "warn",
      "@typescript-eslint/triple-slash-reference": "warn",
      "unused-imports/no-unused-imports": "warn",
      "react/no-unescaped-entities": "warn",
      "react/jsx-no-target-blank": "warn",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    files: ["apps/web/src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/modules/*/internal/*", "../*/internal/*", "../../*/internal/*"], message: "Import another module through its public API." },
        ],
      }],
    },
  },
  {
    files: ["apps/backend/src/modules/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["../*/internal/*", "../../*/internal/*", "../../../*/internal/*"], message: "Import another module through its public API." },
        ],
      }],
    },
  },
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.builtin,
      },
    },
  },
);
