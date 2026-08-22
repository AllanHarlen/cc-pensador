/**
 * Pins the manifest-driven contract of scripts/od-fetch-system.mjs: the
 * script must derive its expected-file list from manifest.json when present
 * (upstream schema 'od-design-system-project/v1'), report every
 * manifest-promised file it failed to copy under `unexpectedMissing` instead
 * of silently succeeding, and never depend on a live OpenDesign install —
 * this suite runs entirely against on-disk fixtures.
 *
 * `deriveExpectedFiles` is exercised as a pure unit (no I/O). The end-to-end
 * exit-code/unexpectedMissing behavior is exercised by spawning the script
 * itself against temp fixtures, mirroring the manual verification run during
 * implementation (see the OpenDesign upgrade plan, Workstream D).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveExpectedFiles } from '../scripts/od-fetch-system.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/od-fetch-system.mjs', import.meta.url));

describe('deriveExpectedFiles (pure, no I/O)', () => {
  it('derives the required + optional file list from an upstream-shaped manifest', () => {
    const manifest = {
      schemaVersion: 'od-design-system-project/v1',
      files: {
        design: 'DESIGN.md',
        tokens: 'tokens.css',
        designTokens: 'design-tokens.json',
        tailwind: 'tailwind-v4.css',
        components: 'components.html',
      },
      usage: 'USAGE.md',
      componentsManifest: 'components.manifest.json',
      preview: { pages: [{ path: 'preview/colors.html' }, { path: 'preview/typography.html' }] },
      sourceFiles: { evidence: 'source/evidence.md', tokens: 'source/tokens.source.json' },
    };
    const { files, required } = deriveExpectedFiles(manifest);
    expect(required).toEqual(new Set(['DESIGN.md', 'tokens.css']));
    expect(files).toEqual(
      expect.arrayContaining([
        'DESIGN.md',
        'tokens.css',
        'design-tokens.json',
        'tailwind-v4.css',
        'components.html',
        'USAGE.md',
        'components.manifest.json',
        'preview/colors.html',
        'preview/typography.html',
        'source/evidence.md',
        'source/tokens.source.json',
      ]),
    );
  });

  it('is total on a minimal/legacy manifest (only files.design + files.tokens)', () => {
    const { files, required } = deriveExpectedFiles({
      schemaVersion: 'od-design-system-project/v1',
      files: { design: 'DESIGN.md', tokens: 'tokens.css' },
    });
    expect(files).toEqual(['DESIGN.md', 'tokens.css']);
    expect(required).toEqual(new Set(['DESIGN.md', 'tokens.css']));
  });

  it('is total on an empty/malformed manifest — never throws', () => {
    expect(() => deriveExpectedFiles({})).not.toThrow();
    const { files, required } = deriveExpectedFiles({});
    expect(files).toEqual([]);
    expect(required.size).toBe(0);
  });
});

describe('od-fetch-system.mjs CLI (fixture clone, no live OpenDesign)', () => {
  const tmpDirs = [];
  function fixtureDir() {
    const dir = mkdtempSync(join(tmpdir(), 'od-fetch-test-'));
    tmpDirs.push(dir);
    return dir;
  }
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function run(args) {
    try {
      const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
      return { status: 0, json: JSON.parse(stdout) };
    } catch (err) {
      // execFileSync throws on non-zero exit; stdout is still captured.
      return { status: err.status, json: JSON.parse(err.stdout) };
    }
  }

  it('reports unexpectedMissing (never silent) when the manifest promises files the clone lacks', () => {
    const root = fixtureDir();
    const sysDir = join(root, 'clone', 'incomplete');
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(
      join(sysDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 'od-design-system-project/v1',
        files: {
          design: 'DESIGN.md',
          tokens: 'tokens.css',
          designTokens: 'design-tokens.json',
          components: 'components.html',
        },
        componentsManifest: 'components.manifest.json',
      }),
    );
    writeFileSync(join(sysDir, 'DESIGN.md'), '# Design');
    writeFileSync(join(sysDir, 'tokens.css'), ':root{}');
    // design-tokens.json, components.html, components.manifest.json deliberately absent.

    const { status, json } = run([
      '--id', 'incomplete',
      '--repo', join(root, 'out'),
      '--out-dir', '.',
      '--clone-dir', join(root, 'clone'),
      '--daemon-url', 'http://127.0.0.1:1',
    ]);

    expect(status).toBe(0); // required files present → success exit
    const result = json.results[0];
    expect(result.ok).toBe(true);
    expect(result.manifestUsed).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.unexpectedMissing.sort()).toEqual(
      ['components.html', 'components.manifest.json', 'design-tokens.json'].sort(),
    );
  });

  it('exits 6 when a required file (tokens.css/DESIGN.md) is missing even with a source found', () => {
    const root = fixtureDir();
    const sysDir = join(root, 'clone', 'broken');
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(
      join(sysDir, 'manifest.json'),
      JSON.stringify({ schemaVersion: 'od-design-system-project/v1', files: { design: 'DESIGN.md', tokens: 'tokens.css' } }),
    );
    // Neither DESIGN.md nor tokens.css actually present.

    const { status, json } = run([
      '--id', 'broken',
      '--repo', join(root, 'out'),
      '--out-dir', '.',
      '--clone-dir', join(root, 'clone'),
      '--daemon-url', 'http://127.0.0.1:1',
    ]);

    expect(status).toBe(6);
    expect(json.ok).toBe(false);
    expect(json.results[0].missingRequired.sort()).toEqual(['DESIGN.md', 'tokens.css'].sort());
  });

  it('exits 5 when no source at all is found for a system', () => {
    const root = fixtureDir();
    mkdirSync(join(root, 'clone'), { recursive: true });

    const { status, json } = run([
      '--id', 'nonexistent',
      '--repo', join(root, 'out'),
      '--out-dir', '.',
      '--clone-dir', join(root, 'clone'),
      '--daemon-url', 'http://127.0.0.1:1',
    ]);

    expect(status).toBe(5);
    expect(json.results[0].reason).toBe('no-source');
  });

  it('falls back to OPEN_DESIGN.systemArtifacts when the system ships no manifest.json (legacy)', () => {
    const root = fixtureDir();
    const sysDir = join(root, 'clone', 'legacy');
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(join(sysDir, 'DESIGN.md'), '# Design');
    writeFileSync(join(sysDir, 'tokens.css'), ':root{}');

    const { status, json } = run([
      '--id', 'legacy',
      '--repo', join(root, 'out'),
      '--out-dir', '.',
      '--clone-dir', join(root, 'clone'),
      '--daemon-url', 'http://127.0.0.1:1',
    ]);

    expect(status).toBe(0);
    const result = json.results[0];
    expect(result.manifestUsed).toBe(false);
    expect(result.ok).toBe(true);
    // No manifest promise to violate on the legacy path.
    expect(result.unexpectedMissing).toEqual([]);
  });

  it('--locale additionally fetches DESIGN-<locale>.md, non-fatal when absent', () => {
    const root = fixtureDir();
    const sysDir = join(root, 'clone', 'localized');
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(join(sysDir, 'manifest.json'), JSON.stringify({ schemaVersion: 'od-design-system-project/v1', files: { design: 'DESIGN.md', tokens: 'tokens.css' } }));
    writeFileSync(join(sysDir, 'DESIGN.md'), '# Design');
    writeFileSync(join(sysDir, 'tokens.css'), ':root{}');
    writeFileSync(join(sysDir, 'DESIGN-pt-br.md'), '# Design PT');

    const { status, json } = run([
      '--id', 'localized',
      '--repo', join(root, 'out'),
      '--out-dir', '.',
      '--clone-dir', join(root, 'clone'),
      '--daemon-url', 'http://127.0.0.1:1',
      '--locale', 'pt-br',
    ]);

    expect(status).toBe(0);
    expect(json.results[0].copied).toContain('DESIGN-pt-br.md');
  });
});
