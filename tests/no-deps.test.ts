import { test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Third-party packages the export scripts may import. */
const ALLOWED_EXPORT_IMPORTS = new Set([
  '@fontsource/noto-sans',
  '@fontsource/noto-sans-math',
  '@fontsource/noto-sans-symbols-2',
  'docx',
  'entities',
  'exceljs',
  'fontkit',
  'marked',
  'pdfkit',
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith('.ts')) yield full;
  }
}

/** `@scope/pkg/sub/path.js` -> `@scope/pkg`; `pkg/sub` -> `pkg`. */
function packageRoot(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function unapprovedImports(dir: string, allowed: Set<string>): string[] {
  const violations: string[] = [];
  for (const file of walk(dir)) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(/^\s*import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) {
      const specifier = match[1]!;
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('node:') ||
        specifier === 'bun' ||
        specifier.startsWith('bun:')
      ) {
        continue;
      }
      if (!allowed.has(packageRoot(specifier))) {
        violations.push(`${file}: imports "${specifier}"`);
      }
    }
  }
  return violations;
}

test('only approved third-party packages are imported', () => {
  expect(unapprovedImports('scripts', ALLOWED_EXPORT_IMPORTS)).toEqual([]);
});

test('package.json declares exactly the dependencies the scripts import', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies?: Record<string, unknown>;
  };

  expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([...ALLOWED_EXPORT_IMPORTS].sort());
});
