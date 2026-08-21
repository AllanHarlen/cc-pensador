# OpenSpec — modo Spec opcional

O Pensador v2 suporta, de forma **opcional**, o **OpenSpec** ([OpenSpec](https://github.com/Fission-AI/OpenSpec)): um framework leve de specs no qual cada mudança vira uma pasta com proposta, specs, design e tarefas, acordadas antes de escrever código.

Quando o OpenSpec é detectado no preflight (versão ≥ `1.9.0`), o INIT oferece ao usuário a escolha entre gerar um **PRD** (padrão) ou uma **Spec** estruturada. Escolhendo Spec, a fase de `PRD_BASE` passa a **acionar os comandos `/opsx:*`** para montar e gerenciar o change set, e todas as etapas seguintes raciocinam sobre a spec em vez do PRD.

> **Importante:** no modo Spec o Pensador **não** escreve os arquivos da mudança manualmente, e **nunca** move ou cria diretórios `openspec/` à mão (`mkdir`/`mv`) — isso viola o contrato de agente do OpenSpec (`docs/agent-contract.md`). Ele orquestra os comandos `/opsx:*` do **perfil core** — o perfil instalado por padrão por `openspec init` desde a versão 1.4 — e, quando um comando de CLI é mais confiável que um slash command (validação, arquivamento), chama o `openspec` diretamente com `--json`.

---

## Perfil core (`/opsx:*`) — o que o Pensador usa sempre

| Comando | Quando usar |
|---|---|
| `/opsx:explore` | Modo "thinking partner" para investigar antes de criar a mudança |
| `/opsx:propose <descrição>` | Criar a mudança e gerar proposal.md + design.md + tasks.md de uma vez |
| `/opsx:apply` | Implementar a partir do `tasks.md` |
| `/opsx:update` | Revisar artefatos de planejamento já existentes sem implementar |
| `/opsx:sync` | Sincronizar deltas de `specs/` com as specs principais do projeto |
| `/opsx:archive` | Arquivar mudança concluída (chama `openspec archive` internamente) |

Mapeamento determinístico em `pensador-engine.mjs`: `OPENSPEC` (com `commands`, `skills`, `cliCalls`, `minVersion`, `profile`), `openspecChangeName()`, `openspecChangeDir()`, `ARTIFACT_MODES`, `resolveArtifactMode()`, `withArtifactMode()`.

### Chamadas de CLI usadas diretamente

Para operações que precisam de um resultado scriptável (não interativo), o Pensador chama o `openspec` diretamente em vez de um slash command:

| Chamada | Uso |
|---|---|
| `openspec doctor --json` | Confirma que a raiz `openspec/` existe e está saudável |
| `openspec list --json` | Lista mudanças ativas |
| `openspec status --change <nome> --json` | Estado de completude dos artefatos da mudança |
| `openspec instructions <artefato> --change <nome> --json` | Instruções enriquecidas antes de escrever um artefato |
| `openspec validate <nome> --strict --json` | Valida a mudança (substitui o antigo `verify-change` do perfil expandido) |
| `openspec archive <nome> --json --yes` | Arquiva a mudança concluída — **nunca** `mv`/`mkdir` manual |

Todas suportam `--json` e seguem o contrato de saída do OpenSpec: exit `0` = sucesso (payload completo), exit `1` = falha (payload "null-shape" + `status[]` de diagnósticos), exit `130` = prompt cancelado pelo usuário (modo interativo apenas — nunca ocorre com `--json`).

### Perfil expandido (opcional, nunca requisito)

Se o usuário rodou `openspec config profile` para o perfil expandido, comandos adicionais ficam disponíveis: `/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`, `/opsx:bulk-archive`, `/opsx:onboard`. O preflight reporta `profile: "expanded"` quando os detecta, mas **o fluxo do Pensador nunca depende deles** — tudo que o expandido oferece, o core + as chamadas de CLI acima já cobrem.

---

## Detecção (preflight)

O `preflight.mjs` reporta, no bloco `integrations.openspec`:

- `version` / `meetsMinimum` / `belowRecommended`: versão do CLI e se atende ao piso (`1.9.0`) e à versão recomendada (`1.10.0`).
- `available`: verdadeiro somente quando `meetsMinimum` é verdadeiro — abaixo do piso, o modo Spec **não é oferecido**, mesmo que o binário exista.
- `initialized` / `doctorOk`: se a raiz `openspec/` existe e está saudável (via `openspec doctor --json`, com fallback estático para `existsSync`).
- `profile`: `"core"` (padrão) ou `"expanded"`, conforme as skills instaladas em `.claude/skills/`.
- `behavior`: a mensagem que o INIT deve apresentar — varia entre "apto e recomendado", "apto mas abaixo do recomendado" e "abaixo do piso, não oferecer".

Se o OpenSpec **não** for detectado, ou estiver abaixo de `1.9.0`, o fluxo permanece no modo PRD e a pergunta não é feita.

---

## Escolha PRD vs Spec (INIT)

Quando `integrations.openspec.available = true`, o INIT apresenta uma pergunta via `AskUserQuestion`:

```text
[Pensador | INIT] OpenSpec detectado. Qual artefato base você quer gerar?

Opção A (recomendada quando o time já usa OpenSpec): Spec estruturada (OpenSpec)
Impacto: o PRD_BASE aciona /opsx:propose e monta o change set em openspec/changes/<nome>/.

Opção B: PRD
Impacto: fluxo clássico do Pensador; gera prd.md + userhistory.md (+ communication.md se houver back-end) (+ design-system.md se houver front-end).
```

A escolha é registrada em `artifactMode` com `withArtifactMode(state, escolha)` (`'prd'` ou `'spec'`). O `artifactMode` é **ortogonal** ao modo de execução (`--modo`) e às lentes de domínio.

---

## Substituição da fase PRD_BASE (modo Spec)

No modo Spec, o estágio `PRD_BASE` mantém seu id na `STAGE_ORDER`, mas seu comportamento passa a ser **acionar `/opsx:propose`**:

1. **Garantir disponibilidade.** Se os comandos `/opsx:*` não estiverem no ambiente, pergunte via `AskUserQuestion` se deve cair para o modo PRD ou abortar. Não crie estrutura manual, não pule comandos `/opsx:*` e não continue como Claude direto.
2. **Criar e montar o change set:**

   ```text
   /opsx:propose <nome ou descrição>
   ```

   `<nome>` = `openspecChangeName(featurePath)` (ex.: `login-social-v1`). `/opsx:propose` cria a mudança e gera `proposal.md`, `design.md` e `tasks.md` num único passo — substitui o que antes exigia dois comandos separados no perfil expandido.
3. **Alimentar com contexto:** demanda e `<featurePath>/codebase-memory.md`; o que não for inferível fica como `"TBD"`.
4. **Mudança sem impacto em specs (`skip_specs`):** quando a demanda é puramente infra/tooling/doc (não altera comportamento observável), marque `state.skipSpecs = true`. O change set sai sem `specs/`, e o arquivamento posterior deve usar `openspec archive <nome> --json --yes --skip-specs`.

### Fluxo canônico

```text
/opsx:propose <nome ou descrição>
# Pensador conduz: planejamento, review, refinamento dos artefatos gerados
openspec validate <nome> --strict --json
/opsx:sync            # apenas se a mudança introduzir/alterar specs
/opsx:apply
openspec archive <nome> --json --yes
```

---

## Próximas fases baseadas na spec

`ARCH`, `EXPAND`, `COMPLEXITY`, `BRAINSTORM_GERAL`, `CODEX`, `AGY` e `FINAL` continuam idênticos em estrutura e gates, mas o documento de referência consolidado passa a ser a **spec** (proposal/design/tasks/specs) em vez do PRD:

- O `EXPAND` amplia requisitos da spec.
- O `BRAINSTORM_GERAL`, `CODEX` e `AGY` revisam a spec em busca de lacunas e refinam os artefatos do change set.
- O `FINAL` valida e fecha a spec.

No modo Spec, `userhistory.md` e `communication.md` **não se aplicam** — o entregável é o change set OpenSpec.

**Exceção: o Open Design (design system) continua valendo quando `hasFrontend`.** Diferente dos dois acima, o design não é descartado no modo Spec — ele é **redirecionado** para dentro do change set. Os arquivos verbatim do system (`tokens.css`, `DESIGN.md`, `components.html`, …) vão para `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`, igual ao PRD; o Executor os materializa em `packages/ui` depois). Como o change set (`openspec/changes/<nome>/`) e os arquivos do design system (`.pensador/<nome>/design-systems/<id>/`) vivem em **árvores diferentes**, existe um contrato explícito que liga um ao outro — ver abaixo.

### Contrato Spec ↔ Open Design (`openDesignSpecContract()`)

`openDesignSpecContract(featurePath, state.designSystems, state.uiPackageDir)` é a fonte da verdade determinística dos caminhos que os arquivos do OpenSpec **DEVEM** referenciar. Sem ele, os arquivos gerados não teriam ponteiro confiável para os tokens reais e o Executor não saberia de onde copiá-los. O contrato entrega, por system escolhido:

| Campo | Papel | Quem referencia |
|---|---|---|
| `verbatimDir` / `tokens` / `designMd` / `components` | **origem** produzida pelo Pensador (raiz da feature, role `design-system-files` do handoff) | seção *Decisions* do `design.md` (registra a origem para o Executor copiar) |
| `materializeInto` / `materializedTokens` | **alvo de runtime** onde o Executor materializa (`packages/ui`/`src/styles`) | requisitos da capability `ui-design-system` (a spec descreve o caminho de consumo do código final) |
| `designDoc` | `openspec/changes/<nome>/design.md` | — |
| `capabilitySpec` | `openspec/changes/<nome>/specs/ui-design-system/spec.md` (caminho canônico de escrita; leitura de specs pré-existentes deve tolerar aninhamento `specs/<área>/<capability>/spec.md`, suportado desde o OpenSpec 1.7) | — |

O Pensador alimenta `/opsx:propose` e os artefatos gerados de modo que:

1. **`design.md` › Decisions** registra o(s) `<id>` escolhido(s), a **origem verbatim** (`verbatimDir`) e o **alvo de materialização** (`materializeInto`) — mais os overrides justificados. Ex.: *"Design system `agentic` (Open Design). Origem: `.pensador/<nome>/design-systems/agentic/`. Materializar em: `packages/ui/design-systems/agentic/`. Override: accent_hue ajustado para a cor de marca (justificativa …)."*
2. **`specs/ui-design-system/spec.md`** vira requisito normativo que cita o `materializedTokens` como fonte de estilo:

   ```markdown
   ## ADDED Requirements

   ### Requirement: Tokens são a fonte de verdade do estilo
   O front-end MUST consumir `packages/ui/design-systems/<id>/tokens.css` como base de
   estilo e NÃO MUST inventar valores de cor/raio/espaçamento fora dos tokens.

   #### Scenario: Cor de marca aplicada
   - **WHEN** um componente precisa da cor primária
   - **THEN** usa a custom property do `tokens.css` (ex.: `var(--color-accent)`), nunca um hex literal
   ```

3. O `proposal.md` lista a capability `ui-design-system` na seção **Capabilities**.

Assim `openspec validate <nome> --strict --json` valida os cenários (exatamente 4 `#`, todo requisito com ≥ 1 cenário) e a referência ao design system fica rastreável do change set até os arquivos verbatim. Ver `references/open-design.md` › **Modo Spec** e `references/handoff-contract.md` (role `design-system-files`).

---

## FINAL e handoff

No `FINAL`, em modo Spec:

1. Finalize os artefatos do change set em `openspec/changes/<nome>/`.
2. Rode `openspec validate <nome> --strict --json` — **não pule**; a validação estrita pega referências quebradas em spec e falha com exit `1` se algo estiver errado.
3. Rode `/opsx:sync` sempre que a mudança introduzir specs novos ou ajustar specs existentes (move os deltas de `openspec/changes/<nome>/specs/` para `openspec/specs/`).
4. Handoff: oriente os próximos passos com `/opsx:apply` (implementação) e `openspec archive <nome> --json --yes` (arquivamento).

> Arquivamento **sempre** via `openspec archive <nome> --json --yes` (com `--skip-specs` quando a mudança não alterou specs). Nunca `mv`/`mkdir` manual — o comando de CLI já atualiza as specs principais e sai com código ≠ 0 em falha, permitindo tratamento programático do erro.

---

## Layout esperado

```text
openspec/
├── config.yaml                  # config da raiz (schema + context/rules/operations opcionais)
├── specs/                       # specs vigentes do projeto (pode ser aninhado: <área>/<capability>/spec.md)
└── changes/
    └── <nome-da-mudanca>/
        ├── .openspec.yaml       # metadados da mudança (schema, goal)
        ├── proposal.md          # o que e por quê
        ├── design.md            # como (arquitetura, decisões)
        ├── tasks.md              # quebra em tasks
        └── specs/                # deltas de spec gerados nesta mudança (OMITIDO quando skip_specs)
```

Pode haver várias mudanças em paralelo no repo — cada uma em seu diretório, sem misturar artefatos.

---

## Se o OpenSpec não estiver disponível ou abaixo do piso de versão

Se os comandos `/opsx:*` não estiverem no ambiente quando o modo Spec for escolhido, ou se `integrations.openspec.meetsMinimum` for falso:

1. Pergunte via `AskUserQuestion` se deve cair para o modo PRD ou abortar.
2. Não crie a estrutura `openspec/` manualmente, não pule os comandos `/opsx:*` e não continue como Claude direto.
3. Trabalhar sem OpenSpec acontece no modo PRD padrão, fora do caminho de Spec.

---

## Instalação

Requer Node.js 20.19.0+.

```bash
npm install -g @fission-ai/openspec@latest
cd seu-projeto
openspec init --tools claude
```

Para gerar artefatos em português diretamente:

```bash
openspec init --tools claude --language "Portuguese (pt-BR)"
```

Palavras-chave normativas (`SHALL`/`MUST`) permanecem em inglês mesmo com `--language` configurado — a validação estrutural do OpenSpec depende delas; apenas a prosa dos artefatos é escrita no idioma configurado.

`openspec update` regenera as instruções e slash commands do agente para a versão instalada do CLI. O `.gitignore` deste repositório ignora `openspec/` (a pasta que o `openspec init` cria num projeto consumidor) — não a árvore `.claude/skills/openspec-*`, que é versionada como parte do plugin.

---

## Leitura relacionada

- `references/stages.md`: INIT, EXPLORE e PRD_BASE.
- `references/codebase-memory.md`: a exploração obrigatória precede a montagem de specs.
- `references/askuserquestion-protocol.md`: a pergunta PRD-vs-Spec e o fallback usam `AskUserQuestion`.
