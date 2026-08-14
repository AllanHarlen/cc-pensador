---
name: frontend-design
description: Lente primária de design de front-end do estágio BRAINSTORM_GERAL do Pensador, atuando com o Open Design. Levanta lacunas de componentização, design system/tokens, responsividade, layout/grid, padrões de interação e estados de componente, como perguntas para o usuário. Relevante quando a demanda tem front-end. Alimenta o brief de design do Open Design.
---

# frontend-design — Lente Primária de Design de Front-End

Skill de brainstorm do Pensador (lente **primária de design** do estágio **BRAINSTORM_GERAL**, relevante quando `hasFrontend`). Junto com `ui-ux-pro-max`, forma o par de lentes primárias que alimentam o **Open Design**; o AGY (`cc-antigravity-plugin:antigravity-agent`, `gemini-3.1-pro-high`) roda como lente de refinamento (`role: refine`). Complementa a UIUX olhando o **como** construir a interface: estrutura, sistema de design e implementação visual. Alimenta **Arquitetura** (stack/estrutura de front), a seção **Design System & UI/UX** e os **Requisitos Funcionais** de interface. Mapeamento em `STAGE_DELEGATION.BRAINSTORM_GERAL.domains.design.lenses`.

> Conteúdo upstream (mcp.directory id 1) pode enriquecer esta skill. Baixe com:
> `curl -L -o skill.zip "https://mcp.directory/api/skills/download/1" && unzip -o skill.zip -d skills/frontend-design && rm skill.zip`
> Mesmo sem o download, o checklist abaixo torna a lente de design de front-end operacional.

## Relevância

Rode quando houver front-end. Em interfaces simples, é aceitável produzir poucas ou nenhuma pergunta além das de UIUX (auto-avanço).

## Checklist de design de front-end

1. **Componentização** — quais componentes reutilizáveis; granularidade; composição.
2. **Design system / tokens** — cores, tipografia, espaçamento, raios, sombras; tema claro/escuro.
3. **Responsividade** — breakpoints, grid, comportamento de reflow, densidade.
4. **Layout** — estrutura de páginas, regiões fixas (header/sidebar/footer), scroll.
5. **Estados de componente** — default, hover, focus, active, disabled, loading, erro.
6. **Padrões de interação** — modais, drawers, toasts, tabelas, formulários, paginação/scroll infinito.
7. **Stack de front** — framework/lib (se já decidido), gerência de estado, roteamento, build.
8. **Performance de UI** — code splitting, lazy loading, skeletons, otimização de imagens.
9. **Internacionalização** — múltiplos idiomas, formatação, RTL (se aplicável).
10. **Consistência** — aderência a um guia/identidade visual existente.

## Saída esperada

Perguntas por lacuna de design/implementação de interface. Quando definir stack ou estrutura, registre para a seção **Arquitetura** do PRD.

## Integração com o Open Design

Quando `hasFrontend = true`, o checklist acima alimenta o **brief de design** que o Pensador parseia e entrega ao **Open Design** (`od`, MCP/CLI) para gerar o artefato `design-system.md` (DESIGN.md: paleta, tipografia, espaçamento, layout, componentes, motion, voz, anti-padrões). Esta skill define *o que* perguntar; o Open Design materializa *o sistema de design*. Se o Open Design não estiver instalado, o Pensador oferece a instalação via `AskUserQuestion` ou escreve um `design-system.md` inline. Veja `skills/pensador/references/open-design.md`.
