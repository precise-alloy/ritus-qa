import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'record-playwright.ts');
const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'execution-log.sample.json');
const EXPECTED_SPEC = join(process.cwd(), 'tests', 'fixtures', 'expected-spec.sample.ts');

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', SCRIPT, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

test('generates playwright spec from execution log', async () => {
  const r = await run([FIXTURE]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("import { test, expect } from '@playwright/test';");
  expect(r.stdout).toContain("test.use({ baseURL: 'https://staging.client-site.com' });");
  expect(r.stdout).toContain("test('TC-001: CTA navigates to campaign page'");
  expect(r.stdout).toContain("await page.goto('/');");
  expect(r.stdout).toContain("await page.locator('role=button[name=\\'Explore now\\']').click();");
  expect(r.stdout).toContain("await expect(page).toHaveURL('/campaign');");

  const expected = readFileSync(EXPECTED_SPEC, 'utf8').trim().replace(/\r\n/g, '\n');
  expect(r.stdout.trim().replace(/\r\n/g, '\n')).toBe(expected);
});

test('skips manual cases with a comment', async () => {
  const r = await run([FIXTURE]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain('// TC-002:');
  expect(r.stdout).not.toContain("test('TC-002");
  expect(r.stdout).not.toContain('#physical-gift-card');
});

test('handles --out flag before input file', async () => {
  const tmpOut = join(process.cwd(), 'tests', 'fixtures', 'tmp-out.spec.ts');
  try {
    const r = await run(['--out', tmpOut, FIXTURE]);
    expect(r.code).toBe(0);
    expect(existsSync(tmpOut)).toBe(true);
    const content = readFileSync(tmpOut, 'utf8').trim().replace(/\r\n/g, '\n');
    const expected = readFileSync(EXPECTED_SPEC, 'utf8').trim().replace(/\r\n/g, '\n');
    expect(content).toBe(expected);
  } finally {
    if (existsSync(tmpOut)) unlinkSync(tmpOut);
  }
});

test('malformed log missing baseUrl exits 2 with an error message', async () => {
  const tmpBadLog = join(process.cwd(), 'tests', 'fixtures', 'tmp-bad.json');
  try {
    writeFileSync(tmpBadLog, JSON.stringify({ ticketId: 'PROJ-123', cases: [] }), 'utf8');
    const r = await run([tmpBadLog]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/invalid format|không|khong|lỗi|loi|định dạng|dinh dang/i);
  } finally {
    if (existsSync(tmpBadLog)) unlinkSync(tmpBadLog);
  }
});

test('missing file exits 1 with an error message', async () => {
  const r = await run(['does-not-exist.json']);
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/cannot read|không|khong|lỗi|loi/i);
});

test('no args exits 2 with usage', async () => {
  const r = await run([]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('Usage');
});

test('--scaffold into an empty project copies the template and reports the files', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'e2e-scaffold-'));
  const proc = Bun.spawn(['bun', SCRIPT, FIXTURE, '--scaffold'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  expect(code).toBe(0);
  const report = JSON.parse(stdout.split('\n}\n')[0] + '\n}'); // scaffold JSON is printed before the spec
  expect(report.scaffolded).toBe(true);
  expect(report.files).toContain('playwright.config.ts');
  expect(report.files).toContain('commons/BasePage.ts');
  expect(report.files).toContain('page_interfaces/commons/CommonPageUI.ts');
  expect(report.files).toContain('page_objects/commons/CommonPage.ts');
  expect(report.files).toContain('e2e_tests/cms/auth.setup.ts');
});

test('--scaffold into a project that already has playwright.config.ts is a no-op', async () => {
  const { mkdtempSync, writeFileSync: wf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'e2e-existing-'));
  wf(join(dir, 'playwright.config.ts'), '// existing\n');
  const proc = Bun.spawn(['bun', SCRIPT, FIXTURE, '--scaffold'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  expect(code).toBe(0);
  const report = JSON.parse(stdout.split('\n}\n')[0] + '\n}');
  expect(report.scaffolded).toBe(false);
  expect(report.reason).toContain('existing');
  // The user's own config must be untouched.
  expect(readFileSync(join(dir, 'playwright.config.ts'), 'utf8')).toBe('// existing\n');
});
