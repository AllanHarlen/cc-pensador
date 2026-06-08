import { describe, it, expect } from 'vitest';
import { allocateFeatureDir, buildFeaturePath, slugify } from '../scripts/pensador-engine.mjs';

describe('slugify(name)', () => {
  it('lowercases and hyphenates a multi-word name', () => {
    expect(slugify('Login Social')).toBe('login-social');
  });

  it('strips accents/diacritics', () => {
    expect(slugify('Autenticação de Usuário')).toBe('autenticacao-de-usuario');
  });

  it('collapses runs of non-alphanumeric characters into a single hyphen', () => {
    expect(slugify('  carrinho / checkout!! ')).toBe('carrinho-checkout');
  });

  it('returns an empty string for blank input', () => {
    expect(slugify('   ')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });
});

describe('allocateFeatureDir(existingFeatureDirs, options)', () => {
  it('uses the slug of the update name plus v1 as the first directory', () => {
    expect(allocateFeatureDir([], { name: 'Login Social' })).toEqual({
      featureDir: '.pensador/login-social-v1',
      slug: 'login-social-v1',
      isResume: false,
    });
  });

  it('accepts a pre-computed slug and adds v1', () => {
    expect(allocateFeatureDir([], { slug: 'checkout' }).featureDir).toBe(
      '.pensador/checkout-v1'
    );
  });

  it('falls back to "atualizacao" when no name is provided', () => {
    expect(allocateFeatureDir([], {}).featureDir).toBe('.pensador/atualizacao-v1');
    expect(allocateFeatureDir([]).featureDir).toBe('.pensador/atualizacao-v1');
  });

  it('falls back to "atualizacao" when the name slugifies to empty', () => {
    expect(allocateFeatureDir([], { name: '   !!!  ' }).featureDir).toBe(
      '.pensador/atualizacao-v1'
    );
  });

  it('increments the version when the same demand slug already exists', () => {
    expect(
      allocateFeatureDir(['login-social-v1', 'login-social-v2'], { name: 'Login Social' })
    ).toEqual({
      featureDir: '.pensador/login-social-v3',
      slug: 'login-social-v3',
      isResume: false,
    });
  });

  it('ignores other demand slugs and malformed versions when choosing the next version', () => {
    expect(
      allocateFeatureDir(['login-social-v1', 'login-social-vx', 'checkout-v9'], {
        name: 'Login Social',
      }).featureDir
    ).toBe('.pensador/login-social-v2');
  });

  it('accepts existing directories with .pensador prefixes or trailing slashes', () => {
    expect(
      allocateFeatureDir(['.pensador/login-social-v1/', '.pensador/login-social-v2'], {
        name: 'Login Social',
      }).featureDir
    ).toBe('.pensador/login-social-v3');
  });

  it('resumes the directory named by an incomplete checkpoint', () => {
    expect(
      allocateFeatureDir(['login-social-v1'], { incompleteCheckpoint: 'login-social-v1' })
    ).toEqual({
      featureDir: '.pensador/login-social-v1',
      isResume: true,
      slug: 'login-social-v1',
    });
  });

  it('does not throw for [] or ([], undefined)', () => {
    expect(() => allocateFeatureDir([])).not.toThrow();
    expect(() => allocateFeatureDir([], undefined)).not.toThrow();
  });
});

describe('buildFeaturePath(featureDir, subdir)', () => {
  it('builds shared-agents under the update directory', () => {
    expect(buildFeaturePath('.pensador/login-social-v1', 'shared-agents')).toBe(
      '.pensador/login-social-v1/shared-agents'
    );
  });
});
