import { describe, it, expect } from 'vitest';
import {
  CODEBASE_MEMORY,
  codebaseMemoryExplorationPlan,
  buildSemanticSearchParams,
} from '../scripts/pensador-engine.mjs';

describe('CBM Advanced Exploration & Capabilities', () => {
  describe('CODEBASE_MEMORY tool descriptor completeness', () => {
    it('exposes all 13 standard and advanced tools', () => {
      expect(CODEBASE_MEMORY.tools).toMatchObject({
        indexStatus: 'index_status',
        indexRepository: 'index_repository',
        listProjects: 'list_projects',
        getArchitecture: 'get_architecture',
        getGraphSchema: 'get_graph_schema',
        searchGraph: 'search_graph',
        tracePath: 'trace_path',
        detectChanges: 'detect_changes',
        getCodeSnippet: 'get_code_snippet',
        searchCode: 'search_code',
        manageAdr: 'manage_adr',
        queryGraph: 'query_graph',
        ingestTraces: 'ingest_traces',
      });
    });
  });

  describe('codebaseMemoryExplorationPlan variations', () => {
    it('preserves canonical default sequence without options', () => {
      expect(codebaseMemoryExplorationPlan()).toEqual([
        'index_status',
        'index_repository',
        'get_architecture',
        'get_graph_schema',
        'search_graph',
        'trace_path',
      ]);
    });

    it('inserts manage_adr after get_architecture when includeAdr: true', () => {
      const plan = codebaseMemoryExplorationPlan({ includeAdr: true });
      expect(plan).toEqual([
        'index_status',
        'index_repository',
        'get_architecture',
        'manage_adr',
        'get_graph_schema',
        'search_graph',
        'trace_path',
      ]);
      const archIdx = plan.indexOf('get_architecture');
      const adrIdx = plan.indexOf('manage_adr');
      expect(adrIdx).toBe(archIdx + 1);
    });

    it('appends query_graph after trace_path when includeQueryGraph: true', () => {
      const plan = codebaseMemoryExplorationPlan({ includeQueryGraph: true });
      expect(plan).toEqual([
        'index_status',
        'index_repository',
        'get_architecture',
        'get_graph_schema',
        'search_graph',
        'trace_path',
        'query_graph',
      ]);
    });

    it('combines includeAdr, includeQueryGraph and isFix in canonical order', () => {
      const plan = codebaseMemoryExplorationPlan({
        includeAdr: true,
        includeQueryGraph: true,
        isFix: true,
      });
      expect(plan).toEqual([
        'index_status',
        'index_repository',
        'get_architecture',
        'manage_adr',
        'get_graph_schema',
        'search_graph',
        'trace_path',
        'query_graph',
        'detect_changes',
      ]);
    });

    it('is resilient to null and undefined', () => {
      expect(codebaseMemoryExplorationPlan(null)).toHaveLength(6);
      expect(codebaseMemoryExplorationPlan(undefined)).toHaveLength(6);
      expect(codebaseMemoryExplorationPlan({})).toHaveLength(6);
    });
  });

  describe('buildSemanticSearchParams', () => {
    it('builds parameter payload for single string term', () => {
      const params = buildSemanticSearchParams('autenticacao multi-tenant');
      expect(params).toEqual({
        semantic_query: ['autenticacao multi-tenant'],
      });
    });

    it('builds parameter payload for list of terms and trims whitespaces', () => {
      const params = buildSemanticSearchParams(['  retry  ', 'backoff', '', null, 'exponential']);
      expect(params).toEqual({
        semantic_query: ['retry', 'backoff', 'exponential'],
      });
    });

    it('combines semantic terms with name_pattern, label, and limit', () => {
      const params = buildSemanticSearchParams(['payment', 'checkout'], {
        namePattern: '.*Payment.*',
        label: 'Function',
        limit: 25,
      });
      expect(params).toEqual({
        semantic_query: ['payment', 'checkout'],
        name_pattern: '.*Payment.*',
        label: 'Function',
        limit: 25,
      });
    });

    it('returns empty object when terms are empty and no options provided', () => {
      expect(buildSemanticSearchParams([])).toEqual({});
      expect(buildSemanticSearchParams('')).toEqual({});
      expect(buildSemanticSearchParams(null)).toEqual({});
      expect(buildSemanticSearchParams(undefined)).toEqual({});
    });

    it('supports only options without semantic terms', () => {
      const params = buildSemanticSearchParams(null, {
        namePattern: '.*Handler.*',
        label: 'Class',
      });
      expect(params).toEqual({
        name_pattern: '.*Handler.*',
        label: 'Class',
      });
    });
  });
});
