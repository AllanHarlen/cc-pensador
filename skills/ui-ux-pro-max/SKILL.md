---
name: ui-ux-pro-max
description: Lente primária de UX do estágio BRAINSTORM_GERAL do Pensador, atuando com o Open Design. Levanta lacunas de fluxos de experiência, estados de tela (vazio/carregando/erro/sucesso), acessibilidade, navegação, hierarquia visual e microcopy, como perguntas para o usuário. Relevante quando a demanda tem front-end. Alimenta o brief de design do Open Design.
---

# ui-ux-pro-max — Lente Primária de UX

Skill de brainstorm do Pensador (lente **primária de UX** do estágio **BRAINSTORM_GERAL**, relevante quando `hasFrontend`). Junto com `frontend-design`, forma o par de lentes primárias que alimentam o **Open Design** (motor de design); o AGY roda como lente de refinamento (`role: refine`). Aplica uma lente de **experiência do usuário** sobre a demanda, o `PRD_Base` e o consolidado. Alimenta **Casos de Uso**, `userhistory.md`, a seção **Design System & UI/UX** e a parte de UI da **Arquitetura**.

> Conteúdo upstream (mcp.directory id 191) pode enriquecer esta skill. Baixe com:
> `curl -L -o skill.zip "https://mcp.directory/api/skills/download/191" && unzip -o skill.zip -d skills/ui-ux-pro-max && rm skill.zip`
> Mesmo sem o download, o checklist abaixo torna a lente de UX operacional.
> (Há também uma skill `ui-ux-pro-max` no nível do usuário; o Pensador invoca a versão do plugin via `cc-pensador:ui-ux-pro-max`.)

## Relevância

Rode quando houver front-end (tela, interface, web, mobile, app, página). Caso contrário, zero perguntas e auto-avanço.

## Checklist de UX

1. **Fluxos ponta-a-ponta** — caminho feliz e desvios; quantos passos até o objetivo.
2. **Estados de tela** — vazio, carregando, erro, sucesso, parcial/offline. Cada um previsto?
3. **Feedback** — confirmações, validação inline, mensagens de erro acionáveis, estados de progresso.
4. **Navegação** — estrutura de informação, entrada/saída de cada tela, breadcrumb, voltar.
5. **Acessibilidade** — contraste, navegação por teclado, leitores de tela, alvos de toque, WCAG.
6. **Hierarquia visual** — o que é primário/secundário; ações destrutivas sinalizadas.
7. **Microcopy** — rótulos, placeholders, textos de botão e erro claros e consistentes.
8. **Responsividade de experiência** — comportamento em telas pequenas e diferenças mobile/desktop.
9. **Personalização & permissões** — variações de UI por papel/estado de autenticação.
10. **Onboarding & vazio inicial** — primeira experiência e telas sem dados.

## Saída esperada

Perguntas por lacuna de experiência. Quando definir um fluxo, registre os passos para alimentar o `userhistory.md` (interações sequenciais).

## Integração com o Open Design

Quando `hasFrontend = true`, as lacunas de experiência (especialmente estados de tela, acessibilidade, hierarquia visual e microcopy) compõem o **brief de design** que o Pensador parseia e entrega ao **Open Design** (`od`, MCP/CLI) para gerar o artefato `design-system.md` (DESIGN.md de 9 seções). Esta lente define *o que* a experiência exige; o Open Design materializa o *sistema de design* correspondente. Se o Open Design não estiver instalado, o Pensador oferece a instalação via `AskUserQuestion` ou escreve um `design-system.md` inline. Veja `skills/pensador/references/open-design.md`.
