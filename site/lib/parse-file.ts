/** Browser-safe: parses YAML strictly (no duplicate keys) and validates it, naming the file and field on failure. */
import { parseDocument } from 'yaml';
import type { z } from 'zod';

export function parseFile<S extends z.ZodTypeAny>(schema: S, text: string, filename: string): z.output<S> {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${filename}: ${document.errors[0].message}`);
  const result = schema.safeParse(document.toJS());
  if (!result.success) {
    throw new Error(result.error.issues.map(issue => `${filename}: ${issue.path.join('.') || '(file)'}: ${issue.message}`).join('\n'));
  }
  return result.data;
}
