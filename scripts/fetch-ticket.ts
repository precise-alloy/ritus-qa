#!/usr/bin/env bun

import { loadLocalEnv, requireEnv, safeDecode } from './lib/http.ts';
import type { EnvCheckResult, EnvKeyStatus, EnvMapping, Provider, ProviderEnvStatus } from './lib/types.ts';
import { jiraProvider } from './lib/provider-jira.ts';
import { adoProvider } from './lib/provider-ado.ts';

const PROVIDERS: Provider[] = [jiraProvider, adoProvider];

const HELP_FLAGS = new Set(['-h', '--help', 'help']);

// ---------------------------------------------------------------------------
// Target matching (single default instance per provider; no team.yml)
// ---------------------------------------------------------------------------

function canProviderHandleTarget(provider: Provider, action: string, target: string): boolean {
  if (!Object.hasOwn(provider.actions, action)) return false;
  return provider.canHandleTarget(action, target);
}

// ---------------------------------------------------------------------------
// Credential checking
// ---------------------------------------------------------------------------

function checkProviderEnv(provider: Provider): ProviderEnvStatus {
  const keys: EnvKeyStatus[] = provider.requiredEnvKeys.map((name) => ({
    name,
    present: !!process.env[name]?.trim(),
  }));

  return {
    name: provider.name,
    label: provider.label,
    keys,
    ok: keys.every((k) => k.present),
  };
}

function getScriptCmd(): string {
  const scriptPath = Bun.argv[1] === 'run' ? Bun.argv[2] : Bun.argv[1];
  return `bun run ${scriptPath}`;
}

function getCliArgs(argv: string[]): string[] {
  if (argv[1] === 'run') {
    return argv.slice(3);
  }

  return argv.slice(2);
}

function printUsage(): void {
  const cmd = getScriptCmd();
  console.error(`Usage:
  ${cmd} <ticket>     Fetch a ticket (Jira key/URL or ADO work item id/URL)
  ${cmd} check-env     Verify .qa/.env.local configuration
  ${cmd} generate-env  Print an env template

  Target formats:
    Jira:       PROJ-123 (key or full /browse/ URL)
    ADO:        340796 (bare number) or full work item URL

  Examples:
    ${cmd} PROJ-123
    ${cmd} https://client.atlassian.net/browse/PROJ-123
    ${cmd} 340796
    ${cmd} https://dev.azure.com/org/project/_workitems/edit/340796

  Generate an env template:
    ${cmd} generate-env > .qa/.env.local`);
}

// ---------------------------------------------------------------------------
// check-env
// ---------------------------------------------------------------------------

async function checkEnv(): Promise<EnvCheckResult> {
  const envLocalPath = `${process.cwd()}/.qa/.env.local`;
  const envLocalExists = await Bun.file(envLocalPath).exists();

  const providers = PROVIDERS.map(checkProviderEnv);
  const keys = providers.flatMap((p) => p.keys);
  const missing = keys.filter((k) => !k.present).map((k) => k.name);

  return {
    envLocalPath,
    envLocalExists,
    providers,
    keys,
    missing,
    ok: envLocalExists && providers.some((p) => p.ok),
  };
}

