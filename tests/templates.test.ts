import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const T = (name: string) => readFileSync(join(process.cwd(), 'templates', name), 'utf8');

test('all five templates exist and are non-empty', () => {
  for (const f of ['test-plan.md', 'test-cases.md', 'execution-results.md', 'bug-report.md', 'test-summary.md']) {
    expect(T(f).length).toBeGreaterThan(100);
  }
});

test('test-cases template has the triage table with exact headers', () => {
  expect(T('test-cases.md')).toContain('| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |');
  expect(T('test-cases.md')).toContain('Source plan: `{{TICKET_ID}}-plan.md`');
  expect(T('test-cases.md')).toContain('{{PRIORITY — High | Medium | Low}}');
});

test('execution-results template separates automated results from manual hand-off', () => {
  const t = T('execution-results.md');
  expect(t).toContain('## Automated Results');
  expect(t).toContain('## Manual Hand-off');
});

test('test-summary template reports automated vs manual coverage separately', () => {
  const t = T('test-summary.md');
  expect(t).toContain('Automated Coverage');
  expect(t).toContain('Manual Coverage');
});

test('test-summary template states which round it covers', () => {
  // A summary whose numbers cannot be tied to a round reads as a claim about
  // the whole ticket when it only covers the latest pass.
  expect(T('test-summary.md')).toContain('**Round:**');
});

test('bug-report template has required sections', () => {
  const t = T('bug-report.md');
  for (const section of ['Environment', 'Severity', 'Steps to Reproduce', 'Expected Result', 'Actual Result', 'Evidence']) {
    expect(t).toContain(section);
  }
});

test('test-plan template carries a change log for later rounds', () => {
  const t = T('test-plan.md');
  expect(t).toContain('## Change Log');
  // Round 1 has nothing to compare against, and an unexplained empty section
  // invites the agent to invent history.
  expect(t).toMatch(/round 1/i);
});

test('execution-results template attributes every row to a round', () => {
  const t = T('execution-results.md');
  // Both tables need it: a manual verdict that cannot be tied to a round is as
  // unusable as an automated one.
  expect(t).toContain('| Round | ID | Title | Result | Evidence |');
  expect(t).toContain('| Round | ID | Title | Reason for Hand-off | Prepared Evidence | Manual Verdict |');
});

test('bug-report template records the case and round a defect came from', () => {
  const t = T('bug-report.md');
  expect(t).toContain('**Case:**');
  expect(t).toContain('**Found in round:**');
});
