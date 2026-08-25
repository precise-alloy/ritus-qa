import { test, expect } from 'bun:test';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'fetch-ticket.ts');

type RunResult = { code: number; stdout: string; stderr: string };

async function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const proc = Bun.spawn(['bun', SCRIPT, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

const JIRA_ENV = {
  JIRA_BASE_URL: 'https://client.atlassian.net',
  JIRA_PAT: 'fake-jira-pat',
  JIRA_EMAIL: 'qa@example.com',
};
const ADO_ENV = {
  AZURE_DEVOPS_READONLY_PAT: 'fake-ado-pat',
  AZURE_DEVOPS_ORG: 'client-org',
  AZURE_DEVOPS_PROJECT: 'client-project',
};

test('no args prints usage to stderr, exit 2', async () => {
  const r = await run([], JIRA_ENV);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('Usage');
});

test('help flag prints usage, exit 0', async () => {
  const r = await run(['--help'], JIRA_ENV);
  expect(r.code).toBe(0);
  expect(r.stderr).toContain('Usage');
});

test('generate-env prints an env template containing both providers keys', async () => {
  const r = await run(['generate-env']);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain('JIRA_BASE_URL=');
  expect(r.stdout).toContain('JIRA_PAT=');
  expect(r.stdout).toContain('JIRA_EMAIL=');
  expect(r.stdout).toContain('AZURE_DEVOPS_READONLY_PAT=');
});

test('unrecognized target exits 2 with English message', async () => {
  const r = await run(['not-a-ticket'], { ...JIRA_ENV, ...ADO_ENV });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/Could not recognize ticket|Usage/i);
});

test('jira key with missing credentials exits 1 with English message', async () => {
  // Jira provider matches the key format but is not configured (empty env).
  const r = await run(['PROJ-123'], { JIRA_BASE_URL: '', JIRA_PAT: '', JIRA_EMAIL: '', AZURE_DEVOPS_READONLY_PAT: '' });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/credentials are missing|\.env\.local/i);
});

test('check-env with no .qa/.env.local exits 1 and prints both provider key lists', async () => {
  const r = await run(['check-env']);
  expect(r.code).toBe(1);
  expect(r.stderr + r.stdout).toContain('JIRA_BASE_URL');
  expect(r.stderr + r.stdout).toContain('AZURE_DEVOPS_READONLY_PAT');
});

