import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(backendDirectory, '..');
const mode = process.argv[2] ?? 'all';
const supportedModes = new Set(['core', 'infrastructure', 'ai-outage', 'all']);

if (!supportedModes.has(mode)) {
  console.error(`Unknown smoke-suite mode: ${mode}. Expected one of: ${[...supportedModes].join(', ')}.`);
  process.exit(2);
}

function run(label, command, args, cwd = repositoryRoot) {
  process.stdout.write(`\n[smoke-suite] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd,
    env: { SMOKE_COMPOSE_FILE: path.join(repositoryRoot, 'docker-compose.yml'), ...process.env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function compose(label, args) {
  run(label, 'docker', ['compose', '--env-file', '.env', ...args]);
}

function resetGatewayAndBackend() {
  // Nest throttling is process-local and the Nginx zones live in gateway
  // memory. Reset both so independent smoke cases cannot rate-limit each
  // other when the complete suite runs quickly in CI.
  compose('Reset gateway and backend test state', ['restart', 'nginx', 'backend_core']);
}

function npmScript(script) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    run(`npm run ${script}`, process.execPath, [npmCli, 'run', script], backendDirectory);
    return;
  }
  run(`npm run ${script}`, 'npm', ['run', script], backendDirectory);
}

function runCoreSuite() {
  const scripts = [
    'test:public-journey-smoke',
    'test:smoke',
    'test:user-accounts-smoke',
    'test:payments-smoke',
    'test:admin-smoke',
    'test:admin-operations-smoke',
    'test:stay-lifecycle-smoke',
    'test:room-turnover-smoke',
    'test:api-contract-smoke',
  ];
  for (const script of scripts) {
    resetGatewayAndBackend();
    npmScript(script);
  }
}

function runInfrastructureSuite() {
  for (const script of [
    'test:events-observability-smoke',
    'test:infrastructure-resilience-smoke',
  ]) {
    resetGatewayAndBackend();
    npmScript(script);
  }
}

function runAiOutageSuite() {
  resetGatewayAndBackend();
  compose('Stop AI service for outage test', ['stop', 'ai_service']);

  let testFailure = null;
  let recoveryFailure = null;
  try {
    compose('Restart backend with AI unavailable', ['restart', 'backend_core']);
    npmScript('test:ai-outage-smoke');
  } catch (error) {
    testFailure = error;
  } finally {
    try {
      compose('Restore AI service', ['start', 'ai_service']);
      compose('Restart backend after AI recovery', ['restart', 'backend_core']);
    } catch (error) {
      recoveryFailure = error;
    }
  }

  if (testFailure) throw testFailure;
  if (recoveryFailure) throw recoveryFailure;
}

try {
  if (mode === 'core' || mode === 'all') runCoreSuite();
  if (mode === 'infrastructure' || mode === 'all') runInfrastructureSuite();
  if (mode === 'ai-outage' || mode === 'all') runAiOutageSuite();
  process.stdout.write(`\n[smoke-suite] ${mode} suite completed successfully.\n`);
} catch (error) {
  console.error(`\n[smoke-suite] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
