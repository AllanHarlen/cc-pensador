/**
 * Unit tests for scripts/lib/contract-coverage.mjs — the screen-to-contract-
 * operation cross-check that closes the OficinaAI gap (41 RFs, 21 openapi.yaml
 * operations, no list endpoint for the painel's core screens).
 */
import { describe, it, expect } from 'vitest';
import {
  parseOpenApiOperations,
  normalizeOperationKey,
  parseOperationRef,
  validateContractCoverage,
} from '../scripts/lib/contract-coverage.mjs';

const SAMPLE_OPENAPI = `openapi: 3.1.0
info:
  title: Sample
  version: "1.0.0"
servers:
  - url: /api/v1
paths:
  /public/{subdominio}/leads:
    post:
      summary: Cria um lead
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                nome:
                  type: string
      responses:
        '201':
          description: Created
  /ordens-servico:
    post:
      summary: Cria OS
      responses:
        '201':
          description: Created
  /ordens-servico/{id}:
    get:
      summary: Detalha OS
      parameters:
        - name: id
          in: path
          schema:
            type: string
      responses:
        '200':
          description: OK
    put:
      summary: Atualiza OS
      responses:
        '200':
          description: OK
components:
  schemas:
    Foo:
      type: object
`;

describe('parseOpenApiOperations', () => {
  it('extracts every method under every path, ignoring deeply nested schema keys', () => {
    const ops = parseOpenApiOperations(SAMPLE_OPENAPI);
    expect(ops).toEqual([
      { method: 'POST', path: '/public/{subdominio}/leads' },
      { method: 'POST', path: '/ordens-servico' },
      { method: 'GET', path: '/ordens-servico/{id}' },
      { method: 'PUT', path: '/ordens-servico/{id}' },
    ]);
  });

  it('never trips on a schema property literally named "get"/"post" nested under a path', () => {
    const text = `paths:
  /webhooks:
    post:
      requestBody:
        content:
          application/json:
            schema:
              properties:
                get:
                  type: string
                delete:
                  type: boolean
      responses:
        '200':
          description: OK
`;
    expect(parseOpenApiOperations(text)).toEqual([{ method: 'POST', path: '/webhooks' }]);
  });

  it('parses JSON OpenAPI documents directly', () => {
    const doc = JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/veiculos': { get: {}, post: {} },
      },
    });
    expect(parseOpenApiOperations(doc)).toEqual([
      { method: 'GET', path: '/veiculos' },
      { method: 'POST', path: '/veiculos' },
    ]);
  });

  it('returns an empty list for text with no paths: block, never throws', () => {
    expect(parseOpenApiOperations('')).toEqual([]);
    expect(parseOpenApiOperations('openapi: 3.1.0\ninfo:\n  title: X\n')).toEqual([]);
    expect(parseOpenApiOperations(undefined)).toEqual([]);
  });

  it('matches the real OficinaAI openapi.yaml shape: 21 operations, no duplicates', () => {
    // A representative excerpt mirroring the actual run's file structure
    // (2-space path indent, 4-space method indent, deep response schemas).
    const text = `paths:
  /platform/tenants:
    post:
      responses:
        '201': { description: Created }
  /public/{subdominio}/servicos-fixos:
    get:
      responses:
        '200': { description: OK }
  /ordens-servico/{id}/vistoria-entrada:
    post:
      responses:
        '200': { description: OK }
  /orcamentos/{id}/itens/{itemId}/aprovacao:
    put:
      responses:
        '200': { description: OK }
components:
  schemas: {}
`;
    const ops = parseOpenApiOperations(text);
    expect(ops).toHaveLength(4);
    expect(new Set(ops.map((op) => normalizeOperationKey(op.method, op.path))).size).toBe(4);
  });
});

describe('normalizeOperationKey', () => {
  it('generalizes path params regardless of the name used', () => {
    expect(normalizeOperationKey('get', '/ordens-servico/{id}')).toBe(
      normalizeOperationKey('GET', '/ordens-servico/{orcamentoId}'),
    );
  });

  it('strips a trailing slash', () => {
    expect(normalizeOperationKey('GET', '/veiculos/')).toBe(normalizeOperationKey('GET', '/veiculos'));
  });
});

describe('parseOperationRef', () => {
  it('parses a well-formed "METHOD /path" ref', () => {
    expect(parseOperationRef('GET /ordens-servico/{id}')).toEqual({ method: 'GET', path: '/ordens-servico/{id}' });
  });

  it('returns null for the scaffold placeholder and malformed refs', () => {
    expect(parseOperationRef('TBD')).toBeNull();
    expect(parseOperationRef('')).toBeNull();
    expect(parseOperationRef(undefined)).toBeNull();
  });
});

describe('validateContractCoverage', () => {
  it('degrades to applicable:false for a non-REST format instead of a silent pass', () => {
    const result = validateContractCoverage({ screens: [] }, '', { format: 'graphql' });
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/CONTRACT_FORMAT_NOT_PARSEABLE/);
  });

  it('reproduces the real OficinaAI defect: a list screen with no matching contract operation is a gap', () => {
    const uiDataMap = {
      screens: [
        { id: 'painel-os-kanban', reads: [{ operation: 'GET /ordens-servico', scope: 'list' }], writes: [] },
        { id: 'painel-clientes', reads: [{ operation: 'GET /clientes', scope: 'list' }], writes: [] },
        {
          id: 'detalhe-os',
          reads: [{ operation: 'GET /ordens-servico/{id}', scope: 'detail' }],
          writes: [{ operation: 'PUT /ordens-servico/{id}' }],
        },
      ],
    };
    const result = validateContractCoverage(uiDataMap, SAMPLE_OPENAPI);
    expect(result.applicable).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.gaps).toEqual([
      { screenId: 'painel-os-kanban', operation: 'GET /ordens-servico', reason: 'NO_MATCHING_CONTRACT_OPERATION' },
      { screenId: 'painel-clientes', operation: 'GET /clientes', reason: 'NO_MATCHING_CONTRACT_OPERATION' },
    ]);
    expect(result.contractOperationCount).toBe(4);
  });

  it('passes when every screen operation matches a contract operation, params generalized', () => {
    const uiDataMap = {
      screens: [
        {
          id: 'detalhe-os',
          reads: [{ operation: 'GET /ordens-servico/{orcamentoId}', scope: 'detail' }],
          writes: [{ operation: 'PUT /ordens-servico/{anyName}' }],
        },
      ],
    };
    const result = validateContractCoverage(uiDataMap, SAMPLE_OPENAPI);
    expect(result.ok).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it('flags an unfilled scaffold ("TBD") as a gap instead of silently skipping it', () => {
    const uiDataMap = { screens: [{ id: 'screen-1', reads: [{ operation: 'TBD', scope: 'list' }], writes: [] }] };
    const result = validateContractCoverage(uiDataMap, SAMPLE_OPENAPI);
    expect(result.ok).toBe(false);
    expect(result.gaps).toEqual([{ screenId: 'screen-1', operation: 'TBD', reason: 'UNPARSEABLE_OPERATION_REF' }]);
  });

  it('is applicable with zero gaps for an empty ui-data-map (backend-only project)', () => {
    const result = validateContractCoverage({ screens: [] }, SAMPLE_OPENAPI);
    expect(result).toMatchObject({ applicable: true, ok: true, screensChecked: 0, operationsChecked: 0, gaps: [] });
  });
});
