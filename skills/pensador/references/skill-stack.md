# Skill Stack do Pensador — Referência

Este documento descreve as **quatro skills de brainstorm** que o Pensador consome nos Estágios 3–6 (CLARITY, BACKEND, UIUX, FRONTEND). Cada skill aplica uma lente de domínio sobre o que já foi consolidado, expondo lacunas que reforçam a integridade do PRD.

Para os subagentes Codex (CODEX) e AGY (AGY), veja `references/agent-stack.md`.

---

## Visão geral

| Estágio | Skill (id) | Origin | Relevante quando | Lente |
|---|---|---|---|---|
| CLARITY | `requirements-clarity` | `requirements-clarity` | **sempre** | Clareza e completude de requisitos |
| BACKEND | `backend-development` | `backend-development` | `hasBackend` | Dados, APIs, integrações, segurança |
| UIUX | `ui-ux-pro-max` | `ui-ux-pro-max` | `hasFrontend` | Experiência, fluxos, acessibilidade |
| FRONTEND | `frontend-design` | `frontend-design` | `hasFrontend` | Componentização, design system, layout |

Os identificadores `origin` são os mesmos definidos em `GAP_ORIGINS` no Engine — toda resposta vinda de uma dessas skills entra no consolidado com `resolvesGap = true`.

---

## Origem e instalação

Estas skills são **empacotadas no plugin** sob `skills/<id>/` (versionadas junto com o `cc-pensador`). Foram obtidas de mcp.directory:

```bash
# requirements-clarity (id 2157)
curl -L -o skill.zip "https://mcp.directory/api/skills/download/2157" && unzip -o skill.zip -d skills/requirements-clarity && rm skill.zip
# backend-development (id 1186)
curl -L -o skill.zip "https://mcp.directory/api/skills/download/1186" && unzip -o skill.zip -d skills/backend-development && rm skill.zip
# ui-ux-pro-max (id 191)
curl -L -o skill.zip "https://mcp.directory/api/skills/download/191"  && unzip -o skill.zip -d skills/ui-ux-pro-max && rm skill.zip
# frontend-design (id 1)
curl -L -o skill.zip "https://mcp.directory/api/skills/download/1"    && unzip -o skill.zip -d skills/frontend-design && rm skill.zip
```

> Cada diretório deve conter um `SKILL.md` com frontmatter (`name`, `description`) para ser descoberto pelo Claude Code. Se o zip extrair com um subdiretório, mova o `SKILL.md` para a raiz de `skills/<id>/`.

---

## Protocolo de invocação (comum aos 4 estágios)

1. **Relevância** — para BACKEND/UIUX/FRONTEND, avalie `classifyProject(consolidado)`:
   - `BACKEND` roda quando `hasBackend`; `UIUX`/`FRONTEND` quando `hasFrontend`.
   - CLARITY roda sempre.
   - Não-relevante → **zero perguntas + auto-avanço**. O estágio é visitado, nunca pulado.
2. **Invocação:**
   ```
   Skill(skill="cc-pensador:<id>")
   ```
   Contexto fornecido à skill: a **demanda**, o **PRD_Base** e os **requisitos consolidados** até o estágio. Peça explicitamente: *"identifique lacunas, ambiguidades e decisões em aberto no seu domínio, em forma de perguntas para o usuário."*
3. **Conversão:** cada item retornado vira uma `Question` (`origin = <id>`, `stage = <ID do estágio>`).
4. **Apresentação:** via `AskUserQuestion`. Nunca agrupe perguntas de origens ou estágios diferentes.
5. **Registro:** cada resposta entra no consolidado (`resolvesGap = true`).

### Fallback (skill indisponível)

`AskUserQuestion` individual: *"A skill `<id>` está indisponível. Prosseguir sem este brainstorm, ou aguardar/retentar?"* (`origin = 'pensador'`, `stage = <ID>`). O gate não avança sem resposta.

---

## Detalhe por skill

### CLARITY — `requirements-clarity`
**Sempre relevante.** Primeira lente após a ampliação do Pensador. Foca em transformar requisitos vagos em verificáveis: termos ambíguos ("rápido", "fácil"), requisitos implícitos, escopo dentro/fora, dependências, e critérios de aceite testáveis. As respostas alimentam principalmente **Requisitos Funcionais**, **Critérios de Aceite** e **Casos de Uso** do PRD.

### BACKEND — `backend-development`
**Relevante se há backend.** Foca em: modelo de dados e persistência, endpoints e contratos de API, integrações externas, autenticação/autorização, consistência transacional, escalabilidade, idempotência, observabilidade e tratamento de erros. Alimenta **Arquitetura**, **Requisitos Não-Funcionais** e o **`comunication_json.md`**.

### UIUX — `ui-ux-pro-max`
**Relevante se há front-end.** Foca em: fluxos de UX ponta-a-ponta, estados de tela (vazio, carregando, erro, sucesso), acessibilidade (WCAG), hierarquia visual, navegação, microcopy e feedback. Alimenta **Casos de Uso**, **`userhistory.md`** e a parte de UI da **Arquitetura**.

### FRONTEND — `frontend-design`
**Relevante se há front-end.** Foca em: componentização, design system/tokens, responsividade e breakpoints, layout/grid, padrões de interação e estados de componente. Complementa a UIUX e alimenta **Arquitetura** (stack/estrutura de front) e **Requisitos Funcionais** de interface.

> UIUX e FRONTEND são complementares: UIUX olha *o que/por que* da experiência; FRONTEND olha *como* estruturar e construir a interface. Em projetos de front-end simples, é aceitável que FRONTEND produza poucas ou nenhuma pergunta além das de UIUX.

---

## Leitura relacionada

- `references/stages.md` — gates por estágio e protocolo de fallback.
- `references/agent-stack.md` — Codex (effort) e AGY (modelo).
- `references/askuserquestion-protocol.md` — canal único de diálogo.
- `scripts/pensador-engine.mjs` — `STAGE_DELEGATION`, `GAP_ORIGINS`, `classifyProject`.
