# Isolamento por Feature

O Pensador v2 isola cada execucao em um diretorio proprio sob `.pensador/`. Isso evita sobrescrever artefatos de outras features e permite retomada por checkpoint.

---

## Layout

```text
.pensador/
  feature-n1/
    .pensador-progress.json
    architecture.md
    shared-agents/
      context-pack.md
      requirements-clarity.response.md
      codex.response.md
      agy.response.md
      agent.response.md
    pensador-output/
      prd.md
      userhistory.md
      comunication_json.md
  feature-n2/
    ...
```

`feature-nN` usa numeracao crescente, com `N` inteiro positivo.

---

## `allocateFeatureDir()`

Responsabilidade: criar o proximo diretorio isolado para uma nova feature.

Regras:

1. Leia `.pensador/`.
2. Identifique diretorios no formato `feature-nN`.
3. Escolha o menor `N` positivo ainda nao usado.
4. Crie:
   - `.pensador/feature-nN/`
   - `.pensador/feature-nN/shared-agents/`
   - `.pensador/feature-nN/pensador-output/`
5. Grave `featurePath = ".pensador/feature-nN"` no `StageState`.
6. Todo caminho posterior deve derivar de `featurePath`.

Nunca grave artefatos finais em `pensador-output/` na raiz no protocolo v2.

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
| `featurePath` | Sim | Ex.: `.pensador/feature-n3` |
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

1. Procure checkpoints v2 em `.pensador/feature-nN/.pensador-progress.json`.
2. Ignore arquivos malformados ou com `checkpointVersion !== 2`.
3. Se houver um checkpoint valido, pergunte via `AskUserQuestion` se deve retomar ou iniciar nova feature.
4. Ao retomar, restaure `featurePath` e continue do `currentStage`.
5. Ao iniciar nova feature, chame `allocateFeatureDir()`.

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

`shared-agents/` e o diretorio de intercambio entre Pensador, skills e subagentes durante `BRAINSTORM_GERAL`.

| Arquivo | Obrigatorio | Escritor | Conteudo |
|---|---|---|---|
| `context-pack.md` | Sim | Pensador | Contexto completo para participantes |
| `requirements-clarity.response.md` | Quando invocado | `requirements-clarity` | Lacunas de clareza e aceite |
| `codex.response.md` | Quando `hasBackend` | Codex | Lacunas tecnicas/backend |
| `agy.response.md` | Quando `hasFrontend` | AGY | Lacunas de produto/frontend |
| `agent.response.md` | Sim | Pensador | Consolidado deduplicado e perguntas candidatas |

`agent.response.md` deve preservar autoria por item e registrar fallback por dominio quando um participante nao responder.

---

## `pensador-output/`

Artefatos finais ficam em:

```text
<featurePath>/pensador-output/
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

`pensador-output/` na raiz permanece na recomendacao para cobrir saidas antigas v1. A regra v2, porem, e sempre gravar sob `<featurePath>/pensador-output/`.
