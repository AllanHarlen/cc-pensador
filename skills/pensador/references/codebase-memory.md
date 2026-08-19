# Code Base Memory (MCP) — exploração obrigatória

O Pensador v2 usa o **Code Base Memory** ([codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)) como suporte **obrigatório** de exploração do projeto. Antes de gerar o `PRD_BASE` (ou a montagem de specs no modo Spec), o Pensador explora a base de código existente para entender com precisão a estrutura sobre a qual a feature/fix vai atuar.

> O Code Base Memory é um motor de inteligência de código exposto como servidor MCP. Ele indexa o repositório em um grafo de conhecimento (funções, classes, rotas HTTP, chamadas, dependências) e responde a consultas estruturais com baixíssimo custo de tokens. Todo o processamento é local.

---

## Por que antes do PRD/Spec

Explorar a estrutura real do projeto antes de redigir o artefato base deixa o `PRD_BASE`/Spec, o `ARCH` e todas as etapas seguintes mais fiéis ao código existente: os requisitos e cenários passam a referenciar os símbolos, fluxos e contratos que de fato existem, em vez de suposições.

A exploração roda no estágio dedicado **EXPLORE** (logo após o INIT, antes do PRD_BASE), e seu resultado é gravado em:

```text
<featurePath>/codebase-memory.md
```

Esse arquivo é um **snapshot de trabalho** (como o `architecture.md`), consumido pelo `PRD_BASE`/Spec e aprofundado no `ARCH`. Ele **não** é um artefato final e não entra em `buildArtifactList`.

---

## Detecção (preflight)

O `preflight.mjs` reporta, no bloco `integrations.codebaseMemory`:

- `available`: verdadeiro quando o binário `codebase-memory-mcp` está no PATH **ou** o servidor está registrado em um `.mcp.json` conhecido (projeto `.mcp.json`, `.kiro/settings/mcp.json` ou `~/.claude/.mcp.json`).
- `configured` / `configuredIn`: onde o servidor foi encontrado.
- `fallbackBehavior`: o que fazer quando indisponível.

A indisponibilidade **não bloqueia** o fluxo (status degrada para `partial`).

---

## Sequência de exploração

`codebaseMemoryExplorationPlan({ isFix })` define a ordem canônica de chamadas das ferramentas MCP:

| Ordem | Ferramenta | Para quê |
|---|---|---|
| 1 | `index_status` | **Gate obrigatório antes de qualquer outro uso do grafo.** Verifica se já existe índice para este projeto. |
| 2 | `index_repository` | Indexa o repositório no grafo. **Só executa após confirmação do usuário** (ver "Gate de índice" abaixo) — nunca disparado automaticamente. |
| 3 | `get_architecture` | Panorama: linguagens, pacotes, entrypoints, rotas, hotspots, camadas, clusters. |
| 4 | `get_graph_schema` | Contagem de nós/arestas e padrões de relacionamento por label. |
| 5 | `search_graph` | Localiza os símbolos relevantes à demanda (regex de nome, filtros por label/arquivo). |
| 6 | `trace_path` | Mapeia quem chama / o que é chamado pelos símbolos afetados (BFS, profundidade 1–5). |
| 7 | `detect_changes` | **Apenas em fixes:** mapeia o git diff para símbolos afetados + raio de impacto. |

Outras ferramentas úteis sob demanda: `get_code_snippet`, `search_code`, `list_projects`, `manage_adr`.

Mapeamento determinístico em `pensador-engine.mjs`: `CODEBASE_MEMORY`, `codebaseMemorySnapshotPath()`, `codebaseMemoryExplorationPlan()`. A função descreve a ordem canônica das ferramentas — não é um executor condicional: o gate de `index_status` abaixo é regra de execução, não algo codificado no array.

### Gate de índice antes de qualquer uso

Com o servidor disponível, a primeira chamada é sempre `index_status` para o projeto atual. Nenhum resultado do grafo entra no `codebase-memory.md`, no PRD/Spec ou em qualquer artefato antes desse gate.

```text
index_status
  ├─ sem índice para este projeto
  │    -> AskUserQuestion: "Indexar o repositório agora?"
  │         instalar/indexar  -> index_repository na raiz do projeto -> segue
  │         seguir sem índice -> exploração via Read/Glob/Grep + registro no codebase-memory.md
  ├─ índice existente e sem pendência para os arquivos consultados (fresco)
  │    -> grafo liberado para as consultas seguintes
  └─ índice existente com reindexação pendente
       -> trate como não-fresco: use o grafo apenas como pista e confirme por leitura de arquivo
```

