import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards production Pages bundle against accidentally shipping DEV_AUTH / test tokens.
 * Expects `npm run build` to have produced web/dist beforehand when run in CI locally after build.
 */
describe('production bundle auth safety', () => {
  it('does not embed VITE_DEV_AUTH=true or test: auth tokens when dist exists', () => {
    const distDir = path.resolve(__dirname, '../dist/assets');
    let files: string[] = [];
    try {
      files = readdirSync(distDir).filter((name) => name.endsWith('.js'));
    } catch {
      expect(true).toBe(true);
      return;
    }
    expect(files.length).toBeGreaterThan(0);

    const combined = files.map((file) => readFileSync(path.join(distDir, file), 'utf8')).join('\n');

    expect(combined).not.toMatch(/VITE_DEV_AUTH["']?\s*[:=]\s*["']true["']/);
    expect(combined).not.toContain('VITE_DEV_AUTH:true');
    expect(combined).not.toMatch(/allowDev\s*=\s*!0\b/);
    expect(combined).not.toMatch(/test:U-/);
    expect(combined).not.toMatch(/["']U-dev["']/);
    expect(combined).toContain('https://joyin.joyin.workers.dev');

    const envProd = readFileSync(path.resolve(__dirname, '../.env.production'), 'utf8');
    expect(envProd).toMatch(/VITE_DEV_AUTH\s*=\s*false/);
    expect(envProd).toMatch(/VITE_API_BASE_URL\s*=\s*https:\/\/joyin\.joyin\.workers\.dev/);
  });
});
