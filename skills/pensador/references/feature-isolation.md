# Isolamento por Atualizacao

O Pensador v2 isola cada execucao em um diretorio proprio sob `.pensador/`, nomeado pelo slug curto da demanda recebida mais uma versao local (`-vN`). Isso evita sobrescrever artefatos de outras execucoes da mesma demanda e permite retomada por checkpoint.

---

## Layout

```text
.pensador/
  login-social-v1/
    .pensador-progress.json
    codebase-memory.md
    handoff.json
    architecture.md
    shared-agents/
      context-pack.md
      requirements-clarity.response.md
      codex.response.md
      agy.response.md
      agent.response.md
    prd.md
    userhistory.md
    comunication_json.md
  carrinho-checkout-v1/
    ...
```

O nome do diretorio e o slug curto da demanda recebida ("nome da atualizacao") com sufixo de versao: minusculas, sem acentos, com qualquer sequencia de caracteres nao alfanumericos colapsada em um unico hifen (ex.: `Login Social` -> `login-social-v1`). Os artefatos finais ficam diretamente na raiz dessa pasta. `codebase-memory.md` e o snapshot da exploracao do Code Base Memory feita no estagio EXPLORE. No modo Spec (OpenSpec), o entregavel nao fica em `.pensador/`: e o change set criado pelos comandos `openspec-*` em `openspec/changes/<nome>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`), e `prd.md`/`userhistory.md`/`comunication_json.md` nao se aplicam.

---

## `allocateFeatureDir()`

Responsabilidade: criar o diretorio isolado para a nova atualizacao.

Regras:

1. Derive um slug base do nome da atualizacao/demanda recebida (veja `slugify()`). Se o nome ficar vazio apos a normalizacao, use o fallback `atualizacao`.
2. Escolha a proxima versao local para o mesmo slug base: use `-v1` quando nao houver pasta anterior, ou `-v{max+1}` quando ja existirem pastas como `<slug>-v1`, `<slug>-v2`.
3. Crie:
   - `.pensador/<slug-da-demanda>-vN/`
   - `.pensador/<slug-da-demanda>-vN/shared-agents/`
4. Grave `featurePath = ".pensador/<slug-da-demanda>-vN"` no `StageState`.
5. Todo caminho posterior deve derivar de `featurePath`.

O par `slug + versao` e a identidade da atualizacao; nao ha prefixo numerico `feature-nN`. Caso ja exista uma pasta da mesma versao, confirme com o usuario via `AskUserQuestion` antes de reutiliza-la ou sobrescrever artefatos.

Nunca grave artefatos finais na raiz do projeto no protocolo v2.

---

## Checkpoint

`CHECKPOINT_VERSION = 2`.

Checkpoint v2:

```text
<featurePath>/.pensador-progress.json
```

O `StageState` deve incluir:

| Campo | Obrigatorio | Observacao |
|---|---|---|
| `checkpointVersion` | Sim | Deve ser `2` |
| `currentStage` | Sim | Um dos estagios de `STAGE_ORDER` v2 |
| `featurePath` | Sim | Ex.: `.pensador/login-social-v1` |
| `artifactMode` | Sim | `prd` (padrao) ou `spec` (OpenSpec) |
| `slug` | Sim | Slug base da demanda, sem o sufixo `-vN` (ex.: `login-social`). Usado pelo handoff e pela correlacao entre estagios. |
| `demanda` | Sim | Demanda original ou retomada |
| `codebaseMemoryPath` | Apos EXPLORE | Normalmente `<featurePath>/codebase-memory.md` (ou fallback registrado) |
| `prdBase` | Apos PRD_BASE | Estrutura do PRD Base (ou change set OpenSpec no modo Spec) |
| `architecturePath` | Apos ARCH | Normalmente `<featurePath>/architecture.md` |
| `complexity` | Apos COMPLEXITY | `Lite` ou `Completo` + sinais |
| `questions` | Conforme fluxo | Perguntas, respostas e diferimentos |
| `consolidated` | FINAL | Consolidado antes dos artefatos |

Grave o checkpoint ao fechar o gate de cada estagio.

---

## Retomada

No INIT:

1. Procure checkpoints v2 em `.pensador/<slug-da-demanda>-vN/.pensador-progress.json`.
2. Ignore arquivos malformados ou com `checkpointVersion !== 2`.
3. Se houver um checkpoint valido, pergunte via `AskUserQuestion` se deve retomar ou iniciar nova atualizacao.
4. Ao retomar, restaure `featurePath` e continue do `currentStage`.
5. Ao iniciar nova atualizacao, chame `allocateFeatureDir()`.

Se houver multiplos checkpoints validos, apresente os mais recentes com preview de `featurePath`, `currentStage` e data de modificacao, e recomende retomar o mais recente.

---

## Checkpoint v1 incompativel

O protocolo antigo usava:

```text
pensador-output/.pensador-progress.json
```