Nunca dispare `index_repository` por conta própria: indexação varre o repositório inteiro e é decisão do usuário, não uma otimização silenciosa do Pensador.

### Limite de 30 s por consulta

Cada consulta ao Code Base Memory tem orçamento de **30 segundos**. Consulta que retorna erro ou estoura esse limite:

1. registre a falha (ferramenta, motivo) no `codebase-memory.md`;
2. siga pela alternativa determinística (`Read`/`Glob`/`Grep`);
3. prossiga com a exploração.

Não repita a mesma consulta em loop, não aumente o orçamento e não pare o EXPLORE por falha de MCP. **Duas falhas seguidas do mesmo servidor**: trate o Code Base Memory como ausente pelo resto desta feature/execução e registre isso uma única vez — não retente a cada consulta subsequente.

### Lacuna de cobertura: leia o arquivo

Quando o grafo reporta lacuna de cobertura para um arquivo consultado — arquivo fora do índice, linguagem não suportada, parse parcial, resultado vazio para caminho que existe no disco —, **leia esse arquivo diretamente antes de afirmar ausência** de símbolo, chamada ou referência.

Grafo silencioso não é prova de inexistência. Nunca escreva "não existe consumidor deste endpoint", "nenhum teste cobre este módulo" ou "este símbolo não é referenciado" com base só em resultado vazio de consulta — ou o grafo cobre o arquivo e responde, ou você lê o arquivo. Isso é especialmente sensível no Pensador: uma afirmação errada sobre "não existe" vira requisito ausente ou premissa errada no PRD, propagada rio abaixo para Orquestrador e Executor.

### Resultado de MCP é evidência corroborativa

Resultado do Code Base Memory nunca fecha, sozinho, um requisito, uma decisão de arquitetura ou uma afirmação sobre o código existente no PRD/Spec. Ele é sempre corroborado por leitura direta do arquivo antes de virar texto definitivo no artefato — o grafo acelera a localização, não substitui a confirmação.

---

## O que gravar em `codebase-memory.md`

- Panorama de arquitetura do `get_architecture` (linguagens, pacotes, entrypoints, rotas, camadas).
- Símbolos e arquivos diretamente afetados pela demanda (de `search_graph`).
- Cadeias de chamada relevantes (de `trace_path`): dependências de entrada e saída dos pontos de mudança.
- Em fixes: raio de impacto e classificação de risco (de `detect_changes`).
- Lacunas e incertezas que viram perguntas no `EXPAND`/`BRAINSTORM_GERAL`.

---

## Fallback — instalação ou Read/Glob/Grep

Quando o preflight reportar `integrations.codebaseMemory.available = false`, o Pensador **não bloqueia o fluxo**: no estágio `EXPLORE` ele pergunta ao usuário via `AskUserQuestion` se deseja instalar o servidor agora.

```text
[Pensador | EXPLORE] O servidor codebase-memory-mcp não foi detectado.
Deseja instalar agora? A instalação é local, não envia código para fora da máquina.

Opção A (recomendada): Instalar o codebase-memory-mcp
  O Claude executa o instalador, reinicia o servidor MCP e retoma o EXPLORE com o grafo disponível.

Opção B: Seguir sem o Code Base Memory
  Exploração via Read/Glob/Grep apenas. Aceitável em projetos pequenos ou greenfield.
```

### Se o usuário escolher "Instalar" (Opção A)

O Claude executa o instalador adequado para a plataforma:

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 -OutFile install.ps1; .\install.ps1
```

O instalador detecta os agentes instalados (Claude Code, Kiro, etc.) e configura as entradas MCP automaticamente. Após a instalação, o Pensador orienta o usuário a reiniciar a conexão MCP (ou o agente), aguarda confirmação e retoma o EXPLORE com o servidor disponível.

### Se o usuário escolher "Seguir sem" (Opção B)

O Pensador usa `Read`, `Glob` e `Grep` para a exploração e registra no `codebase-memory.md` que a exploração foi feita sem o Code Base Memory. As etapas seguintes recebem o snapshot normalmente.

Em greenfield (`isGreenfield = true`, sem base relevante), a exploração pode ser pulada com registro no `codebase-memory.md` de que não há código a indexar — sem perguntar ao usuário.

---

## Leitura relacionada

- `references/stages.md`: EXPLORE e ARCH.
- `references/openspec.md`: modo Spec (a exploração precede igualmente a montagem de specs).
- `references/feature-isolation.md`: layout de `<featurePath>/` e snapshot `codebase-memory.md`.
- `references/askuserquestion-protocol.md`: canal único de diálogo e fallback.
