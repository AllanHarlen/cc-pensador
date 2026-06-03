---
name: ui-ux-pro-max
description: Lente de UX para o estágio UIUX do Pensador. Levanta lacunas de fluxos de experiência, estados de tela (vazio/carregando/erro/sucesso), acessibilidade, navegação, hierarquia visual e microcopy, como perguntas para o usuário. Relevante quando a demanda tem front-end.
---

# ui-ux-pro-max — Lente de UX

Skill de brainstorm do Pensador (estágio **UIUX**, relevante quando `hasFrontend`). Aplica uma lente de **experiência do usuário** sobre a demanda, o `PRD_Base` e o consolidado. Alimenta **Casos de Uso**, `userhistory.md` e a parte de UI da **Arquitetura**.

> Conteúdo upstream (mcp.directory id 191) pode enriquecer esta skill. Baixe com:
> `curl -L -o skill.zip "https://mcp.directory/api/skills/download/191" && unzip -o skill.zip -d skills/ui-ux-pro-max && rm skill.zip`
> Mesmo sem o download, o checklist abaixo torna o estágio UIUX operacional.
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
