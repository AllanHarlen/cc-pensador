import { describe, it, expect } from 'vitest';
import { allocateFeatureDir, buildFeaturePath } from '../scripts/pensador-engine.mjs';

describe('allocateFeatureDir(existingFeatureDirs, options)', () => {
  it('allocates feature-n1 when no existing feature directories are present', () => {
    expect(allocateFeatureDir([])).toEqual({
      featureDir: '.pensador/feature-n1',
      featureN: 1,
      isResume: false,
    });
  });

  it('allocates feature-n2 when feature-n1 exists', () => {
    expect(allocateFeatureDir(['feature-n1'])).toMatchObject({
      featureDir: '.pensador/feature-n2',
      featureN: 2,
    });
  });

  it('allocates feature-n4 when feature-n1 through feature-n3 exist', () => {
    expect(allocateFeatureDir(['feature-n1', 'feature-n2', 'feature-n3'])).toMatchObject({
      featureDir: '.pensador/feature-n4',
      featureN: 4,
    });
  });

  it('ignores non-feature directory names', () => {
    expect(allocateFeatureDir(['other-dir', 'not-a-feature'])).toMatchObject({
      featureDir: '.pensador/feature-n1',
      featureN: 1,
    });
  });

  it('appends nameSuffix to the allocated feature directory', () => {
    expect(allocateFeatureDir(['feature-n1'], { nameSuffix: 'login' }).featureDir).toBe(
      '.pensador/feature-n2-login'
    );
  });

  it('handles an empty options object', () => {
    expect(allocateFeatureDir([], {}).featureDir).toBe('.pensador/feature-n1');
  });

  it('resumes feature-n2 when incompleteCheckpoint is feature-n2', () => {
    expect(allocateFeatureDir(['feature-n1', 'feature-n2'], { incompleteCheckpoint: 'feature-n2' })).toEqual({
      featureDir: '.pensador/feature-n2',
      isResume: true,
      featureN: 2,
    });
  });

  it('resumes feature-n1 when incompleteCheckpoint is feature-n1', () => {
    expect(allocateFeatureDir(['feature-n1', 'feature-n2'], { incompleteCheckpoint: 'feature-n1' })).toMatchObject({
      featureDir: '.pensador/feature-n1',
      isResume: true,
    });
  });

  it('does not throw for [] or ([], undefined)', () => {
    expect(() => allocateFeatureDir([])).not.toThrow();
    expect(() => allocateFeatureDir([], undefined)).not.toThrow();
  });
});

describe('buildFeaturePath(featureDir, subdir)', () => {
  it('builds shared-agents under feature-n1', () => {
    expect(buildFeaturePath('.pensador/feature-n1', 'shared-agents')).toBe(
      '.pensador/feature-n1/shared-agents'
    );
  });

  it('builds pensador-output under feature-n1', () => {
    expect(buildFeaturePath('.pensador/feature-n1', 'pensador-output')).toBe(
      '.pensador/feature-n1/pensador-output'
    );
  });

  it('builds shared-agents under a suffixed feature directory', () => {
    expect(buildFeaturePath('.pensador/feature-n2-login', 'shared-agents')).toBe(
      '.pensador/feature-n2-login/shared-agents'
    );
  });
});
