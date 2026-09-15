import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { auditDesignPackage, renderDesignPackage } from '../scripts/design-package.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-package-'));
  roots.push(root);
  const original = join(root, 'original');
  const resolved = join(root, 'resolved');
  mkdirSync(join(original, 'preview'), { recursive: true });
  writeFileSync(join(original, 'components.html'), '<button>Button</button>');
  writeFileSync(join(original, 'preview', 'index.html'), '<main>Preview</main>');
  mkdirSync(join(resolved, 'assets', 'generated'), { recursive: true });
  const image = Buffer.from('valid-image-fixture');
  writeFileSync(join(resolved, 'assets', 'generated', 'hero.webp'), image);
  const contract = {
    schemaVersion: 1,
    systemId: 'canary',
    tokens: {
      colors: { text: '#111111', surface: '#ffffff' }, typography: { body: '16px/1.5 sans-serif' },
      spacing: { md: '1rem' }, breakpoints: { mobile: '640px' }, radius: { md: '8px' },
      borders: { default: '1px solid #cccccc' }, elevation: { card: '0 1px 2px #00000022' }, motion: { fast: '150ms' },
    },
    contrastPairs: [{ foreground: '{colors.text}', background: '{colors.surface}', minimum: 4.5 }],
    components: [{ name: 'Button', states: ['default', 'hover', 'focus', 'disabled'] }],
    layouts: [{ route: '/', viewport: 'responsive' }],
    iconography: { package: 'lucide-react', version: '1.0.0', format: 'vector', usages: { home: 'House' } },
    imagery: { decision: 'required-only', assets: [{ id: 'hero', purpose: 'content', classification: 'required', requirementRefs: ['RF-001'], routes: ['/'], componentSlot: 'hero.image', file: 'generated/hero.webp', aspectRatio: '16:9', alt: 'Equipe trabalhando', materializeInto: 'apps/web/public/assets/hero.webp', seedBindings: [], approval: 'approved', sha256: createHash('sha256').update(image).digest('hex'), generator: { agent: 'agy', model: 'pro-high', conversationId: 'conv-1' } }] },
    microcopy: { tone: 'direct' }, antiPatterns: ['emoji as icon'],
  };
  const contractFile = join(root, 'contract.json');
  writeFileSync(contractFile, JSON.stringify(contract));
  return { original, resolved, contractFile };
}

describe('resolved design package', () => {
  it('renders deterministic token artifacts and passes semantic audit', () => {
    const data = fixture();
    expect(renderDesignPackage(data).status).toBe('PASS');
    expect(readFileSync(join(data.resolved, 'tokens.css'), 'utf8')).toContain('--colors-text: #111111');
    expect(auditDesignPackage({ resolvedDir: data.resolved }).status).toBe('PASS');
  });

  it('blocks undefined aliases, missing component states and missing required assets', () => {
    const data = fixture();
    renderDesignPackage(data);
    const contract = JSON.parse(readFileSync(join(data.resolved, 'design-contract.json'), 'utf8'));
    contract.tokens.colors.text = '{colors.unknown}';
    contract.components[0].states = ['default'];
    contract.imagery.assets[0].file = 'generated/missing.webp';
    writeFileSync(join(data.resolved, 'design-contract.json'), JSON.stringify(contract));
    writeFileSync(join(data.resolved, 'assets', 'manifest.json'), JSON.stringify({ schemaVersion: 1, decision: 'required-only', assets: contract.imagery.assets }));
    const result = auditDesignPackage({ resolvedDir: data.resolved, contract });
    expect(result.status).toBe('BLOCKED');
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'TOKEN_ALIAS_UNDEFINED', 'COMPONENT_STATE_MISSING', 'REQUIRED_ASSET_MISSING',
    ]));
  });

  it('blocks a seed/demo asset that has no seed binding while allowing static required imagery', () => {
    const data = fixture();
    renderDesignPackage(data);
    const manifestPath = join(data.resolved, 'assets', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.assets[0].purpose = 'seed-demo';
    manifest.assets[0].seedBindings = [];
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = auditDesignPackage({ resolvedDir: data.resolved });
    expect(result.status).toBe('BLOCKED');
    expect(result.findings.map((finding) => finding.code)).toContain('ASSET_BINDING_INCOMPLETE');
  });
});
