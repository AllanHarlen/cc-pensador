# Modos de Execução do Pensador (`--modo`)

O **modo de execução** define **qual motor executa o trabalho pesado** do fluxo do Pensador — redigir o PRD base, expandir requisitos, sintetizar as análises de brainstorm/Codex/AGY e gerar os artefatos. Ele é **ortogonal** à delegação por estágio (`STAGE_DELEGATION`), onde Codex, AGY e skills atuam como **lentes de domínio**.

Por padrão, o Claude Code faz todo o trabalho e gasta os próprios tokens. Com `--modo agy`, `--modo kiro` ou `--modo codex`, o Claude Code passa a ser um **orquestrador fino**: delega cada unidade de trabalho para a CLI externa via slash command e o custo recai sobre a quota daquele motor. Isso barateia a geração dos artefatos.

> **Invariante inegociável:** independentemente do modo, **todo diálogo com o usuário continua passando exclusivamente por `AskUserQuestion`**. O motor externo nunca conversa com o usuário — ele apenas produz rascunhos/análises que o Pensador relê, consolida e (quando precisa decidir algo) transforma em perguntas via `AskUserQuestion`.

---

## Modos disponíveis

| Modo | Flag | Quem trabalha | Slash command de delegação | Parâmetro padrão |
|---|---|---|---|---|
| Claude | `--modo claude` ou ausente | Claude Code (tokens do Claude) | — | — |
| AGY | `--modo agy` | Antigravity CLI | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` |
| Kiro | `--modo kiro` | Kiro CLI | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` |
| Codex | `--modo codex` | Codex CLI | `/codex:rescue` | `--effort high` |

Sobrescritas: `--model <id>` ajusta o modelo de `agy`/`kiro`; `--effort <nível>` ajusta o esforço de `kiro`/`codex` (`xhigh`/`extrahigh` são normalizados para `high`). A precedência é, por campo: sobrescrita explícita → padrão do modo → nenhum.

Mapeamento determinístico em `pensador-engine.mjs`: `EXECUTION_MODES`, `parseExecutionMode()`, `resolveExecutionMode()` e `buildDelegationInvocation()`.

---

## Parsing do argumento

`parseExecutionMode($ARGUMENTS)` extrai `--modo`, `--model` e `--effort` e devolve o restante como `demanda`.

- Aceita `--modo agy` e `--modo=agy` (valor case-insensitive).
- `--modo` desconhecido → `mode = 'claude'` com `modeValid = false`; avise o usuário via `AskUserQuestion` e siga em `claude` (ou confirme outro modo).
- Ausência de `--modo` → `claude`, `modeValid = true`.

Exemplos:

```text
/pensador --modo agy Crie uma tela de login
  → mode=agy, demanda="Crie uma tela de login"

/pensador Construir API --modo=kiro --model opus
  → mode=kiro, modelOverride=opus, demanda="Construir API"

/pensador --modo codex --effort xhigh Refatorar billing
  → mode=codex, effort normalizado para high, demanda="Refatorar billing"
```

---

## Preflight por modo

O `/pensador` roda o preflight informando o modo escolhido:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs" --modo <modo>
```

O relatório inclui o bloco `executionMode` com `available`, `command`, `defaultParam` e `fallbackBehavior`, além dos subagentes de domínio (`codex`, `agy`).

- Motor disponível → siga delegando.
- Motor indisponível (plugin não encontrado) → pergunte via `AskUserQuestion` se deve **cair para `--modo claude`** (rodar nos tokens do Claude) ou abortar.
- `claude` está sempre disponível (não exige plugin externo).

---

## Contrato de delegação

Quando o modo delega, cada unidade de trabalho do estágio vira uma chamada de slash command construída por `buildDelegationInvocation()`:

```text
/cc-antigravity-plugin:antigravity --model claude-4.6-opus-thinking "<PromptSystem>"
/cc-kiro-plugin:kiro --model claude-opus-4.8 --effort high "<PromptSystem>"
/codex:rescue --effort high "<PromptSystem>"
```

Regras:

1. O **PromptSystem** carrega o contexto necessário do estágio (demanda, PRD Base, `architecture.md`, requisitos consolidados, instruções de saída) e pede um **artefato/rascunho determinístico**, nunca uma conversa com o usuário.
2. O motor grava ou retorna o resultado; o Pensador o relê (use `--output-file`/leitura de arquivo quando o motor suportar, como o Kiro) e o incorpora ao estado e aos arquivos sob `<featurePath>/`.
3. Decisões que exigem o usuário **não** são delegadas: viram perguntas `AskUserQuestion` feitas pelo próprio Pensador.
4. O motor de execução é independente das lentes de domínio: mesmo em `--modo kiro`, os estágios `CODEX` e `AGY` continuam usando `codex:codex-rescue` e `cc-antigravity-plugin:antigravity-agent` como lentes (salvo fallback registrado).

---

## Fallback

Todo fallback de modo passa por `AskUserQuestion`, com opção recomendada:

- **Motor indisponível:** recomendar cair para `--modo claude`; alternativa: abortar e instalar o plugin.
- **Falha em uma unidade de trabalho** (quota/auth/timeout do motor): retentar, cair para `claude` apenas naquela etapa, ou registrar lacunas como `"TBD"`.
- **`--modo` desconhecido:** seguir em `claude` e confirmar.

Preserve o status estruturado quando disponível (`QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `TIMEOUT`, `KIRO_MISSING`) para orientar a mensagem ao usuário.

---

## Instalação dos motores

| Motor | Marketplace | Instalação |
|---|---|---|
| AGY | `cc-antigravity-plugin` | plugin `cc-antigravity-plugin` |
| Kiro | `cc-kiro-plugin` | `/plugin marketplace add AllanHarlen/cc-kiro-plugin` + `/plugin install cc-kiro-plugin` + Kiro CLI autenticada |
| Codex | `openai-codex` | plugin `codex` (oficial OpenAI) |

Os três são declarados como dependências cross-marketplace do `cc-pensador`. Sem o plugin, o modo correspondente cai para `claude` via `AskUserQuestion`.

---

## Leitura relacionada

- `references/agent-stack.md`: Codex/AGY/Kiro e contrato `shared-agents/`.
- `references/stages.md`: comportamento por estágio.
- `references/askuserquestion-protocol.md`: canal único de diálogo e fallback.
- `scripts/pensador-engine.mjs`: `EXECUTION_MODES`, `parseExecutionMode`, `resolveExecutionMode`, `buildDelegationInvocation`.
