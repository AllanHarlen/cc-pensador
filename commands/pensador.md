---
name: pensador
description: Conduz um fluxo de cinco estágios de questionamento e pensamento sobre uma demanda, produzindo um PRD de alta qualidade acompanhado de artefatos de apoio (prd.md, userhistory.md e comunication_json.md quando fullstack).
argument-hint: "<demanda em linguagem natural — ex.: 'Crie uma tela de login para os usuários'>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, Skill
---

# /pensador

Inicia o **Pensador** para a demanda descrita em `$ARGUMENTS`. O fluxo cobre cinco estágios:

1. **Estágio 1** — Geração do PRD Base a partir da `Skill_PRD_Base`
2. **Estágio 2** — Ampliação da demanda com requisitos candidatos (via `AskUserQuestion`)
3. **Estágio 3** — Refinamento técnico com `codex:codex-rescue` (`--effort high`)
4. **Estágio 4** — Levantamento de lacunas remanescentes com `cc-antigravity-plugin:antigravity-agent` (`--model gemini-3.1-pro-high`)
5. **Estágio Final** — Geração dos artefatos: `prd.md`, `userhistory.md` e, se fullstack, `comunication_json.md`

**Regra central:** todo diálogo com o usuário — demanda ausente, requisitos candidatos, pontos do Codex, perguntas do AGY e decisões de fallback — usa **exclusivamente** a ferramenta `AskUserQuestion`.

---

## Comportamento

### Passo 1 — Preflight

Execute o preflight para verificar a disponibilidade dos subagentes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Parse o JSON retornado e registre o status de cada subagente:

- `status: "ok"` → ambos disponíveis; o fluxo completo de 5 estágios pode prosseguir.
- `status: "partial"` → um ou mais subagentes indisponíveis; prossiga e aplique o protocolo de fallback nos estágios afetados (ver `skills/pensador/references/stages.md`).
- `status: "unavailable"` → nenhum subagente disponível; informe ao usuário e aplique fallback nos Estágios 3 e 4.

### Passo 2 — Verificar a demanda

Leia `$ARGUMENTS`:

- **`$ARGUMENTS` não vazio** → use o conteúdo como a demanda inicial e avance para o Passo 3.
- **`$ARGUMENTS` vazio** → solicite a demanda via `AskUserQuestion` antes de qualquer outro passo:
  > "Qual é a demanda? Descreva em linguagem natural o que você quer construir ou resolver."

  Aguarde a resposta do usuário e use-a como demanda para o fluxo.

### Passo 3 — Carregar a skill Pensador

```
Skill(skill="cc-pensador:pensador")
```

A skill está em `${CLAUDE_PLUGIN_ROOT}/skills/pensador/SKILL.md`. Ela define o protocolo completo de cada estágio, os gates de avanço, a delegação ao Codex e ao AGY, e as regras de fallback.

### Passo 4 — Iniciar o Estágio 1

Com a demanda em mãos e o resultado do preflight registrado, inicie o **Estágio 1** conforme definido em `skills/pensador/SKILL.md`:

- Chame o Pensador Engine: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pensador-engine.mjs"` não é invocado diretamente pelo comando — a skill o importa internamente para decisões de gate, mapeamento de effort, modelo AGY e planejamento de artefatos.
- Aplique o `Strict_PRD_Schema` da `Skill_PRD_Base` (`${CLAUDE_PLUGIN_ROOT}/skills/prd/SKILL.md`) para gerar o `PRD_Base`.
- Prossiga pelos estágios 2, 3, 4 e Final conforme a skill e os gates de avanço determinarem.

### Passo 5 — Reportar ao usuário

Ao concluir cada estágio, informe brevemente o progresso. Ao concluir o Estágio Final, informe o caminho de cada artefato gerado:

- `prd.md` — sempre gerado
- `userhistory.md` — sempre gerado
- `comunication_json.md` — gerado apenas quando a demanda resultar em `Projeto_Fullstack`

---

## Arquivos de referência

| Arquivo | Propósito |
|---|---|
| `skills/pensador/SKILL.md` | Skill principal: orquestra os cinco estágios |
| `skills/prd/SKILL.md` | Skill_PRD_Base: Strict_PRD_Schema, entrevista de descoberta, padrões de qualidade |
| `skills/pensador/references/stages.md` | Definição detalhada de cada estágio e seus gates |
| `skills/pensador/references/agent-stack.md` | Subagentes, mapeamento `extrahigh → high`, modelo AGY |
| `skills/pensador/references/askuserquestion-protocol.md` | Canal único de diálogo com o usuário |
| `scripts/preflight.mjs` | Verifica disponibilidade de Codex e AGY |
| `scripts/pensador-engine.mjs` | Lógica determinística: máquina de estados, gates, mapeamentos, artefatos |

---

## Quando o usuário invocar sem argumento

Se `$ARGUMENTS` estiver vazio, use `AskUserQuestion` para solicitar a demanda (ver Passo 2 acima). Nunca inicie o Estágio 1 sem uma demanda presente e não vazia.