// Advisory only: warns when the creds file exists but is not git-ignored. Skips
// silently outside a git work tree or when git is unavailable so exit codes and
// non-git workflows are unaffected.
async function warnIfCredsNotIgnored(): Promise<void> {
  const relPath = '.qa/.env.local';
  let ignoreExit: number;
  let trackedExit: number;
  try {
    ignoreExit = await Bun.spawn(['git', 'check-ignore', '-q', relPath], {
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited;
    // 128 = fatal (not a git repo / no work tree) - nothing to advise on
    if (ignoreExit === 128) return;

    trackedExit = await Bun.spawn(['git', 'ls-files', '--error-unmatch', relPath], {
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited;
  } catch {
    // git binary not on PATH - skip the advisory check
    return;
  }

  const ignored = ignoreExit === 0;
  const tracked = trackedExit === 0;
  if (tracked) {
    console.error(`\n⚠  WARNING: ${relPath} is already tracked by git — your credentials may already be committed.`);
    console.error('   Untrack it with `git rm --cached .qa/.env.local` and rotate the exposed credentials.');
    return;
  }
  if (ignored) return;

  console.error(`\n⚠  WARNING: ${relPath} exists but is not git-ignored.`);
  console.error('   Your credentials could be committed to version control.');
  console.error('   Add a `.qa/` rule to your .gitignore.');
}

async function runCheckEnv(): Promise<void> {
  const result = await checkEnv();
  console.log(JSON.stringify(result, null, 2));

  if (!result.envLocalExists) {
    console.error(`\n.qa/.env.local is missing at ${result.envLocalPath}.`);
    console.error('Create it with the keys you need:\n');

    for (const provider of PROVIDERS) {
      console.error(`  # ${provider.label}`);
      for (const key of provider.requiredEnvKeys) {
        console.error(`  ${key}=`);
      }
      console.error('');
    }

    console.error(`Tip: run \`${getScriptCmd()} generate-env > .qa/.env.local\`, then fill in the values.`);
    process.exit(1);
  }

  await warnIfCredsNotIgnored();

  const configured = result.providers.filter((p) => p.ok);
  const unconfigured = result.providers.filter((p) => !p.ok);

  if (configured.length === 0) {
    console.error('\nNo providers are fully configured.');
    for (const p of unconfigured) {
      const missing = p.keys.filter((k) => !k.present).map((k) => k.name);
      console.error(`  ${p.label}: missing ${missing.join(', ')}`);
    }
    console.error('\nFill at least one provider in .qa/.env.local.');
    process.exit(1);
  }

  for (const p of configured) {
    console.error(`${p.label}: ✓ configured`);
  }
  for (const p of unconfigured) {
    const missing = p.keys.filter((k) => !k.present).map((k) => k.name);
    console.error(`${p.label}: ✗ not configured (${missing.join(', ')})`);
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// generate-env
// ---------------------------------------------------------------------------

function runGenerateEnv(): void {
  const lines: string[] = [
    '# Generated from provider registry',
    '# Copy to .qa/.env.local and fill in values',
    '',
  ];

  for (const provider of PROVIDERS) {
    lines.push(`# ${provider.label}`);
    for (const key of provider.requiredEnvKeys) {
      lines.push(`${key}=`);
    }
    lines.push('');
  }

  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await loadLocalEnv();

  const args = getCliArgs(Bun.argv);
  const firstArg = args[0];

  if (!firstArg) {
    printUsage();
    process.exit(2);
  }

  if (HELP_FLAGS.has(firstArg)) {
    printUsage();
    process.exit(0);
  }

  if (firstArg === 'check-env') {
    await runCheckEnv();
    return;
  }

  if (firstArg === 'generate-env') {
    runGenerateEnv();
    return;
  }

  // Single fixed action: QA always fetches the issue/work item.
  const action = 'issue';
  const target = firstArg;

  const candidates = PROVIDERS.filter((p) => canProviderHandleTarget(p, action, target));
  if (candidates.length === 0) {
    console.error(`Could not recognize ticket "${target}". Use a Jira key (PROJ-123), Jira URL, ADO work item id, or ADO URL.`);
    printUsage();
    process.exit(2);
  }

  const configured = candidates.filter((p) => checkProviderEnv(p).ok);
  if (configured.length === 0) {
    const names = candidates.map((p) => p.label).join(', ');
    console.error(`Ticket matches ${names} but credentials are missing. Populate .qa/.env.local first.`);
    process.exit(1);
  }

  const provider = configured[0]!;

  // Fields needed for the ticket itself plus its dependency links. Jira: the
  // provider's `issue` action takes a comma-separated field list as `extra`.
  // ADO: `$expand=all` already returns relations.
  const isJira = provider.name === 'jira';
  const extra = isJira
    ? 'summary,description,status,issuetype,comment,attachment,issuelinks,parent,subtasks'
    : undefined;

  try {
    const result = await provider.actions.issue!(target, extra, provider.defaultEnvMapping);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Request failed: ${message}`);
    if (/Missing|environment variable/i.test(message)) {
      console.error('Check .qa/.env.local (base URL, email, PAT).');
    } else if (/401|403|404/.test(message)) {
      console.error('The PAT may be expired or lack permissions, or the URL is wrong. Check .qa/.env.local.');
    } else if (/Network error|timed out|ECONNREFUSED/i.test(message)) {
      console.error('Could not reach the server. Check network/VPN and the base URL in .qa/.env.local.');
    }
    process.exit(1);
  }
}

await main();

export { requireEnv, safeDecode };
