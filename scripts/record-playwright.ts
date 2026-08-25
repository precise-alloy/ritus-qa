#!/usr/bin/env bun

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type LogStep = { action: string; selector?: string; url?: string; value?: string };
type LogCase = { id: string; title: string; triage: string; steps: LogStep[]; result: string };
type ExecutionLog = { ticketId: string; baseUrl: string; cases: LogCase[] };

function isValidLog(log: unknown): log is ExecutionLog {
  if (!log || typeof log !== 'object') return false;
  const l = log as Partial<ExecutionLog>;
  if (typeof l.ticketId !== 'string' || l.ticketId.trim() === '') return false;
  if (typeof l.baseUrl !== 'string' || l.baseUrl.trim() === '') return false;
  if (!Array.isArray(l.cases)) return false;
  for (const c of l.cases) {
    if (!c || typeof c !== 'object') return false;
    if (typeof c.id !== 'string' || c.id.trim() === '') return false;
    if (typeof c.title !== 'string' || c.title.trim() === '') return false;
    if (typeof c.triage !== 'string' || c.triage.trim() === '') return false;
    if (!Array.isArray(c.steps)) return false;
  }
  return true;
}

function escapeTs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function emitStep(step: LogStep): string | null {
  switch (step.action) {
    case 'goto': return `  await page.goto('${escapeTs(step.url ?? '')}');`;
    case 'click': return `  await page.locator('${escapeTs(step.selector ?? '')}').click();`;
    case 'fill': return `  await page.locator('${escapeTs(step.selector ?? '')}').fill('${escapeTs(step.value ?? '')}');`;
    case 'expectVisible': return `  await expect(page.locator('${escapeTs(step.selector ?? '')}')).toBeVisible();`;
    case 'expectText': return `  await expect(page.locator('${escapeTs(step.selector ?? '')}')).toHaveText('${escapeTs(step.value ?? '')}');`;
    case 'expectUrl': return `  await expect(page).toHaveURL('${escapeTs(step.url ?? '')}');`;
    default: return null;
  }
}

function generateSpec(log: ExecutionLog): string {
  const lines: string[] = [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test.use({ baseURL: '${escapeTs(log.baseUrl)}' });`,
    ``,
  ];
  for (const c of log.cases) {
    if (c.triage === 'manual') {
      lines.push(`// ${c.id}: ${c.title} — manual case, not recorded`);
      continue;
    }
    const body = c.steps.map(emitStep).filter((l): l is string => l !== null);
    if (body.length === 0) {
      lines.push(`// ${c.id}: ${c.title} — no recordable steps`);
      continue;
    }
    lines.push(`test('${escapeTs(c.id)}: ${escapeTs(c.title)}', async ({ page }) => {`);
    lines.push(...body);
    lines.push(`});`);
    lines.push(``);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// E2E scaffold: detect existing setup, or copy templates/e2e into the project
// ---------------------------------------------------------------------------

/** Directory of this script, for locating the bundled templates. */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(SCRIPT_DIR, '..', 'templates', 'e2e');

/** True when the project already has a Playwright e2e setup we should follow. */
export function hasExistingE2e(projectDir: string): boolean {
  if (existsSync(join(projectDir, 'playwright.config.ts')) || existsSync(join(projectDir, 'playwright.config.js'))) {
    return true;
  }
  // Some projects nest the suite (e.g. tests/e2e/playwright.config.ts)
  for (const candidate of ['e2e', 'e2e_tests', 'tests', 'test']) {
    const nested = join(projectDir, candidate, 'playwright.config.ts');
    if (existsSync(nested)) return true;
  }
  return false;
}

/**
 * Copy the bundled e2e template into the project. Returns the list of files written.
 * Skips files that already exist (never overwrites the user's own config).
 */
export function scaffoldE2e(projectDir: string): string[] {
  const written: string[] = [];
  const walk = (src: string, rel: string): void => {
    for (const entry of readdirSync(src)) {
      const srcPath = join(src, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (statSync(srcPath).isDirectory()) {
        walk(srcPath, relPath);
        continue;
      }
      const destPath = join(projectDir, relPath);
      if (existsSync(destPath)) continue;
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
      written.push(relPath);
    }
  };
  walk(TEMPLATE_DIR, '');
  return written;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let inputPath: string | undefined;
  let outPath: string | undefined;
  let scaffold = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '--out') {
      outPath = args[++i];
    } else if (arg === '--scaffold') {
      scaffold = true;
    } else if (!arg.startsWith('-') && !inputPath) {
      inputPath = arg;
    }
  }

  if (!inputPath) {
    console.error('Usage: bun scripts/record-playwright.ts <execution-log.json> [--out <path>] [--scaffold]');
    console.error('  --scaffold  copy the bundled e2e template into the project when it has no Playwright setup');
    process.exit(2);
  }

  // Scaffold mode: the target project is the current working directory (where the QA runs the agent).
  if (scaffold) {
    const projectDir = process.cwd();
    if (hasExistingE2e(projectDir)) {
      console.log(JSON.stringify({ scaffolded: false, reason: 'existing e2e setup detected', files: [] }, null, 2));
    } else {
      const files = scaffoldE2e(projectDir);
      console.log(JSON.stringify({ scaffolded: true, reason: 'no e2e setup found', files }, null, 2));
    }
  }

  let raw: string;
  try {
    raw = readFileSync(inputPath, 'utf8');
  } catch {
    console.error(`Cannot read log file: ${inputPath}`);
    process.exit(1);
  }

  let log: ExecutionLog;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidLog(parsed)) throw new Error('bad shape');
    log = parsed;
  } catch {
    console.error(`Log file has an invalid format: ${inputPath}`);
    process.exit(2);
  }

  const spec = generateSpec(log);
  if (outPath) {
    const { writeFileSync } = await import('node:fs');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, spec, 'utf8');
  } else {
    console.log(spec);
  }
}

if (import.meta.main) {
  await main();
}