Esse checkpoint e v1 e nao e compativel com `CHECKPOINT_VERSION = 2`.

Regras:

- Nao tente converter automaticamente.
- Informe via `AskUserQuestion` que o checkpoint antigo e incompativel.
- Recomende iniciar um novo fluxo v2 isolado.
- Nao apague o checkpoint v1 sem confirmacao explicita do usuario.

---

## Contrato `shared-agents/`

`shared-agents/` e o diretorio de intercambio entre Pensador, skills e subagentes durante `BRAINSTORM_GERAL`. Fica ao lado dos artefatos finais, dentro de `<featurePath>/`.

| Arquivo | Obrigatorio | Escritor | Conteudo |
|---|---|---|---|
| `context-pack.md` | Sim | Pensador | Contexto completo para participantes |
| `requirements-clarity.response.md` | Quando invocado | `requirements-clarity` | Lacunas de clareza e aceite |
| `codex.response.md` | Quando `hasBackend` | Codex | Lacunas tecnicas/backend |
| `agy.response.md` | Quando `hasFrontend` | AGY | Lacunas de produto/frontend |
| `agent.response.md` | Sim | Pensador | Consolidado deduplicado e perguntas candidatas |

`agent.response.md` deve preservar autoria por item e registrar fallback por dominio quando um participante nao responder.

---

## Artefatos finais

Artefatos finais ficam diretamente em:

```text
<featurePath>/
```

Arquivos:

- `prd.md`: modo PRD. No modo Spec, o entregavel e o change set OpenSpec em `openspec/changes/<nome>/` (criado pelos comandos `openspec-*`), fora de `.pensador/`.
- `userhistory.md`: modo PRD (nao se aplica no modo Spec).
- `comunication_json.md`: modo PRD, somente quando ha back-end confirmado (nao se aplica no modo Spec).

Alem dos artefatos finais, `<featurePath>/` contem dois arquivos de trabalho: `codebase-memory.md` (snapshot da exploracao do Code Base Memory, gravado no EXPLORE) e `architecture.md` (gravado no ARCH).
- `prd.md`: sempre.
- `userhistory.md`: sempre.
- `comunication_json.md`: somente quando ha back-end confirmado.
- `handoff.json`: sempre (manifesto de handoff; veja secao abaixo).

Antes de sobrescrever qualquer artefato existente, confirme via `AskUserQuestion`.

---

## Manifesto de handoff `handoff.json`

Ao fechar o estagio FINAL, grave `<featurePath>/handoff.json` seguindo `references/handoff-contract.md` (`HANDOFF_VERSION = 1`). Esse arquivo e a ancora de descoberta que o Orchestrador le antes de planejar.

Regras:

1. `stage: "pensador"`, `upstream: null` (primeiro estagio da cadeia).
2. `slug` = slug base da demanda (sem o sufixo `-vN`); `artifactRoot` = `<featurePath>` (com `-vN`).
3. Liste em `artifacts[]` cada artefato final com `role`, `path` (relativo a `artifactRoot`), `required` e `description`. Roles validos do Pensador: `prd`, `userhistory`, `architecture`, `communication-contract`, `codebase-memory`, `shared-agents`.
4. `status: "DONE"` somente quando todos os gates fecharem; use `PARTIAL`/`BLOCKED` com `summary` explicando, caso contrario.
5. `nextStage`: `{ consumer: "cc-orchestrador-subagents", entrypoint: "/orchestrador", instructions: "Ingerir os artefatos e implementar o plano." }`.

Exemplo minimo:

```json
{
  "handoffVersion": 1,
  "stage": "pensador",
  "slug": "login-social",
  "producer": { "plugin": "cc-pensador", "version": "2.5.1" },
  "artifactRoot": ".pensador/login-social-v1",
  "status": "DONE",
  "createdAt": "2026-06-18T15:40:00.000Z",
  "updatedAt": "2026-06-18T15:40:00.000Z",
  "summary": "PRD, user history e contratos de comunicacao para login social multitenant.",
  "upstream": null,
  "artifacts": [
    { "role": "prd", "path": "prd.md", "required": true, "description": "PRD consolidado" },
    { "role": "userhistory", "path": "userhistory.md", "required": true, "description": "Historias de usuario" },
    { "role": "architecture", "path": "architecture.md", "required": false, "description": "Arquitetura alvo" },
    { "role": "communication-contract", "path": "comunication_json.md", "required": false, "description": "Contratos front-back" }
  ],
  "nextStage": { "consumer": "cc-orchestrador-subagents", "entrypoint": "/orchestrador", "instructions": "Ingerir os artefatos e implementar o plano." }
}
```

---

## Nota sobre `.gitignore`

Recomenda-se ignorar saidas locais do Pensador:

```gitignore
.pensador/
```

A regra v2 e sempre gravar sob `<featurePath>/` (ex.: `.pensador/<slug-da-demanda>-vN/`), nunca em uma pasta de artefatos na raiz do projeto.
