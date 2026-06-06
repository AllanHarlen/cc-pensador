# Isolamento por Atualizacao

O Pensador v2 isola cada execucao em um diretorio proprio sob `.pensador/`, nomeado pelo slug do nome da atualizacao. Isso evita sobrescrever artefatos de outras atualizacoes e permite retomada por checkpoint.

---

## Layout

```text
.pensador/
  login-social/
    .pensador-progress.json
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
  carrinho-checkout/
    ...
```

O nome do diretorio e o slug do nome da atualizacao ("nome da atualizacao"): minusculas, sem acentos, com qualquer sequencia de caracteres nao alfanumericos colapsada em um unico hifen (ex.: `Login Social` -> `login-social`). Os artefatos finais ficam diretamente na raiz dessa pasta — nao ha mais subpasta `pensador-output/`.

---

## `allocateFeatureDir()`

Responsabilidade: criar o diretorio isolado para a nova atualizacao.

Regras:

1. Derive um slug do nome da atualizacao (veja `slugify()`). Se o nome ficar vazio apos a normalizacao, use o fallback `atualizacao`.
2. Crie:
   - `.pensador/<slug>/`
   - `.pensador/<slug>/shared-agents/`
3. Grave `featurePath = ".pensador/<slug>"` no `StageState`.
4. Todo caminho posterior deve derivar de `featurePath`.

O slug e a identidade da atualizacao; nao ha prefixo numerico `feature-nN`. Caso ja exista uma pasta com o mesmo slug, confirme com o usuario via `AskUserQuestion` antes de reutiliza-la ou sobrescrever artefatos.

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
| `featurePath` | Sim | Ex.: `.pensador/login-social` |
| `demanda` | Sim | Demanda original ou retomada |
| `prdBase` | Apos PRD_BASE | Estrutura do PRD Base |
| `architecturePath` | Apos ARCH | Normalmente `<featurePath>/architecture.md` |
| `complexity` | Apos COMPLEXITY | `Lite` ou `Completo` + sinais |
| `questions` | Conforme fluxo | Perguntas, respostas e diferimentos |
| `consolidated` | FINAL | Consolidado antes dos artefatos |

Grave o checkpoint ao fechar o gate de cada estagio.

---

## Retomada

No INIT:

1. Procure checkpoints v2 em `.pensador/<slug>/.pensador-progress.json`.
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

- `prd.md`: sempre.
- `userhistory.md`: sempre.
- `comunication_json.md`: somente quando ha back-end confirmado.

Antes de sobrescrever qualquer artefato existente, confirme via `AskUserQuestion`.

---

## Nota sobre `.gitignore`

Recomenda-se ignorar saidas locais do Pensador:

```gitignore
.pensador/
pensador-output/
```

`pensador-output/` na raiz permanece na recomendacao apenas para cobrir saidas antigas v1. A regra v2 e sempre gravar sob `<featurePath>/` (ex.: `.pensador/<slug>/`).
