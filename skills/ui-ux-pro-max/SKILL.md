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

1. **Fluxos ponta-a-ponta e Prototipação no Discovery** — caminho feliz e desvios; selecionar explicitamente de 1 a 3 fluxos críticos que devem virar protótipos interativos HTML standalone de validação (`prototypes/<fluxo>/index.html`).
2. **Estados de tela e Componentes** — vazio, carregando, erro, sucesso, parcial/offline. Definir quais componentes e estados (`default`, `hover`, `focus`, `disabled`) devem constar em `components.html`.
3. **Feedback** — confirmações, validação inline, mensagens de erro acionáveis, estados de progresso.
4. **Navegação** — estrutura de informação, entrada/saída de cada tela, breadcrumb, voltar.
5. **Acessibilidade** — contraste, navegação por teclado, leitores de tela, alvos de toque, WCAG.
6. **Hierarquia visual** — o que é primário/secundário; ações destrutivas sinalizadas.
7. **Microcopy e Brand Assets** — rótulos, placeholders, textos de botão e erro claros e consistentes. Mapear quais assets visuais (logos, banners e imagens do setor) são estritamente necessários para eliminar placeholders.
8. **Responsividade de experiência** — comportamento em telas pequenas e diferenças mobile/desktop.
9. **Personalização & permissões** — variações de UI por papel/estado de autenticação.
10. **Onboarding & vazio inicial** — primeira experiência e telas sem dados.

## Saída esperada

Perguntas por lacuna de experiência. Quando definir um fluxo, registre os passos para alimentar o `userhistory.md` (interações sequenciais) e especifique os candidatos a protótipos do estágio `DESIGN`.

## Integração com o Open Design

Quando `hasFrontend = true`, as lacunas de experiência (especialmente fluxos de validação visual, estados de tela, acessibilidade, hierarquia visual, microcopy e assets de mídia) compõem o **brief de design** que o Pensador parseia e entrega ao **Open Design** (`od`, MCP/CLI). No estágio `DESIGN`, esta lente instrui a geração dos protótipos HTML standalone dos fluxos críticos para aprovação visual pelo usuário (`AskUserQuestion`) e a especificação das fixtures em `components.html` e brand assets em `assets/manifest.json`. Veja `skills/pensador/references/open-design.md`.
