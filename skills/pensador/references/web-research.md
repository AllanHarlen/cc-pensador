# Pesquisa Web / Benchmark de Mercado (track de negocio do estagio RESEARCH)

O `RESEARCH` e a imagem espelhada do `EXPLORE`: o `EXPLORE` olha para **dentro** (a base de codigo, via Code Base Memory) e o `RESEARCH` olha para **fora** (via `WebSearch`/`WebFetch`).

O estagio tem **dois tracks**, e eles respondem perguntas diferentes:

| Track | Pergunta | Descritor | Snapshot | Referencia |
|---|---|---|---|---|
| `business` | O que essa **categoria de produto** entrega? Concorrentes, table-stakes, vocabulario do setor, precificacao, conformidade. | `WEB_RESEARCH` | `market-research.md` | este documento |
| `technical` | Como essa **stack** e construida **hoje**? Versao atual, estrutura de projeto, padroes de arquitetura/design, convencoes, anti-padroes. | `TECH_RESEARCH` | `tech-research.md` | `references/tech-research.md` |

Os dois rodam no mesmo estagio, gravam snapshots proprios e alimentam o mesmo **Prompt System** (grupos `business` e `technical` em `PROMPT_SYSTEM_SECTION_GROUPS`). Este documento cobre o track de negocio.

Motivo de existir: a demanda que chega ao Pensador quase sempre e uma **categoria de produto que ja tem milhares de implementacoes publicadas** — site comercial de empresa, landing page de prestador de servico, SaaS, CRM, e-commerce, sistema de gestao. O conjunto de funcionalidades basicas dessa categoria e conhecimento publico. Escrever o PRD/Spec sem ler esse baseline significa re-derivar do zero o que o mercado ja resolveu — e entregar um produto sem o obvio.

Descritor deterministico: `WEB_RESEARCH`, `PRODUCT_ARCHETYPES`, `PROMPT_SYSTEM_SECTIONS` e `FEATURE_TIERS` em `scripts/pensador-engine.mjs`.

---

## Posicao no fluxo

