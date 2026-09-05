# cc-pensador

> Plugin de Claude Code que conduz uma demanda em linguagem natural por **doze estágios de trabalho** até um PRD de alta qualidade — com exploração via Code Base Memory, pesquisa web/benchmark de mercado, análise de arquitetura, heurística de complexidade, brainstorm geral por domínio e refinamento por subagentes (Codex e AGY/Gemini). Opcionalmente delega o trabalho pesado a uma CLI externa (Antigravity, Kiro ou Codex) via `--mode`, economizando tokens do Claude.

`versão 2.7.1` · `categoria: planning` · todo diálogo passa **exclusivamente** por `AskUserQuestion`.

## Sumário

- [Visão geral](#visão-geral)
- [Fluxo de estágios](#fluxo-de-estágios)
- [Artefatos gerados](#artefatos-gerados)
- [Isolamento por feature](#isolamento-por-feature)
- [Instalação](#instalação)
- [Uso](#uso)
- [Modos de execução (`--mode`)](#modos-de-execução---mode)
- [Code Base Memory (exploração obrigatória)](#code-base-memory-exploração-obrigatória)
- [Open Design (sistema de design opcional)](#open-design-sistema-de-design-opcional)
- [OpenSpec (modo Spec opcional)](#openspec-modo-spec-opcional)
- [Modos Lite e Completo](#modos-lite-e-completo)
- [Preflight](#preflight)
- [Gates de avanço](#gates-de-avanço)
- [Engine de referência e testes](#engine-de-referência-e-testes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Migração da v1](#migração-da-v1)

## Visão geral

O `cc-pensador` distribui o **Pensador v2**: a skill `pensador` e o comando `/pensador` para o Claude Code. A partir de uma demanda em linguagem natural, o Pensador analisa a arquitetura do projeto, calcula complexidade e orquestra seis lentes de domínio em paralelo (clareza de requisitos, backend, UI/UX, frontend, refinamento técnico e varredura de produto) para produzir um PRD consolidado e de alta fidelidade com artefatos de suporte.

**Invariante central:** todo diálogo entre os agentes e o usuário passa **exclusivamente** pela ferramenta `AskUserQuestion`. Nenhum estágio conversa por outro canal.

Por padrão (`--mode claude`), o Claude Code executa o fluxo com os próprios tokens. Com `--mode agy`, `--mode kiro` ou `--mode codex`, o Claude vira um orquestrador fino e delega o trabalho pesado a uma CLI externa — veja [Modos de execução](#modos-de-execução---mode).

## Fluxo de estágios

```
INIT → EXPLORE → RESEARCH → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

O funil vai de **iniciar/retomar → explorar o código → pesquisar o mercado → PRD base → arquitetura → ampliar → calibrar complexidade → brainstorm por domínio → varredura técnica → varredura de produto → consolidar → entregar.**

| Estágio | O que faz | Delegação | Relevância |
|---|---|---|---|
| **INIT** | Verifica retomada de checkpoint v2, aloca feature dir, obtém demanda, pergunta PRD vs Spec quando OpenSpec é detectado. | — | sempre |
| **EXPLORE** | Explora o projeto com Code Base Memory (`index_repository → get_architecture → search_graph → trace_path`); grava `codebase-memory.md`. Fallback para Read/Glob/Grep se indisponível. | MCP `codebase-memory-mcp` | sempre |
| **RESEARCH** | Olha para fora, em dois tracks. *business*: coleta `sectorContext`, confirma o arquétipo, roda o plano de consultas, levanta e classifica as funcionalidades dos concorrentes → `market-research.md`. *technical*: detecta a stack, fecha suas lacunas, pesquisa versão atual/arquitetura/padrões/convenções → `tech-research.md`. Os dois alimentam o Prompt System. | `WebSearch` · `WebFetch` | exceto demanda sem superfície de produto |
| **PRD_BASE** | Gera PRD base pelo `Strict_PRD_Schema` (ou escala os comandos `openspec-*` para montar o change set no modo Spec). Sem perguntas ao usuário; avanço automático. | skill `prd` / `openspec-*` | sempre |
| **ARCH** | Analisa arquitetura (reaproveita o índice do Code Base Memory + Read/Glob/Grep); roda o top-up da pesquisa técnica quando ficou `DEFERRED`; grava `architecture.md` com o baseline técnico pesquisado. Entrevista greenfield se necessário. | `WebSearch` · `WebFetch` (só no top-up) | sempre |
| **EXPAND** | Amplia demanda com requisitos candidatos (perguntas do Pensador). | — | sempre |
| **COMPLEXITY** | Calcula score por `detectComplexity()`; propõe Lite ou Completo; usuário confirma. | — | sempre |
| **BRAINSTORM_GERAL** | Orquestra lentes de domínio em paralelo: requirements-clarity + Codex se backend + AGY se frontend + brief de design do Open Design se frontend. | skill `requirements-clarity` · `codex:codex-rescue` · AGY · Open Design (`od`) | sempre |
| **CODEX** | Refinamento técnico dedicado com `effort high`. Não participa em atividade específica de front-end (`hasFrontend` sem `hasBackend`). | `codex:codex-rescue` | exceto front-end específico |
| **AGY** | Varredura final de lacunas de produto. | `cc-antigravity-plugin:antigravity-agent` (`gemini-3.1-pro-high`) | sempre |
| **FINAL** | Aplica `withConsolidated`, confirma back-end, gera artefatos, apresenta recap e handoff. | — | sempre |
| **DONE** | Estado terminal. | — | — |

> O BRAINSTORM_GERAL substitui os antigos estágios autônomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND`. Eles agora são lentes de domínio orquestradas em paralelo dentro de um único estágio.

## Artefatos gerados

Todos gravados diretamente sob `.pensador/<slug-da-demanda>-vN/`. Confirma sobrescrita via `AskUserQuestion` se o arquivo já existir.

- `prd.md` — PRD final consolidado, estruturado conforme o Strict PRD Schema. *(modo PRD)*
- `openspec/changes/<name>/` — change set OpenSpec (`proposal.md`, `design.md`, `tasks.md`, `specs/`), montado pelos comandos `openspec-*`. *(modo Spec)*
- `userhistory.md` — Jornada do usuário em passos sequenciais. *(só no modo PRD)*
- `communication.md` — Contrato de comunicação/API em JSON. *(modo PRD, quando houver back-end)*
- `design-system.md` — Sistema de design brand-grade (schema DESIGN.md), escrito inline **apenas como fallback** quando o Open Design não está disponível. Quando o Open Design é usado, o `DESIGN.md` verbatim (em `design-systems/<id>/`) é o documento de design e nenhum arquivo standalone redundante é gerado. *(modo PRD, quando houver front-end)*
- `design-systems/<id>/` — Arquivos verbatim do system Open Design (`tokens.css`, `DESIGN.md`, `components.html`, `preview/`, `system/`, `source/`, …), copiados por `scripts/od-fetch-system.mjs` para dentro da pasta da feature. *(nos dois modos, quando houver front-end e um system selecionado; o Executor os materializa em `packages/ui`/`src/styles` na implementação)*
- `codebase-memory.md` — Snapshot da exploração do Code Base Memory. *(sempre, em `<featurePath>/`)*
- `market-research.md` — Snapshot do track de negócio: setor, arquétipo, concorrentes, matriz de funcionalidades com tiers, exigências legais do setor e fontes. *(sempre, em `<featurePath>/`)*
- `tech-research.md` — Snapshot do track técnico: stack com a **versão atual pesquisada**, estrutura de projeto idiomática, padrões de arquitetura/design com status de adoção, convenções, baseline de segurança e testes, anti-padrões desencorajados e a URL oficial de cada decisão. *(sempre, em `<featurePath>/`)*
- `architecture.md` — Retrato da arquitetura detectada no estágio ARCH, mais o baseline técnico pesquisado. *(sempre, em `<featurePath>/`)*
- `handoff.json` — Manifesto de handoff para o `/cc-orchestrador-subagents:orquestrador` (ancora de descoberta dos artefatos; veja `references/handoff-contract.md`). *(sempre)*

## Isolamento por atualização

Cada execução do Pensador cria (ou retoma) um diretório isolado, nomeado pelo slug curto da demanda recebida com sufixo de versão:

```
.pensador/
└── <slug-da-demanda>-vN/          ← ex.: login-social-v1
    ├── .pensador-progress.json    ← checkpoint v2
    ├── handoff.json               ← manifesto de handoff (descoberta p/ Orchestrador)
    ├── architecture.md
    ├── shared-agents/             ← troca entre subagentes
    │   ├── context-pack.md
    │   ├── requirements-clarity.response.md
    │   ├── codex.response.md
    │   └── agy.response.md
    ├── prd.md                     ← artefatos finais
    ├── userhistory.md
    ├── communication.md
    ├── design-system.md           ← só no fallback (front-end sem Open Design)
    └── design-systems/<id>/       ← arquivos verbatim do Open Design (tokens.css, DESIGN.md, components.html, preview/, …)
```

`<slug>` é o nome curto da demanda recebida normalizado (minúsculas, sem acentos, hifenizado); `-vN` é a versão local da mesma demanda (`v1` na primeira execução, depois `v2`, `v3`, ...). Fallback `atualizacao-v1`. No `INIT`, se houver checkpoint v2 incompleto, o Pensador oferece retomada via `AskUserQuestion`.

## Instalação

### 1 · Instalar o cc-pensador

```text
/plugin marketplace add AllanHarlen/cc-pensador
/plugin install cc-pensador@cc-pensador
/reload-plugins
```

### 2 · Dependências: Codex e AGY

O Pensador delega aos subagentes **Codex** (estágios BRAINSTORM_GERAL e CODEX) e **AGY** (estágios BRAINSTORM_GERAL e AGY) — ambos declarados como dependências do plugin.

**Codex** — plugin oficial:

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

**AGY** — o Pensador espera o `cc-antigravity-plugin` instalado, com estes arquivos presentes:

- `agents/antigravity-agent.md`
- `commands/antigravity.md`
- `scripts/antigravity-bridge.js`

> Se um subagente estiver ausente, o Pensador detecta no [preflight](#preflight) e pergunta (via `AskUserQuestion`) se deve prosseguir sem ele.

### 3 · Opcional: Kiro (para `--mode kiro`)

O modo de execução `--mode kiro` delega o trabalho pesado ao **Kiro CLI** via o plugin `cc-kiro-plugin`:

```text
/plugin marketplace add AllanHarlen/cc-kiro-plugin
/plugin install cc-kiro-plugin
/reload-plugins
```

Instale e autentique a Kiro CLI (`curl -fsSL https://cli.kiro.dev/install | bash` ou, no Windows, `irm 'https://cli.kiro.dev/install.ps1' | iex`; depois `kiro-cli login`). Os modos `--mode agy` e `--mode codex` reaproveitam os plugins `cc-antigravity-plugin` e `openai-codex` já instalados acima.

> Os três plugins (`cc-antigravity-plugin`, `openai-codex`, `cc-kiro-plugin`) são declarados como dependências cross-marketplace. Se o motor do `--mode` escolhido estiver ausente, o Pensador oferece cair para `--mode claude` via `AskUserQuestion`.

## Uso

```text
/pensador [--mode claude|agy|kiro|codex] [--model <id>] [--effort <nível>] <demanda>
```

Subcomandos: `help`, `preflight`, `status`, `resume [slug]`, `config`.

Exemplo:

```text
/pensador Crie uma tela de login para os usuários
/pensador --mode kiro Crie uma tela de login para os usuários
/pensador --mode agy --model claude-4.6-opus-thinking Construir API de pagamentos
/pensador status
```

Se `<demanda>` for omitida, o Pensador a solicita via `AskUserQuestion` antes de iniciar o estágio **PRD_BASE**.

## Modos de execução (`--mode`)

O **modo de execução** define **qual motor executa o trabalho pesado** do fluxo (redigir o PRD base, expandir requisitos, sintetizar análises e gerar artefatos). É **ortogonal** às lentes de domínio (Codex/AGY/skills dentro dos estágios). Por padrão, o Claude Code faz tudo e gasta os próprios tokens; um modo delegado transfere esse custo para a quota da CLI externa, mantendo o Claude apenas como orquestrador.

| Modo | Quem trabalha | Slash command de delegação | Parâmetro padrão |
|---|---|---|---|
| `--mode claude` (padrão) | Claude Code | — | — |
| `--mode agy` | Antigravity CLI | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` |
| `--mode kiro` | Kiro CLI | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` |
| `--mode codex` | Codex CLI | `/codex:rescue` | `--effort high` |

- **Invariante preservada:** em qualquer modo, todo diálogo com o usuário continua passando **exclusivamente** por `AskUserQuestion`. O motor externo só produz rascunhos/análises; o Pensador relê, consolida e transforma decisões em perguntas.
- Sobrescritas: `--model <id>` (agy/kiro) e `--effort <nível>` (kiro/codex; `xhigh`/`extrahigh` → `high`).
- `--mode` desconhecido cai para `claude` com aviso via `AskUserQuestion`.
- O preflight é executado com `--mode <modo>`; se o motor estiver indisponível, o Pensador oferece cair para `--mode claude`.
- `--modo` continua aceito como alias legado silencioso de `--mode`, com comportamento idêntico.

Detalhes completos em `skills/pensador/references/execution-modes.md`. Mapeamento determinístico em `scripts/pensador-engine.mjs` (`EXECUTION_MODES`, `parseExecutionMode`, `resolveExecutionMode`, `buildDelegationInvocation`).

## Code Base Memory (exploração obrigatória)

Antes de redigir o PRD/Spec base, o Pensador explora o projeto existente com o **[Code Base Memory](https://github.com/DeusData/codebase-memory-mcp)** (`codebase-memory-mcp`, um servidor MCP), para que o artefato reflita a estrutura real sobre a qual a feature/fix vai atuar.

- Roda no fim do **INIT** (após alocar o feature dir), com `index_repository → get_architecture → get_graph_schema → search_graph → trace_path` (mais `detect_changes` em fixes). O resumo é gravado em `<featurePath>/codebase-memory.md`.
- O **ARCH** reaproveita o mesmo índice e complementa com Read/Glob/Grep.
- Detectado pelo preflight (CLI no PATH ou entrada de MCP em `.mcp.json`). Indisponível: o Pensador pergunta via `AskUserQuestion` se deve instalar o servidor ou cair para Read/Glob/Grep — nunca bloqueia.

Instalação: `curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash` (ou `install.ps1` no Windows), depois reinicie o agente. Veja `skills/pensador/references/codebase-memory.md`.

## Pesquisa web (estágio RESEARCH, dois tracks)

O `EXPLORE` olha para **dentro** (a base de código). O **RESEARCH** olha para **fora**, em dois tracks que respondem perguntas diferentes:

| Track | Pergunta | Snapshot |
|---|---|---|
| `business` | O que essa **categoria de produto** entrega? | `market-research.md` |
| `technical` | Como essa **stack** é construída **hoje**? | `tech-research.md` |

Os dois rodam no mesmo estágio e alimentam o mesmo Prompt System reaproveitável.

### Track 1 — negócio / mercado

A demanda que chega ao Pensador quase sempre é uma *categoria* que já tem milhares de implementações publicadas — site comercial de empresa, landing page de prestador de serviço, SaaS, CRM, e-commerce, sistema de gestão. Esse conjunto de funcionalidades básicas é conhecimento público: escrever o PRD sem lê-lo significa re-derivar do zero o que o mercado já resolveu.

- Roda logo após o **EXPLORE**, antes do `PRD_BASE`, usando `WebSearch` + `WebFetch`.
- Coleta `sectorContext` (setor/indústria do negócio) **primeiro** e depois confirma o arquétipo sugerido por `detectProductArchetype()` — `landing-page`, `institutional-site`, `ecommerce`, `marketplace`, `crm`, `saas`, `erp`, `booking`, `dashboard`, `mobile-app`, `api-service`. Cada arquétipo já traz um checklist `baselineFeatures` conhecido *antes* de qualquer busca; a pesquisa confirma e estende.
- Executa um plano de consultas com teto (`marketResearchQueryPlan()`: descoberta de concorrentes, inventário de funcionalidades, vocabulário do setor, precificação/empacotamento, reclamações de UX, conformidade do setor) — 4 consultas em profundidade `lite`, 8 em `completo`, de 3 a 5 concorrentes. Nunca uma varredura ilimitada.
- Classifica cada achado com `classifyFeatureTier()` em `table-stakes` / `differentiator` / `anti-feature` / `out-of-scope`. Toda `table-stakes` ausente da demanda original vira pergunta explícita via `AskUserQuestion` (`origin: 'web-research'`) — o escopo é sempre decisão do usuário.
- Grava `<featurePath>/market-research.md`.
- Só é dispensado em demandas sem superfície de produto (refactor interno, correção de build/CI, bump de dependência) — mesmo assim o estágio é visitado e registra o motivo.

Veja `skills/pensador/references/web-research.md`.

### Track 2 — técnico (stack, arquitetura, padrões, convenções)

O conhecimento de um LLM sobre um ecossistema em movimento está congelado no corte de treinamento, e o modo de falha é **silencioso**. Pedindo "tela de login com React + TypeScript e back-end em C#", um modelo pode produzir com total confiança um PRD ancorado em padrões que a documentação oficial já substituiu — estrutura de pastas de um major anterior, a abordagem antiga de busca de dados, JWT feito à mão onde o framework já entrega uma stack de identidade suportada. O PRD vira a especificação de construir o aplicativo de ontem, e todo estágio seguinte implementa fielmente.

Daí a regra: para toda tecnologia sensível a versão, a versão estável atual e a abordagem recomendada atual são **pesquisadas, nunca lembradas**.

- **Detecção de stack** (`detectTechStack`) sobre a demanda *mais* o snapshot do EXPLORE, então em brownfield a stack vem do código em vez de nova pergunta. O casamento é por fronteira de palavra, que é o que torna `C#`, `.NET` e `Go` detectáveis sem os falsos positivos de uma busca por substring ("algo" → Go, "abc#" → C#). `\b` não serve aqui: esses identificadores começam/terminam em caractere não-palavra. ~70 tecnologias entre linguagens, frameworks de front e back, kits de UI, ORMs, bancos, auth, testes e infra — e tecnologia fora do registro ainda é pesquisada com ângulos genéricos, não descartada.
- **Fechar lacunas antes de pesquisar** (`inferStackGaps`). "Back-end com C#" não diz ASP.NET Core; "tela de login" não diz a abordagem de auth. Cada lacuna (`backend-framework-missing`, `auth-approach-missing`, `database-missing`) vira `AskUserQuestion` com candidatos concretos do ecossistema. Adivinhar produziria um PRD sobre uma premissa que você nunca fez.
- **Plano de consultas em três fases** (`techResearchQueryPlan`): (1) uma consulta `version-currency` obrigatória por tecnologia sensível a versão — primeiro, porque toda resposta posterior só tem sentido em relação ao major atual; (2) `stack-patterns` em **round-robin** entre tecnologias, para o orçamento não ser gasto na primeira da lista; (3) cross-cutting `integration-contract` / `auth-flow` / `project-conventions` com **vagas reservadas** — a fronteira front↔back é onde os erros de integração se concentram e nenhuma consulta por tecnologia a revela. O truncamento só consome a fase 2.
- **Tiers de fonte invertidos** em relação ao track de negócio: `official-docs` > `release-notes` > `reputable-guide` > `community`. Para afirmação de mercado o fornecedor é enviesado; para afirmação sobre framework o fornecedor *é* a autoridade. Um padrão só é registrado como atual com respaldo oficial.
- **Gate de adoção** (`classifyPatternAdoption`): `current` (doc oficial + evidência recente) pode virar decisão de PRD; `experimental` só como risco consciente e registrado; `legacy` exige justificativa explícita; `deprecated` vai para a seção de anti-padrões com o substituto documentado. Um tutorial de 2019 pode continuar *correto* sem ser a prática *recomendada* hoje.
- **Diferimento**: quando nenhuma stack é detectável, o track registra `DEFERRED` em vez de pesquisar uma stack que você não escolheu. O **ARCH** a resolve (análise do projeto ou entrevista greenfield) e roda o top-up com as mesmas funções.
- O **registro não guarda número de versão** — fixar "React 19" recriaria exatamente a obsolescência que este track elimina. Guarda só onde a verdade mora (`docsUrl`) e se precisa ser checada (`versionSensitive`).
- Grava `<featurePath>/tech-research.md` e alimenta as seções de engenharia do PRD (§7 RNF, §10 modelo de dados, §11 contratos, §12 segurança, §15 arquitetura), o `architecture.md`, as lentes de back-end/front-end, o CODEX e o handoff.

Veja `skills/pensador/references/tech-research.md`.

### Comum aos dois: o Prompt System reaproveitável

`buildResearchPromptSystem()` empacota os dois tracks em `PROMPT_SYSTEM_SECTIONS`, agrupados por `PROMPT_SYSTEM_SECTION_GROUPS` (`business` / `technical`), e o bloco é injetado verbatim no PRD base, no EXPAND, no `context-pack.md`, em **todo prompt delegado** em `--mode agy|kiro|codex`, no brief do Open Design, no CODEX e no handoff. Cada consumidor injeta apenas o grupo de que precisa — o brief de design não tem uso para convenções de ORM, a lente de back-end não tem uso para precificação de concorrente.

Conformidade de conteúdo é obrigatória nos dois tracks: citar a URL de toda fonte, nunca reproduzir mais de 30 palavras consecutivas, parafrasear e jamais copiar assets/textos/código de terceiros. A saída é análise, não cópia.

Sem acesso à web, o Pensador pergunta por track: você informa concorrentes/versões manualmente, ou o fluxo segue sem eles — deixando explícito no PRD que os padrões não foram verificados.

## OpenSpec (modo Spec opcional)

O Pensador integra opcionalmente o **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** (perfil CORE, ≥ 1.9.0, recomendado 1.10.0). Quando o preflight detecta um CLI OpenSpec compatível, o **INIT** pergunta via `AskUserQuestion` se o usuário quer gerar um **PRD** (padrão) ou uma **Spec** estruturada.

- Escolhendo **Spec**, o estágio `PRD_BASE` passa a escalar **`/opsx:propose`**, que monta o change set (`proposal.md`, `design.md`, `tasks.md`, `specs/`) em `openspec/changes/<name>/` num único passo. O Pensador nunca escreve esses arquivos manualmente. Todas as fases seguintes raciocinam sobre a spec.
- O modo Spec entrega **apenas** o change set OpenSpec — `userhistory.md` e `communication.md` não se aplicam.
- A `STAGE_ORDER` não muda — `PRD_BASE` mantém o id e só seu comportamento/artefatos diferem (`artifactMode` ortogonal).
- O FINAL roda `openspec validate <name> --strict --json` e orienta o handoff para `/opsx:apply` / `/opsx:sync` / `openspec archive <name> --json --yes`.
- Se os comandos `/opsx:*` estiverem indisponíveis quando Spec for escolhido, o Pensador pergunta (via `AskUserQuestion`) se deve cair para o modo PRD ou abortar — não monta a estrutura manualmente, e nunca roda `mkdir`/`mv` manual sobre `openspec/`.

Instalação: `npm install -g @fission-ai/openspec@latest` e depois `openspec init`. Veja `skills/pensador/references/openspec.md`.

## Open Design (sistema de design opcional)

O Pensador integra opcionalmente o **[Open Design](https://github.com/nexu-io/open-design)** (`od`, um servidor MCP + CLI) para fechar a lacuna de design que requisitos puramente funcionais deixam aberta. Sem ele, uma UI com antd no tema default vira template administrativo genérico; com ele, o agente de front-end ganha um alvo visual real.

- Relevante apenas quando a demanda tem **front-end** (`hasFrontend`). No **BRAINSTORM_GERAL**, o Pensador parseia um **brief de design** via `AskUserQuestion` — setor, tom visual, marca/referências, paleta de cores, tipografia, estados de componente, responsividade, acessibilidade (alvo WCAG) e microcopy (9 dimensões).
- No **FINAL**, esse brief seleciona um ou mais systems curados e o Pensador persiste os arquivos **verbatim** em `<featurePath>/design-systems/<id>/` — o próprio `DESIGN.md` do system (paleta, tipografia, espaçamento, layout, componentes, motion, voz, marca, anti-padrões — 9 seções) **é** a decisão de design; não há reescrita em `design-system.md` standalone quando o Open Design é usado.
- Detectado pelo preflight (entrada de MCP registrada; um `od` no PATH que **não** seja o octal-dump do GNU coreutils). Indisponível quando há front-end: o Pensador pergunta via `AskUserQuestion` se deve **instalar agora** (app local-first, sem instalador de uma linha) ou **cair** para um `design-system.md` inline a partir do mesmo schema de 9 seções — nunca bloqueia.

Instalação: o Open Design é um app local-first (daemon + web); não há `curl | sh` de uma linha. O cc-pensador traz um script instalador que automatiza o caminho Docker — `scripts/install-open-design.ps1` (Windows) / `scripts/install-open-design.sh` (macOS/Linux): verifica git+docker, sobe o daemon (`docker compose up -d`, app em http://localhost:7456) e conecta o MCP via `od mcp install <agent>`. O Pensador oferece rodá-lo via `AskUserQuestion` quando a demanda tem front-end. Veja `skills/pensador/references/open-design.md`.

## PRD abrangente e sem truncamento

O `Strict_PRD_Schema` (`skills/prd/SKILL.md`) define **17 seções obrigatórias** para que o PRD detalhe o produto inteiro na profundidade de sistemas modernos: Visão Geral, Problema & Contexto, Objetivos & Métricas, Personas, Escopo, Requisitos Funcionais, Requisitos Não-Funcionais, **Design System & UI/UX**, Casos de Uso & Fluxos, **Modelo de Dados & Domínio**, **Contratos de API & Integrações**, **Segurança/Privacidade & Conformidade (LGPD, papéis, multitenancy)**, **Observabilidade & Operação**, Critérios de Aceite, Arquitetura, **Riscos & Mitigações** e Plano de Entrega. Uma diretriz explícita de anti-truncamento exige que todo gap (regra de negócio ou tecnologia) seja resolvido ou marcado exatamente como `"TBD"` — o PRD nunca é encurtado por brevidade.

## Modos Lite e Completo

No estágio **COMPLEXITY**, o Pensador calcula um score (0–4) com base em quatro sinais:

| Sinal | +1 quando |
|---|---|
| `domainCount > 1` | há mais de um domínio funcional/técnico |
| `hasBackend` | há API, dados, auth, jobs ou servidor |
| `hasBroadScopeKeywords` | termos amplos: plataforma, multiusuário, compliance, pagamentos |
| `isGreenfield` | ARCH não encontrou base existente |

- **Score 0–1 → sugestão Lite:** fluxo enxuto, menos perguntas por domínio.
- **Score ≥ 2 → sugestão Completo:** fluxo integral, todos os domínios.
- O usuário sempre confirma ou altera o modo via `AskUserQuestion`.

## Preflight

O comando `/pensador` executa um preflight antes de iniciar o fluxo, informando o modo de execução escolhido:

```bash
node scripts/preflight.mjs --mode <claude|agy|kiro|codex>
```

Ele inspeciona o cache de plugins do Claude Code para verificar a disponibilidade dos subagentes de domínio (Codex e AGY) e do **motor de execução** do `--mode` (Antigravity, Kiro ou Codex), e emite um JSON com o bloco `executionMode`, o bloco `integrations` (obrigatório `codebaseMemory` + opcional `openspec` + opcional `openDesign`) e o campo `status` (`ok` | `partial` | `unavailable`). O script **sempre sai com código 0**.

## Gates de avanço

O Pensador não avança para o próximo estágio enquanto houver perguntas sem resposta registrada no estágio atual. Um estágio sem perguntas satisfaz o gate e avança imediatamente. Os artefatos finais são gerados somente no estágio **FINAL**.

## Engine de referência e testes

O `scripts/pensador-engine.mjs` é a **especificação determinística de referência** do fluxo: máquina de estados, gates, mapeamentos de effort/modelo, modos de execução (`EXECUTION_MODES`, `parseExecutionMode`, `resolveExecutionMode`, `buildDelegationInvocation`), `detectComplexity`, `allocateFeatureDir`, `buildFeaturePath`, `classifyProject`, `consolidate`/`withConsolidated`, planejamento de artefatos e serialização de checkpoint v2. É um módulo puro — sem I/O, mesmas entradas → mesmas saídas — exercido pela suíte de testes.

> **Importante:** o engine **não é importado em runtime**. A skill é Markdown interpretado pelo LLM. O único script executado por shell é o `preflight.mjs`.

```bash
npm install
npm test       # Vitest — smoke · engine-complexity · feature-isolation · consolidate · artifacts · execution-modes · integrations · web-research · tech-research · docs-consistency
```

## Estrutura do projeto

```
cc-pensador/
├─ .claude-plugin/
│  ├─ plugin.json            # manifesto do plugin (nome, versão, dependências)
│  └─ marketplace.json       # entrada de marketplace
├─ commands/
│  └─ pensador.md            # comando /pensador (orquestra os 12 estágios + --mode)
├─ skills/
│  ├─ pensador/
│  │  ├─ SKILL.md            # skill principal: protocolo v2 + gates + isolamento por feature + modos de execução
│  │  ├─ references/
│  │  │  ├─ stages.md                    # comportamento detalhado de cada estágio
│  │  │  ├─ feature-isolation.md         # .pensador/<slug-da-demanda>-vN/, allocateFeatureDir(), shared-agents/
│  │  │  ├─ agent-stack.md               # Codex/AGY/Kiro, roteamento BRAINSTORM_GERAL, motores de execução
│  │  │  ├─ skill-stack.md               # skills como lentes de domínio
│  │  │  ├─ execution-modes.md           # modos --mode (claude/agy/kiro/codex), parsing, preflight, delegação
│  │  │  ├─ codebase-memory.md           # Code Base Memory (MCP) obrigatório: exploração antes do PRD/Spec
│  │  │  ├─ web-research.md              # RESEARCH track de negócio: arquétipos, plano de consultas, tiers, Prompt System
│  │  │  ├─ tech-research.md             # RESEARCH track técnico: detecção de stack, versão atual, padrões, convenções
│  │  │  ├─ open-design.md               # Open Design (MCP/CLI) opcional: brief de design → design-system.md
│  │  │  ├─ openspec.md                  # OpenSpec opcional: escolha PRD vs Spec no INIT
│  │  │  └─ askuserquestion-protocol.md  # canal único, previews, recap final, handoff
│  │  └─ assets/                         # templates: prd · userhistory · communication
│  ├─ prd/SKILL.md           # Skill_PRD_Base: Strict PRD Schema + entrevista de descoberta
│  ├─ requirements-clarity/SKILL.md
│  ├─ backend-development/SKILL.md
│  ├─ ui-ux-pro-max/SKILL.md
│  └─ frontend-design/SKILL.md
├─ scripts/
│  ├─ preflight.mjs          # verifica disponibilidade de Codex, AGY, Kiro e do motor de execução
│  └─ pensador-engine.mjs    # especificação determinística de referência (validada por testes)
├─ test/
│  ├─ smoke.test.js                # API pública do engine, STAGE_ORDER, checkpoint v2
│  ├─ engine-complexity.test.js    # detectComplexity — unitários + fast-check
│  ├─ feature-isolation.test.js    # allocateFeatureDir, buildFeaturePath
│  ├─ consolidate.test.js          # consolidate, withConsolidated
│  ├─ artifacts.test.js            # isFullstack, planArtifacts, buildArtifactList
│  ├─ execution-modes.test.js      # --mode: parse/resolve/buildDelegationInvocation
│  ├─ integrations.test.js         # Code Base Memory + OpenSpec (modo Spec) + Open Design
│  ├─ web-research.test.js         # RESEARCH track de negócio: arquétipos, consultas, tiers
│  ├─ tech-research.test.js        # RESEARCH track técnico: stack, lacunas, fases do orçamento, adoção
│  └─ docs-consistency.test.js     # STAGE_ORDER verbatim nos docs
├─ CHANGELOG.md              # histórico de versões e breaking changes
└─ LICENSE                   # MIT
```

> **`.gitignore`:** adicione `.pensador/` para não versionar artefatos locais e checkpoints gerados pelo Pensador.

## Migração da v1

| Aspecto | v1 | v2 |
|---|---|---|
| `STAGE_ORDER` | 11 estágios (com CLARITY/BACKEND/UIUX/FRONTEND) | 12 estágios (com EXPLORE/RESEARCH/ARCH/COMPLEXITY/BRAINSTORM_GERAL) |
| `CHECKPOINT_VERSION` | 1 | 2 |
| Pasta de artefatos | pasta raiz legada da v1 | `.pensador/<slug-da-demanda>-vN/` |
| Checkpoints v1 | `pensador-output/.pensador-progress.json` | Incompatíveis — Pensador oferece recomeçar |
| Brainstorm | 4 estágios sequenciais | 1 estágio paralelo por domínio |

> Checkpoints v1 não são convertidos automaticamente. O Pensador detecta a incompatibilidade e oferece iniciar um novo fluxo v2 via `AskUserQuestion`.

## Licença

MIT

---

**For English version, see [README.md](./README.md)**
