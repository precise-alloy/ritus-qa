import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('source startup validates before importing selected renderers and renders all before writing', async () => {
  const root = join(ROOT, 'tests', 'fixtures', `.source-cli-${randomUUID()}`);
  const script = join(root, 'scripts', 'export-artifact.ts');
  mkdirSync(root, { recursive: true });
  try {
    cpSync(join(ROOT, 'scripts'), join(root, 'scripts'), { recursive: true });
    const brokenPdf = join(root, 'scripts', 'lib', 'export', 'render-test-plan-pdf.ts');
    writeFileSync(brokenPdf, 'throw new Error("selected PDF renderer unavailable"); export function renderTestPlanPdf() {}');
    const source = join(root, '.qa', 'PROJ-123');
    mkdirSync(join(source, 'exports'), { recursive: true });
    const run = async (args: string[]) => {
      const child = Bun.spawn([process.execPath, '--no-install', script, ...args], {
        cwd: root, stdout: 'pipe', stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    const args = ['--ticket', 'PROJ-123', '--artifact', 'test-plan', '--format'];
    const invalid = await run([]);
    expect(invalid.code).toBe(2);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr).toContain(`bun --no-install "${script}"`);
    const missing = await run([...args, 'pdf']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Missing source file');
    writeFileSync(join(source, 'PROJ-123-plan.md'), 'malformed');
    const malformed = await run([...args, 'pdf']);
    expect(malformed.code).toBe(2);
    expect(malformed.stdout).toBe('');
    const markdown = readFileSync(join(ROOT, 'tests', 'fixtures', 'export', 'PROJ-123-plan.md'));
    writeFileSync(join(source, 'PROJ-123-plan.md'), markdown);
    const success = await run([...args, 'docx']);
    expect(success.code).toBe(0);
    expect(success.stderr).toBe('');
    expect(success.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(success.stdout).outputs).toHaveLength(1);
    for (const ext of ['docx', 'pdf']) {
      writeFileSync(join(source, 'exports', `PROJ-123-plan.${ext}`), `prior-${ext}`);
    }
    const combined = await run([...args, 'docx,pdf']);
    expect(combined.code).toBe(1);
    expect(combined.stdout).toBe('');
    expect(combined.stderr).toContain('selected PDF renderer unavailable');
    for (const ext of ['docx', 'pdf']) {
      expect(readFileSync(join(source, 'exports', `PROJ-123-plan.${ext}`), 'utf8')).toBe(`prior-${ext}`);
    }
    expect(readFileSync(join(source, 'PROJ-123-plan.md'))).toEqual(markdown);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
