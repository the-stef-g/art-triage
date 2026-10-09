// Omdoebningen til Stef G Art maa ikke koste Stef indstillinger og noegler.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { overtagGamleData } from '../electron/lib/migrate.mjs';

let rod;
let gammel;
let ny;

beforeEach(() => {
  rod = mkdtempSync(join(tmpdir(), 'sga-migrate-'));
  gammel = join(rod, 'Art Triage');
  ny = join(rod, 'Stef G Art');
});
afterEach(() => rmSync(rod, { recursive: true, force: true }));

describe('overtagelse af gamle brugerdata', () => {
  it('kopierer indstillinger og model, og lader den gamle mappe staa', () => {
    mkdirSync(join(gammel, 'model-cache'), { recursive: true });
    writeFileSync(join(gammel, 'billedflow-settings.json'), '{"claudeKey":"k"}');
    writeFileSync(join(gammel, 'model-cache', 'model.onnx'), 'vaegte');
    writeFileSync(join(gammel, 'SingletonLock'), 'ikke med');
    expect(overtagGamleData(gammel, ny)).toBe(true);
    expect(readFileSync(join(ny, 'billedflow-settings.json'), 'utf8')).toContain('claudeKey');
    expect(readFileSync(join(ny, 'model-cache', 'model.onnx'), 'utf8')).toBe('vaegte');
    expect(existsSync(join(ny, 'SingletonLock'))).toBe(false);
    expect(existsSync(join(gammel, 'billedflow-settings.json'))).toBe(true);
  });

  it('rører ikke nye indstillinger, og gør intet uden en gammel mappe', () => {
    expect(overtagGamleData(gammel, ny)).toBe(false);
    mkdirSync(gammel, { recursive: true });
    writeFileSync(join(gammel, 'billedflow-settings.json'), 'gammel');
    mkdirSync(ny, { recursive: true });
    writeFileSync(join(ny, 'billedflow-settings.json'), 'ny');
    expect(overtagGamleData(gammel, ny)).toBe(false);
    expect(readFileSync(join(ny, 'billedflow-settings.json'), 'utf8')).toBe('ny');
  });
});
