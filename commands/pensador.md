---
name: pensador
description: Conduz um fluxo de oito estágios de questionamento e pensamento sobre uma demanda — incluindo brainstorms por skill (requirements-clarity, backend-development, ui-ux-pro-max, frontend-design) — produzindo um PRD de alta qualidade com artefatos de apoio (prd.md, userhistory.md e comunication_json.md quando fullstack).
argument-hint: "<demanda em linguagem natural — ex.: 'Crie uma tela de login para os usuários'>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, Skill
---

# /pensador

Inicia o **Pensador** para a demanda descrita em `$ARGUMENTS`. O fluxo cobre **oito estágios de trabalho** mais a entrega final:

1. **PRD_BASE** — Geração do PRD Base a partir da `Skill_PRD_Base`
2. **EXPAND** — Ampliação da demanda com requisitos candidatos (via `AskUserQuestion`)
3. **CLARITY** — Brainstorm de clareza de requisitos com a skill `requirements-clarity` *(sempre)*
4. **BACKEND** — Brainstorm de back-end com a skill `backend-development` *(se há backend)*
5. **UIUX** — Brainstorm de UX com a skill `ui-ux-pro-max` *(se há front-end)*
6. **FRONTEND** — Brainstorm de design de front-end com a skill `frontend-design` *(se há front-end)*
7. **CODEX** — Refinamento técnico com `codex:codex-rescue` (`--effort high`)
8. **AGY** — Lacunas remanescentes com `cc-antigravity-plugin:antigravity-agent` (`--model gemini-3.1-pro-high`)
9. **FINAL** — Geração dos artefatos: `prd.md`, `userhistory.md` e, se fullstack, `comunication_json.md`

As etapas de brainstorm (3–6) usam skills especializadas para reforçar a integridade do PRD; uma etapa de domínio não-aplicável produz zero perguntas e auto-avança.

**Regra central:** todo diálogo com o usuário — demanda ausente, requisitos candidatos, pontos das skills de brainstorm, do Codex, do AGY e decisões de fallback — usa **exclusivamente** a ferramenta `AskUserQuestion`.

---

## Comportamento

### Passo 1 — Preflight

Execute o preflight para verificar a disponibilidade dos subagentes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Parse o JSON retornado e registre o status de cada subagente:

- `status: "ok"` → ambos disponíveis; o fluxo completo de oito estágios pode prosseguir.
- `status: "partial"` → um ou mais subagentes indisponíveis; prossiga e aplique o protocolo de fallback nos estágios afetados (ver `skills/pensador/references/stages.md`).
- `status: "unavailable"` → nenhum subagente disponível; informe ao usuário e aplique fallback nos estágios **CODEX** e **AGY**.

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

### Passo 4 — Iniciar o estágio PRD_BASE

Com a demanda em mãos e o resultado do preflight registrado, inicie o estágio **PRD_BASE** conforme definido em `skills/pensador/SKILL.md`:

- O `scripts/pensador-engine.mjs` é a **especificação determinística de referência** do fluxo (gates, mapeamentos, classificação, artefatos), validada pelos testes — **não** é importado em runtime pela skill. Aplique as regras descritas em prosa na SKILL diretamente. O único script executado por shell é o `preflight.mjs` (Passo 1).
- Aplique o `Strict_PRD_Schema` da `Skill_PRD_Base` (`${CLAUDE_PLUGIN_ROOT}/skills/prd/SKILL.md`) para gerar o `PRD_Base`.
- Prossiga pelos estágios EXPAND, CLARITY, BACKEND, UIUX, FRONTEND, CODEX, AGY e FINAL conforme a skill e os gates de avanço determinarem.

### Passo 5 — Reportar ao usuário

Ao concluir cada estágio, informe brevemente o progresso. Ao concluir o estágio FINAL, informe o caminho de cada artefato gerado:

- `prd.md` — sempre gerado
- `userhistory.md` — sempre gerado
- `comunication_json.md` — gerado apenas quando a demanda resultar em `Projeto_Fullstack`

---

## Arquivos de referência

| Arquivo | Propósito |
|---|---|
| `skills/pensador/SKILL.md` | Skill principal: orquestra os oito estágios + entrega final |
| `skills/prd/SKILL.md` | Skill_PRD_Base: Strict_PRD_Schema, entrevista de descoberta, padrões de qualidade |
| `skills/pensador/references/stages.md` | Definição detalhada de cada estágio e seus gates |
| `skills/pensador/references/skill-stack.md` | Skills de brainstorm (CLARITY/BACKEND/UIUX/FRONTEND): lente, invocação, relevância |
| `skills/pensador/references/agent-stack.md` | Subagentes Codex/AGY, mapeamento `extrahigh → high`, modelo AGY |
| `skills/pensador/references/askuserquestion-protocol.md` | Canal único de diálogo com o usuário |
| `skills/requirements-clarity/SKILL.md` · `skills/backend-development/SKILL.md` · `skills/ui-ux-pro-max/SKILL.md` · `skills/frontend-design/SKILL.md` | Skills de brainstorm empacotadas |
| `scripts/preflight.mjs` | Verifica disponibilidade de Codex e AGY |
| `scripts/pensador-engine.mjs` | Especificação determinística de referência (máquina de estados, gates, mapeamentos, artefatos) — validada por testes, não importada em runtime |

---

## Quando o usuário invocar sem argumento

Se `$ARGUMENTS` estiver vazio, use `AskUserQuestion` para solicitar a demanda (ver Passo 2 acima). Nunca inicie o estágio PRD_BASE sem uma demanda presente e não vazia.
