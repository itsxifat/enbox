import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/server/drizzle/**',
      'apps/server/data/**',
      'apps/web/public/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: [
      'apps/server/**/*.ts',
      'packages/**/*.ts',
      '*.config.{js,ts}',
      'e2e/**/*.ts',
      'scripts/**/*.{js,ts,mjs}',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lucide-react',
              // lucide exports every icon as X, XIcon and LucideX
              importNames: [
                'Video',
                'VideoOff',
                'Phone',
                'PhoneCall',
                'PhoneIncoming',
                'PhoneOutgoing',
                'PhoneMissed',
                'PhoneOff',
              ].flatMap((n) => [n, `${n}Icon`, `Lucide${n}`]),
              message:
                "Use the call icons from '@/components/icons' (VideoIcon, PhoneIcon, …): they're drawn as one optically matched set.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
);
