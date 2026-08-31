import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('claude plugin manifest is valid JSON with required fields', () => {
  const m = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  expect(m.name).toBe('ritus-qa');
  expect(typeof m.description).toBe('string');
  expect(m.description.length).toBeGreaterThan(20);
});

test('copilot plugin manifest is valid JSON with required fields', () => {
  const m = JSON.parse(readFileSync(join(root, '.github', 'copilot-plugin.json'), 'utf8'));
  expect(m.name).toBe('ritus-qa');
  expect(typeof m.description).toBe('string');
});

test('the bundled .mcp.json ships only the plugin\'s own server, at a pinned version', () => {
  // The plugin bundles its own generator so a QA never hand-wires it. It deliberately does
  // NOT bundle 'playwright' or 'figma': those belong to the project under test, and MCP
  // servers use last-wins precedence, so bundling them would silently override a project's
  // own config for the same name.
  const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) as {
    mcpServers: Record<string, { command?: string; args?: string[] }>;
  };
  expect(Object.keys(mcp.mcpServers)).toEqual(['cms-test-data']);

  // The server runs from the published npm package, never from a path inside the
  // installed plugin: that directory has no node_modules, and Bun's auto-install
  // fails there on Windows.
  const args = (mcp.mcpServers['cms-test-data']!.args ?? []).join(' ');
  expect(args, '.mcp.json must not run the server from a plugin path').not.toContain('src/mcp');
  expect(args).not.toContain('PLUGIN_ROOT');

  // An unpinned spec (@latest, or no version at all) is re-resolved on every session
  // start — ~11s each time instead of ~0.7s from cache. The package is released from
  // its own repo, so nothing here can check the number is current; only that one is set.
  const spec = (mcp.mcpServers['cms-test-data']!.args ?? []).find((a) =>
    a.startsWith('cms-test-data-mcp@'),
  );
  expect(spec, '.mcp.json must pin an exact version of the MCP server').toMatch(
    /^cms-test-data-mcp@\d+\.\d+\.\d+$/,
  );
});

test('env template lists every required variable', () => {
  const t = readFileSync(join(root, 'templates', 'env.local.example'), 'utf8');
  for (const v of ['JIRA_BASE_URL', 'JIRA_PAT', 'JIRA_EMAIL', 'AZURE_DEVOPS_READONLY_PAT', 'AZURE_DEVOPS_ORG', 'AZURE_DEVOPS_PROJECT', 'TEST_BASE_URL']) {
    expect(t).toContain(v);
  }
});

test('.gitignore still ignores .qa/', () => {
  expect(readFileSync(join(root, '.gitignore'), 'utf8')).toMatch(/^\.qa\/?$/m);
});

test('README documents the MCP server, where it is developed, and the schema export path', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  expect(readme).toContain('cms-test-data-mcp');
  expect(readme).toContain('bunx');
  expect(readme).toContain('.qa/cms-schema/content-types.episerverdata');
  // The server is released from its own repo now; a QA who needs to change it has
  // to be told where to go, or they will look for source that is not here.
  expect(readme).toContain('github.com/precise-alloy/cms-test-data-mcp');
});
