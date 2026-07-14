// Venter paa at Vite dev-serveren svarer og starter saa Electron mod den.
import { spawn } from 'node:child_process';

const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

async function waitFor(target, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(target);
      if (res.ok) return;
    } catch {
      // serveren er ikke oppe endnu
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Vite-serveren svarede ikke paa ${target}`);
}

await waitFor(url);
const child = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', (code) => process.exit(code ?? 0));