```text
INIT → EXPLORE → RESEARCH → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

Roda **antes** do `PRD_BASE` de proposito: o PRD base ja nasce com o baseline de mercado dentro dele, em vez de receber um remendo depois. E roda **depois** do `EXPLORE` porque a base de codigo existente restringe o que faz sentido pesquisar (num brownfield, o benchmark compara com o que ja existe).

---

## As tres perguntas que o estagio responde

1. **Qual e a categoria e o setor?** `detectProductArchetype(demanda)` sugere o arquetipo; `sectorContext` (setor/industria) e coletado do usuario.
2. **O que os concorrentes/referencias realmente entregam?** Inventario de funcionalidades com fonte.
3. **O que e obrigatorio, o que e diferencial e o que e recusado?** Classificacao por `FEATURE_TIERS`.

---

## Passo a passo

### 1. Coletar `sectorContext` primeiro

`sectorContext` e o **primeiro dado** do estagio, nao um detalhe: sem ele a pesquisa retorna generalidades ("melhores praticas de landing page") em vez do que importa ("estrutura de site de oficina automotiva"). Pergunte via `AskUserQuestion` quando nao for inferivel da demanda, com exemplos concretos:

> Qual o setor/ramo do negocio? (ex.: oficina automotiva de carro/moto, clinica odontologica, escritorio de contabilidade, e-commerce de moda)

Esse mesmo valor e reaproveitado depois no brief do Open Design (`openDesignBriefPlan().sectorContext`) e no pipeline de imagery — colete uma vez, use nas duas pontas. Grave em `state.sectorContext`.

### 2. Confirmar o arquetipo do produto

Rode `detectProductArchetype(demanda + sectorContext)`. O retorno (`{ archetype, score, matches }`) e **sugestao**, nunca decisao: apresente via `AskUserQuestion` com a opcao recomendada primeiro e as alternativas plausiveis. Confirmar antes de pesquisar evita gastar o orcamento de busca na categoria errada.

Arquetipos reconhecidos (`PRODUCT_ARCHETYPES`, em ordem de prioridade de desempate):

| id | Categoria |
|---|---|
| `landing-page` | Landing page de conversao (empresa ou prestador de servico) |
| `institutional-site` | Site comercial/institucional de empresa |
| `ecommerce` | E-commerce / loja virtual |
| `marketplace` | Marketplace multi-vendedor |
| `crm` | CRM / pipeline comercial e relacionamento |
| `saas` | SaaS multi-tenant com assinatura |
| `erp` | Sistema de gestao / ERP operacional |
| `booking` | Agendamento/reservas para prestadores de servico |
| `dashboard` | Dashboard/BI analitico |
| `mobile-app` | Aplicativo mobile |
| `api-service` | API/servico para consumo externo |
| `unknown` | Categoria nao identificada (pesquisa guiada pela demanda literal) |

Cada arquetipo traz `baselineFeatures`: o table-stakes da categoria, **conhecido antes de qualquer busca**. A pesquisa web serve para **confirmar e estender** essa lista, nao para descobri-la do zero. Uma feature do baseline que o usuario nao quer vira `anti-feature` documentada — nunca omissao silenciosa.

### 3. Decidir relevancia e profundidade

`researchRelevance({ isInternalOnly, archetype, hasBroadScopeKeywords, isGreenfield })` devolve `{ relevant, depth, reason }`.

- `relevant: false` acontece **apenas** quando a demanda nao tem superficie de produto (refactor interno, correcao de build/CI, bump de dependencia). O estagio ainda e visitado: grava o motivo no snapshot e avanca.
- `depth`: `completo` (8 consultas) para categorias amplas/greenfield/escopo amplo; `lite` (4 consultas) para escopo contido. A profundidade e decidida **aqui**, nao no `COMPLEXITY` (que roda depois), a partir dos sinais da propria demanda.

### 4. Executar o plano de consultas

`marketResearchQueryPlan({ demanda, archetype, sectorContext, region, depth })` devolve a lista ordenada e **truncada ao orcamento**. Estrutura:

| kind | Para que serve |
|---|---|
| `competitor-discovery` | Descobrir quem sao os concorrentes/referencias reais |
| `feature-inventory` | Levantar o conjunto de funcionalidades da categoria |
| `sector-vocabulary` | Capturar o vocabulario do setor (microcopy, entidades, iconografia) |
| `pricing-packaging` | Entender empacotamento/monetizacao praticados |
| `ux-patterns` | Achar dores recorrentes dos concorrentes (fonte dos diferenciais) |
| `compliance` | Restricoes legais/regulatorias do setor (LGPD, conselhos de classe, fiscal) |

Regras de execucao:

- Use `WebSearch` para cada consulta do plano; use `WebFetch` apenas nos resultados que valem leitura profunda (no maximo `budget.maxFetchPerQuery` por consulta).
- Alvo de `budget.minCompetitors` a `budget.maxCompetitors` concorrentes/referencias. Menos de 3 nao e benchmark, e anedota.
- **Nunca** exceda o orcamento. Pesquisa e um estagio do fluxo, nao uma varredura da internet.
- Se a pesquisa web nao estiver disponivel (ferramenta ausente/bloqueada), pergunte via `AskUserQuestion`: (A) o usuario informa os concorrentes/referencias manualmente, ou (B) seguir apenas com os `baselineFeatures` do arquetipo. Registre a escolha e marque `status: SKIPPED` ou `PARTIAL`.

### 5. Qualidade de fonte

`WEB_RESEARCH.sourceTiers`, melhor primeiro:

1. `official` — paginas do proprio produto/concorrente: features, docs, precos.
2. `comparison` — G2, Capterra, TrustRadius, comparativos curados.
3. `community` — blogs, foruns, Reddit, changelogs, release notes.

Uma feature so pode ser registrada como `table-stakes` com corroboracao de pelo menos `minSourcesPerClaim` (2) fontes **independentes**. Um post de blog e opiniao, nao sinal de mercado.

### 6. Conformidade de conteudo (inegociavel)

`WEB_RESEARCH.compliance`:

- `cite-source-url` — todo achado registrado carrega a URL da fonte.
- `max-30-consecutive-words` — nunca reproduza mais de 30 palavras consecutivas de uma fonte.
- `paraphrase-not-quote` — resuma e reescreva preservando o sentido.
- `no-proprietary-assets` — nunca copie logos, imagens, textos de marca ou codigo.
- `no-trademark-imitation` — referencie **padroes** de uma marca, nunca a identidade dela.

O resultado do estagio e uma **analise de mercado**, nao uma copia. Ignorar essas regras transforma benchmark em plagio.

### 7. Classificar as funcionalidades

`classifyFeatureTier({ competitorCoverage, userRequested, userRejected, deferred })`:

| tier | Significado |
|---|---|
| `table-stakes` | Presente na maioria dos concorrentes (`competitorCoverage >= 0.6`). Ausencia e defeito, nao escopo. |
| `differentiator` | Diferencial deliberado: cobertura baixa ou pedido explicito do usuario. |
| `anti-feature` | Comum no mercado e **recusado** aqui. Fica documentado com o motivo. |
| `out-of-scope` | Adiado para depois do MVP. |

Decisao explicita do usuario **sempre** vence o sinal de mercado: `userRejected` → `anti-feature`; `deferred` → `out-of-scope`.

### 8. Perguntar o que a pesquisa nao resolve

Cada funcionalidade `table-stakes` que **nao** estava na demanda original vira pergunta `origin = 'web-research'`, `stage = 'RESEARCH'`, apresentada via `AskUserQuestion` — agrupada, com a recomendacao ("o mercado trata como obrigatorio") e a opcao de recusar (virando `anti-feature`). Essas respostas entram em `REQUIREMENT_STAGES` e sao consolidadas como requisitos no `FINAL`.

Nao repita no `EXPAND` o que ja foi decidido aqui: deduplique.

---

## Saidas

### 1. Snapshot `market-research.md`

Gravado em `<featurePath>/market-research.md` (`marketResearchSnapshotPath()`). E um **arquivo de trabalho**, como `codebase-memory.md` e `architecture.md` — nao entra em `buildArtifactList()`. Conteudo minimo:

- Setor (`sectorContext`) e arquetipo confirmado, com o motivo da classificacao.
- Concorrentes/referencias analisados, com URL.
- Matriz de funcionalidades: feature x concorrente, com cobertura e `tier`.
- Vocabulario do dominio levantado.
- Empacotamento/precificacao observados no mercado.
- Restricoes legais/regulatorias do setor.
- Lacunas: o que a pesquisa nao conseguiu resolver (viram `"TBD"` ou perguntas).
- Lista de fontes com URL.

### 2. Prompt System reaproveitavel

`buildResearchPromptSystem()` empacota o contexto pesquisado nas secoes de `PROMPT_SYSTEM_SECTIONS`, cobrindo os **dois tracks**:

- **Grupo `business`** (este documento): `businessContext` · `productArchetype` · `marketBaseline` · `competitorFeatures` · `differentiators` · `antiFeatures` · `domainVocabulary` · `complianceNotes`
- **Grupo `technical`** (`references/tech-research.md`): `techStack` · `architectureBaseline` · `designPatterns` · `codingConventions` · `securityBaseline` · `testingBaseline` · `technicalAntiPatterns`
- **Compartilhado:** `openQuestions`

Um consumidor injeta so o grupo de que precisa (`PROMPT_SYSTEM_SECTION_GROUPS`): o brief do Open Design nao tem uso para convencoes de ORM, e a lente de back-end nao tem uso para precificacao de concorrente.

Como no `buildPrdBase()`, o engine garante **completude estrutural** (toda secao presente, `"TBD"` quando a pesquisa nao preencheu) e a camada LLM escreve a prosa. `productArchetype`, `marketBaseline`, `businessContext` e `techStack` nunca ficam `"TBD"`: sao derivaveis da demanda, do registro de arquetipos e da stack detectada sem nenhuma busca — mas as **versoes** dentro de `techStack` sao sempre pesquisadas.

Esse bloco e **injetado verbatim** nos consumidores de `WEB_RESEARCH.promptSystemConsumers`:

| Consumidor | Uso |
|---|---|
| `prd-base` | Escopo, requisitos funcionais e personas do PRD base ja nascem com o baseline |
| `expand` | Funcionalidades do inventario viram requisitos candidatos |
| `context-pack` | `shared-agents/context-pack.md` do `BRAINSTORM_GERAL` |
| `delegation` | Em `--modo agy\|kiro\|codex`, prefixa **toda** unidade de trabalho delegada |
| `open-design` | `sectorContext` + `brandReferences` do brief de design |
| `handoff` | Recap final: o benchmark que sustenta as decisoes de escopo |

O ganho e coerencia: toda lente raciocina sobre o **mesmo** contexto de negocio pesquisado, em vez de cada uma re-inferir o dominio a partir da demanda crua.

### 3. Estado

`withMarketResearch(state, research)` grava `state.productArchetype`, `state.sectorContext` e `state.marketResearch` (`status` `DONE` | `PARTIAL` | `SKIPPED`, concorrentes, features, fontes, notas e o `promptSystem`). Persistido no checkpoint v2.

---

## Gate

`market-research.md` gravado (benchmark concluido, `PARTIAL` com lacunas marcadas, ou `SKIPPED` com motivo registrado) **e** todas as perguntas `origin = 'web-research'` respondidas ou diferidas.

---

## Anti-padroes

- **Pular a pesquisa porque "a demanda esta clara".** Demanda clara e escopo completo sao coisas diferentes: o benchmark existe para achar o que o usuario nao pensou em pedir.
- **Pesquisar sem `sectorContext`.** Produz generalidades e desperdica o orcamento de busca.
- **Copiar texto, layout ou assets de concorrente.** Viola `WEB_RESEARCH.compliance` e o Pensador nao produz copia.
- **Registrar feature sem fonte.** Sem URL nao e achado, e suposicao.
- **Transformar o benchmark em backlog automatico.** Toda `table-stakes` nova passa por `AskUserQuestion`; o usuario decide o escopo.
- **Crawl ilimitado.** O orcamento de `WEB_RESEARCH.budget` e teto rigido.
- **Repetir no EXPAND o que o RESEARCH ja decidiu.** Deduplique sempre.

---

## Referencias relacionadas

- `references/tech-research.md` — o track tecnico do mesmo estagio (stack, arquitetura, padroes, convencoes).
- `references/stages.md` — comportamento e gate de cada estagio.
- `references/codebase-memory.md` — a contraparte "para dentro" (`EXPLORE`).
- `references/open-design.md` — brief de design que reaproveita `sectorContext`.
- `references/imagery.md` — pipeline de imagery que depende de `sectorContext`.
- `skills/prd/SKILL.md` — `Strict_PRD_Schema`; o benchmark alimenta as secoes 2, 5, 6 e 16.
