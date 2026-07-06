import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = path.join(rootDir, 'workers');
const isWindows = process.platform === 'win32';
const workerUrl = process.env.VITE_WORKER_API_BASE_URL || 'http://127.0.0.1:8787';

const processes = [];
let shuttingDown = false;

const startProcess = (name, command, args, options = {}) => {
  const spawnCommand = isWindows ? 'cmd.exe' : command;
  const spawnArgs = isWindows ? ['/d', '/s', '/c', command, ...args] : args;

  const child = spawn(spawnCommand, spawnArgs, {
    cwd: options.cwd || rootDir,
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  processes.push(child);

  const prefixOutput = (stream, output) => {
    output.on('data', chunk => {
      String(chunk)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach(line => stream.write(`[${name}] ${line}\n`));
    });
  };

  prefixOutput(process.stdout, child.stdout);
  prefixOutput(process.stderr, child.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[dev-local] ${name} exited (${signal || code}). Stopping the other process...`);
    stopAll();
    process.exit(code ?? 0);
  });

  return child;
};

const stopAll = () => {
  for (const child of processes) {
    if (child.killed || child.exitCode !== null) continue;

    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  }
};

process.on('SIGINT', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[dev-local] Stopping local dev servers...');
  stopAll();
});

process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAll();
});

console.log(`[dev-local] Worker URL for Vite: ${workerUrl}`);

startProcess('worker', 'npx', [
  'wrangler',
  'dev',
  '--config',
  'wrangler.ai-proxy.example.toml',
  '--port',
  '8787',
], { cwd: workerDir });

startProcess('vite', 'npm', ['run', 'dev'], {
  env: {
    ...process.env,
    VITE_WORKER_API_BASE_URL: workerUrl,
  },
});
