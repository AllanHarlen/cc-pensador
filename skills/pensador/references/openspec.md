# OpenSpec — modo Spec opcional

O Pensador v2 suporta, de forma **opcional**, o **OpenSpec** ([OpenSpec](https://github.com/Fission-AI/OpenSpec)): um framework leve de specs no qual cada mudança vira uma pasta com proposta, specs, design e tarefas, acordadas antes de escrever código.

Quando o OpenSpec é detectado no preflight, o INIT oferece ao usuário a escolha entre gerar um **PRD** (padrão) ou uma **Spec** estruturada. Escolhendo Spec, a fase de `PRD_BASE` passa a **acionar os comandos `openspec-*`** para montar e gerenciar o change set, e todas as etapas seguintes raciocinam sobre a spec em vez do PRD.

> **Importante:** no modo Spec o Pensador **não** escreve os arquivos da mudança manualmente. Ele orquestra os comandos `openspec-*`, que são o backbone de planejamento e rastreamento. O prefixo legado `/opsx:*` está **descontinuado** — use sempre `openspec-*`.

---

## Skills/comandos `openspec-*`

| Comando | Quando usar |
|---|---|
| `/openspec-onboard` | Primeira vez no projeto — guiar configuração inicial |
| `/openspec-explore` | Modo "thinking partner" para investigar antes de criar a mudança |
| `/openspec-new-change <nome>` | Criar diretório vazio da mudança |
| `/openspec-ff-change <nome>` | Fast-forward: criar todos os artefatos de uma vez |
| `/openspec-continue-change <nome>` | Workflow expandido: criar próximo artefato |
| `/openspec-apply-change <nome>` | Implementar a partir do `tasks.md` |
| `/openspec-verify-change <nome>` | Validar implementação |
| `/openspec-sync-specs <nome>` | Sincronizar deltas com specs principais (sem arquivar) |
| `/openspec-archive-change <nome>` | Arquivar mudança concluída |
| `/openspec-bulk-archive-change <nomes...>` | Arquivar várias mudanças em paralelo |

Mapeamento determinístico em `pensador-engine.mjs`: `OPENSPEC`, `openspecChangeName()`, `openspecChangeDir()`, `ARTIFACT_MODES`, `resolveArtifactMode()`, `withArtifactMode()`.

---

## Detecção (preflight)

O `preflight.mjs` reporta, no bloco `integrations.openspec`:

- `available`: verdadeiro quando o binário `openspec` está no PATH **ou** existe um diretório `openspec/` na raiz do projeto (criado por `openspec init`).
- `initialized`: se a pasta `openspec/` está presente.
- `behavior`: a pergunta PRD-vs-Spec que o INIT deve apresentar.

Se o OpenSpec **não** for detectado, o fluxo permanece no modo PRD e a pergunta não é feita.

---

## Escolha PRD vs Spec (INIT)

Quando `integrations.openspec.available = true`, o INIT apresenta uma pergunta via `AskUserQuestion`:

```text
[Pensador | INIT] OpenSpec detectado. Qual artefato base você quer gerar?

Opção A (recomendada quando o time já usa OpenSpec): Spec estruturada (OpenSpec)
Impacto: o PRD_BASE aciona os comandos openspec-* e monta o change set em openspec/changes/<nome>/.

Opção B: PRD
Impacto: fluxo clássico do Pensador; gera prd.md + userhistory.md (+ comunication_json.md se houver back-end) (+ design-system.md se houver front-end).
```

A escolha é registrada em `artifactMode` com `withArtifactMode(state, escolha)` (`'prd'` ou `'spec'`). O `artifactMode` é **ortogonal** ao modo de execução (`--modo`) e às lentes de domínio.

---

## Substituição da fase PRD_BASE (modo Spec)

No modo Spec, o estágio `PRD_BASE` mantém seu id na `STAGE_ORDER`, mas seu comportamento passa a ser **acionar os comandos `openspec-*`**:

1. **Garantir disponibilidade.** Se as skills `openspec-*` não estiverem no ambiente, pergunte via `AskUserQuestion` se deve cair para o modo PRD ou abortar. Não crie estrutura manual, não pule comandos `openspec-*` e não continue como Claude direto.
2. **Criar e montar o change set** (fluxo expandido, recomendado):

   ```text
   /openspec-new-change <nome>
   /openspec-ff-change <nome>     # cria proposal.md, design.md, tasks.md e specs/ de uma vez
   ```

   `<nome>` = `openspecChangeName(featurePath)` (ex.: `login-social-v1`).
3. **Alimentar com contexto:** demanda e `<featurePath>/codebase-memory.md`; o que não for inferível fica como `"TBD"`.

### Fluxos canônicos

Fluxo rápido (a skill recomenda o expandido, mas se quiser rápido):

```text
/openspec-new-change <nome>
# preencher proposal.md
/openspec-apply-change <nome>
/openspec-sync-specs <nome>
/openspec-archive-change <nome>
```

Fluxo expandido (recomendado para mudanças relevantes):

```text
/openspec-new-change <nome>
/openspec-ff-change <nome>
# Pensador conduz: planejamento, review, refinamento
/openspec-verify-change <nome>
/openspec-archive-change <nome>
```

---

## Próximas fases baseadas na spec

`ARCH`, `EXPAND`, `COMPLEXITY`, `BRAINSTORM_GERAL`, `CODEX`, `AGY` e `FINAL` continuam idênticos em estrutura e gates, mas o documento de referência consolidado passa a ser a **spec** (proposal/design/tasks/specs) em vez do PRD:

- O `EXPAND` amplia requisitos da spec.
- O `BRAINSTORM_GERAL`, `CODEX` e `AGY` revisam a spec em busca de lacunas e refinam os artefatos do change set.
- O `FINAL` valida e fecha a spec.

No modo Spec, `userhistory.md` e `comunication_json.md` **não se aplicam** — o entregável é o change set OpenSpec.

**Exceção: o Open Design (design system) continua valendo quando `hasFrontend`.** Diferente dos dois acima, o design não é descartado no modo Spec — ele é **redirecionado** para dentro do change set (`openDesignDeliveryFor` no engine): os arquivos verbatim do system (`tokens.css`, `components.html`, …) vão para `packages/ui/design-systems/<id>/` no repo (igual ao PRD); as **decisões** de design entram na seção *Decisions* do `design.md`; e os **requisitos** de UI viram a capability delta-spec `specs/ui-design-system/spec.md` (requisitos `SHALL` + cenários). Ver `references/open-design.md` › **Modo Spec**.

---

## FINAL e handoff

No `FINAL`, em modo Spec:

1. Finalize os artefatos do change set em `openspec/changes/<nome>/`.
2. Rode `/openspec-verify-change <nome>` — **não pule**; o verify pega referências quebradas em spec.
3. Rode `/openspec-sync-specs <nome>` sempre que a mudança introduzir specs novos ou ajustar specs existentes (move os deltas de `openspec/changes/<nome>/specs/` para `openspec/specs/`).
4. Handoff: oriente os próximos passos com `/openspec-apply-change <nome>` (implementação) e `/openspec-archive-change <nome>` (arquivamento).

> `/openspec-archive-change` **move pastas** — só rode após o usuário confirmar e os artefatos relevantes estarem salvos.

---

## Layout esperado

```text
openspec/
├── specs/                      # specs vigentes do projeto
└── changes/
    └── <nome-da-mudanca>/
        ├── proposal.md         # o que e por quê
        ├── design.md           # como (arquitetura, decisões)
        ├── tasks.md            # quebra em tasks
        └── specs/              # deltas de spec gerados nesta mudança
```

Pode haver várias mudanças em paralelo no repo — cada uma em seu diretório, sem misturar artefatos.

---

## Se o OpenSpec não estiver disponível

Se as skills `openspec-*` não estiverem no ambiente quando o modo Spec for escolhido:

1. Pergunte via `AskUserQuestion` se deve cair para o modo PRD ou abortar.
2. Não crie a estrutura `openspec/` manualmente, não pule os comandos `openspec-*` e não continue como Claude direto.
3. Trabalhar sem OpenSpec acontece no modo PRD padrão, fora do caminho de Spec.

---

## Instalação

Requer Node.js 20.19.0+.

```bash
npm install -g @fission-ai/openspec@latest
cd seu-projeto
openspec init
```

`openspec update` regenera as instruções e slash commands do agente. O `.gitignore` do repositório já ignora `openspec/` e `.openspec/`.

---

## Leitura relacionada

- `references/stages.md`: INIT, EXPLORE e PRD_BASE.
- `references/codebase-memory.md`: a exploração obrigatória precede a montagem de specs.
- `references/askuserquestion-protocol.md`: a pergunta PRD-vs-Spec e o fallback usam `AskUserQuestion`.
