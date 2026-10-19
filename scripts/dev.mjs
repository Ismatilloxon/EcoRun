// Development: API with --watch, Vite dev server (http://localhost:5173) and the Telegram bot.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
const start = (name, cmd, args, cwd) => {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (d) => d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  children.push(p);
};
start('api', process.execPath, ['--watch', 'src/index.ts'], path.join(root, 'server'));
start('web', 'npx', ['vite'], path.join(root, 'web'));
setTimeout(() => start('bot', process.execPath, ['--watch', 'src/index.ts'], path.join(root, 'bot')), 2500);
const stop = () => {
  children.forEach((c) => c.kill('SIGTERM'));
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
