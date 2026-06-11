/**
 * Execution-mode tests (--modo).
 *
 * The execution mode selects which engine performs the heavy generative work of
 * the Pensador workflow while Claude Code orchestrates and owns AskUserQuestion.
 * These tests pin the deterministic reference behavior in pensador-engine.mjs.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXECUTION_MODE,
  EXECUTION_MODES,
  parseExecutionMode,
  resolveExecutionMode,
  buildDelegationInvocation,
} from '../scripts/pensador-engine.mjs';

describe('EXECUTION_MODES registry', () => {
  it('default mode is claude and does not delegate', () => {
    expect(DEFAULT_EXECUTION_MODE).toBe('claude');
    expect(EXECUTION_MODES.claude.delegates).toBe(false);
    expect(EXECUTION_MODES.claude.command).toBeNull();
  });

  it('exposes agy, kiro and codex delegating modes', () => {
    for (const mode of ['agy', 'kiro', 'codex']) {
      expect(EXECUTION_MODES[mode].delegates).toBe(true);
      expect(typeof EXECUTION_MODES[mode].command).toBe('string');
      expect(EXECUTION_MODES[mode].plugin).toMatchObject({
        marketplace: expect.any(String),
        name: expect.any(String),
      });
    }
  });

  it('pins the canonical commands and default model/effort', () => {
    expect(EXECUTION_MODES.agy.command).toBe('/cc-antigravity-plugin:antigravity');
    expect(EXECUTION_MODES.agy.defaultModel).toBe('claude-4.6-opus-thinking');
    expect(EXECUTION_MODES.agy.defaultEffort).toBeNull();

    expect(EXECUTION_MODES.kiro.command).toBe('/cc-kiro-plugin:kiro');
    expect(EXECUTION_MODES.kiro.defaultModel).toBe('claude-opus-4.8');
    expect(EXECUTION_MODES.kiro.defaultEffort).toBe('high');

    expect(EXECUTION_MODES.codex.command).toBe('/codex:rescue');
    expect(EXECUTION_MODES.codex.defaultModel).toBeNull();
    expect(EXECUTION_MODES.codex.defaultEffort).toBe('high');
  });
});

describe('parseExecutionMode(rawArgs)', () => {
  it('defaults to claude when no flag is present and returns the full demanda', () => {
    expect(parseExecutionMode('Crie uma tela de login')).toEqual({
      mode: 'claude',
      requestedMode: null,
      modeValid: true,
      modelOverride: null,
      effortOverride: null,
      demanda: 'Crie uma tela de login',
    });
  });

  it('extracts --modo agy and strips it from the demanda', () => {
    const r = parseExecutionMode('--modo agy Crie uma tela de login');
    expect(r.mode).toBe('agy');
    expect(r.requestedMode).toBe('agy');
    expect(r.modeValid).toBe(true);
    expect(r.demanda).toBe('Crie uma tela de login');
  });

  it('accepts --modo=kiro syntax and is case-insensitive', () => {
    const r = parseExecutionMode('Construir API --modo=KIRO');
    expect(r.mode).toBe('kiro');
    expect(r.demanda).toBe('Construir API');
  });

  it('flags an unknown mode as invalid and falls back to claude', () => {
    const r = parseExecutionMode('--modo turbo faça algo');
    expect(r.mode).toBe('claude');
    expect(r.requestedMode).toBe('turbo');
    expect(r.modeValid).toBe(false);
    expect(r.demanda).toBe('faça algo');
  });

  it('captures --model and --effort overrides and removes them from the demanda', () => {
    const r = parseExecutionMode('--modo agy --model gpt-x --effort high Construir checkout');
    expect(r.mode).toBe('agy');
    expect(r.modelOverride).toBe('gpt-x');
    expect(r.effortOverride).toBe('high');
    expect(r.demanda).toBe('Construir checkout');
  });

  it('is total — never throws for nullish / non-string input', () => {
    expect(() => parseExecutionMode(undefined)).not.toThrow();
    expect(() => parseExecutionMode(null)).not.toThrow();
    expect(parseExecutionMode(undefined).mode).toBe('claude');
    expect(parseExecutionMode(null).demanda).toBe('');
  });
});

describe('resolveExecutionMode(mode, overrides)', () => {
  it('resolves claude with no model/effort', () => {
    const r = resolveExecutionMode('claude');
    expect(r.delegates).toBe(false);
    expect(r.model).toBeNull();
    expect(r.effort).toBeNull();
    expect(r.modelSource).toBe('none');
    expect(r.effortSource).toBe('none');
  });

  it('resolves agy with its default model and no effort', () => {
    const r = resolveExecutionMode('agy');
    expect(r.model).toBe('claude-4.6-opus-thinking');
    expect(r.modelSource).toBe('default');
    expect(r.effort).toBeNull();
    expect(r.effortSource).toBe('none');
  });

  it('resolves kiro with Claude Opus 4.8 at high effort by default', () => {
    const r = resolveExecutionMode('kiro');
    expect(r.model).toBe('claude-opus-4.8');
    expect(r.modelSource).toBe('default');
    expect(r.effort).toBe('high');
    expect(r.effortSource).toBe('default');
  });

  it('lets a --model override take precedence (keeping the default effort) for kiro', () => {
    const r = resolveExecutionMode('kiro', { model: 'sonnet' });
    expect(r.model).toBe('sonnet');
    expect(r.modelSource).toBe('override');
    expect(r.effort).toBe('high');
    expect(r.effortSource).toBe('default');
  });

  it('lets a --model override take precedence for agy', () => {
    expect(resolveExecutionMode('agy', { modelOverride: 'gemini-x' })).toMatchObject({
      model: 'gemini-x',
      modelSource: 'override',
    });
  });

  it('codex defaults to effort high and caps xhigh/extrahigh to high', () => {
    expect(resolveExecutionMode('codex').effort).toBe('high');
    expect(resolveExecutionMode('codex', { effortOverride: 'xhigh' }).effort).toBe('high');
    expect(resolveExecutionMode('codex', { effort: 'extrahigh' }).effort).toBe('high');
    expect(resolveExecutionMode('codex', { effort: 'medium' }).effort).toBe('medium');
    expect(resolveExecutionMode('codex').model).toBeNull();
  });

  it('falls back to claude for an unknown mode', () => {
    expect(resolveExecutionMode('bogus').mode).toBe('claude');
  });
});

describe('buildDelegationInvocation(mode, payload)', () => {
  it('returns null for the non-delegating claude mode', () => {
    expect(buildDelegationInvocation('claude', { prompt: 'x' })).toBeNull();
  });

  it('builds the AGY invocation with the default model and a quoted prompt', () => {
    expect(buildDelegationInvocation('agy', { prompt: 'PromptSystem' })).toBe(
      '/cc-antigravity-plugin:antigravity --model claude-4.6-opus-thinking "PromptSystem"'
    );
  });

  it('builds the Kiro invocation with Claude Opus 4.8 and effort high by default', () => {
    expect(buildDelegationInvocation('kiro', { prompt: 'PromptSystem' })).toBe(
      '/cc-kiro-plugin:kiro --model claude-opus-4.8 --effort high "PromptSystem"'
    );
  });

  it('honors a --model override for kiro while keeping the default effort', () => {
    expect(buildDelegationInvocation('kiro', { prompt: 'do it', model: 'sonnet' })).toBe(
      '/cc-kiro-plugin:kiro --model sonnet --effort high "do it"'
    );
  });

  it('builds the Codex invocation with effort high', () => {
    expect(buildDelegationInvocation('codex', { prompt: 'PromptSystem' })).toBe(
      '/codex:rescue --effort high "PromptSystem"'
    );
  });

  it('escapes quotes inside the prompt via JSON quoting', () => {
    expect(buildDelegationInvocation('agy', { prompt: 'say "hi"' })).toBe(
      '/cc-antigravity-plugin:antigravity --model claude-4.6-opus-thinking "say \\"hi\\""'
    );
  });

  it('accepts a pre-resolved config object', () => {
    const config = resolveExecutionMode('agy', { modelOverride: 'gemini-x' });
    expect(buildDelegationInvocation(config, { prompt: 'task' })).toBe(
      '/cc-antigravity-plugin:antigravity --model gemini-x "task"'
    );
  });
});
