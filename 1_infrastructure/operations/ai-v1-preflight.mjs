// Read-only M0 diagnostics. Does not start services, install software, or load .env.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = process.argv[2];
if (!/^\d{8}-\d{6}$/.test(runId ?? '')) {
  throw new Error('Usage: node 1_infrastructure/operations/ai-v1-preflight.mjs YYYYMMDD-HHMMSS');
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(root, 'artifacts/hotelai-ai-v1', runId, 'M0', stamp);
mkdirSync(evidence, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
function redact(value) {
  return String(value ?? '').replace(/C:\\Users\\[^\\\s]+/gi, '<USERPROFILE>')
    .replace(/C:\/Users\/[^/\s]+/gi, '<USERPROFILE>');
}
function command(binary, args, timeout = 12000) {
  const result = spawnSync(binary, args, {
    cwd: root, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024,
  });
  return { ok: result.status === 0, exit_code: result.status,
    stdout: redact(result.stdout).trim(), stderr: redact(result.stderr).trim(),
    error: result.error?.code ?? null };
}
function save(name, value) {
  writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
const docker = command('docker', ['info', '--format', '{{json .ServerVersion}}']);
save('docker.json', docker);
const compose = command('docker', ['compose', 'version', '--short']);
save('compose.json', compose);
let machine = { status: 'not_measured', platform: process.platform };
if (process.platform === 'win32') {
  const measurement = command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; $gpu=Get-CimInstance Win32_VideoController; [pscustomobject]@{total_gib=$os.TotalVisibleMemorySize/1MB;available_gib=$os.FreePhysicalMemory/1MB;cpu=$cpu.Name;cores=$cpu.NumberOfCores;threads=$cpu.NumberOfLogicalProcessors;gpu=@($gpu.Name)} | ConvertTo-Json -Compress"]);
  try { machine = { status: 'measured', ...JSON.parse(measurement.stdout) }; }
  catch { machine = { status: 'measurement_failed', details: measurement }; }
}
save('machine.json', machine);

// Old ports 53123/53124/58020 belong to the academic preview and cannot prove M0.
// Probe only the existing Ollama runtime; full-app health requires the new launcher.
let ollama;
try {
  const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
  const body = response.ok ? await response.json() : {};
  ollama = { ok: response.ok, http_status: response.status,
    models: (body.models ?? []).map(model => ({ name: model.name, digest: model.digest,
      size: model.size, quantization: model.details?.quantization_level })) };
} catch { ollama = { ok: false, reason: 'loopback_runtime_unavailable' }; }
save('ollama.json', ollama);

const git = command('git', ['status', '--porcelain=v1', '-z']);
const branch = command('git', ['branch', '--show-current']);
const head = command('git', ['rev-parse', 'HEAD']);
const planHash = sha256(readFileSync(path.join(root, 'docs/HOTELAI_AI_V1_PLAN.md')));
const report = {
  measured_at: new Date().toISOString(), run_id: runId, milestone: 'M0',
  status: docker.ok ? 'in_progress' : 'blocked',
  blockers: docker.ok ? [] : ['docker_engine_unavailable'],
  branch: branch.stdout, base_commit: head.stdout, plan_sha256: planHash,
  worktree_status_sha256: sha256(git.stdout),
  docker_available: docker.ok, ollama_available: ollama.ok,
  machine, memory_headroom_target_gib: 1.5,
  full_stack_verified: false, backup_restore_verified: false,
  qwen_runtime_frozen: false, performance_gate_measured: false,
  next_milestone_authorized: false,
};
save('report.json', report);
const manifest = readdirSync(evidence).sort().map(name => {
  const bytes = readFileSync(path.join(evidence, name));
  return { file: name, bytes: bytes.length, sha256: sha256(bytes) };
});
save('manifest.json', manifest);
console.log(JSON.stringify({ ...report, evidence: path.relative(root, evidence) }, null, 2));
process.exitCode = docker.ok ? 0 : 2;
