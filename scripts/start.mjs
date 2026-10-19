// Production-style local run: API (serves the built web app) + Telegram bot, restarted on crash.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, '.env'))) {
  console.error('No .env found. Run `npm run setup` first.');
  process.exit(1);
}
if (!existsSync(path.join(root, 'web', 'dist', 'index.html'))) {
  console.log('Building web app…');
  await new Promise((res, rej) => spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error('build failed')) : res())));
}

const procs = new Map();
function run(name, args, cwd, { restart = true, delay = 0 } = {}) {
  setTimeout(() => {
    const p = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' } });
    procs.set(name, p);
    const prefix = (line) => line && console.log(`[${name}] ${line}`);
    p.stdout.on('data', (d) => d.toString().split('\n').forEach(prefix));
    p.stderr.on('data', (d) => d.toString().split('\n').forEach(prefix));
    p.on('exit', (code) => {
      procs.delete(name);
      if (stopping) return;
      if (code === 0 && name === 'bot') return; // bot exits 0 when no token is configured
      if (restart) {
        console.log(`[${name}] exited (${code}), restarting in 3s`);
        run(name, args, cwd, { restart, delay: 3000 });
      }
    });
  }, delay);
}

let stopping = false;
const stop = () => {
  stopping = true;
  for (const p of procs.values()) p.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

run('api', ['src/index.ts'], path.join(root, 'server'));
run('bot', ['src/index.ts'], path.join(root, 'bot'), { delay: 2500 });
