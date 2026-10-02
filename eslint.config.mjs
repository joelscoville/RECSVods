import js from '@eslint/js';
import ts from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', '.*/**', 'site/public/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...astro.configs.recommended,
  { files: ['**/*.astro'], languageOptions: { parserOptions: { parser: ts.parser } } },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }] } },
  { languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', document: 'readonly', window: 'readonly' } } },
);
