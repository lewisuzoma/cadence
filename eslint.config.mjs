import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

/**
 * One flat config for the whole monorepo.
 *
 * Deliberately strict in two places:
 *  - `no-explicit-any` is an error, so an escape hatch has to be argued for in
 *    a comment and a disable line rather than slipped in
 *  - `no-floating-promises` is an error, because a dropped promise in an
 *    Express handler or an effect is how errors get silently swallowed
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'client/src/components/ui/**', // generated primitives, kept as authored
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
      'scripts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // An async function passed to an event handler is idiomatic React.
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      /**
       * `unbound-method` guards against detaching a class method from the
       * instance whose `this` it needs. This codebase has no such class:
       * controllers, repositories, services and the api client are all plain
       * object literals, by design, and passing `authController.login` to a
       * router is the intended usage. The rule reports only false positives
       * here, so it is off rather than suppressed 40 times at the call sites.
       */
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'log'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-param-reassign': 'error',
    },
  },

  // --- server -------------------------------------------------------------
  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // --- client -------------------------------------------------------------
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // --- tests --------------------------------------------------------------
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts', '**/test/**/*.{ts,tsx}'],
    rules: {
      // Tests reach into partial fixtures and assert on loose shapes; the
      // production rules would make them noisier, not safer.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // An `async` test or MSW handler with no `await` is normal: the async
      // signature is what the framework expects.
      '@typescript-eslint/require-await': 'off',
      // Asserting on a stringified error is a legitimate thing for a test.
      '@typescript-eslint/no-base-to-string': 'off',
      // Vitest hooks accept a promise-returning callback.
      '@typescript-eslint/no-misused-promises': 'off',
      // Test helpers legitimately export render functions beside a probe
      // component; fast refresh does not apply to test files.
      'react-refresh/only-export-components': 'off',
    },
  },

  // Prettier last, so formatting rules never fight the formatter.
  prettier,
);
