# Open Design (MCP + CLI) — sistema de design para front-end

O Pensador v2 integra o **Open Design** ([nexu-io/open-design](https://github.com/nexu-io/open-design)) como suporte **opcional e condicional a front-end** para fechar a lacuna de design que requisitos puramente funcionais deixam aberta.

> O Open Design é a alternativa open-source e local-first ao Claude Design. Ele entrega como **skills, CLI (`od`) e servidor MCP** consumidos nativamente por agentes de código. Em vez de "antd no tema default + fluxos funcionais" (que rende cara de template administrativo genérico), o Open Design transforma um **brief de design** em um `DESIGN.md` brand-grade: paleta, tipografia, espaçamento, layout, componentes, motion, voz e anti-padrões.

---

## Por que integrar

O diagnóstico recorrente de saídas do Pensador é: o PRD descreve a UI só em termos funcionais (quais telas e fluxos existem) e **zero em termos de design** — sem design system, tokens, paleta, tipografia, estados de componente (vazio/carregando/erro/sucesso), responsividade, acessibilidade, hierarquia visual ou microcopy. Sem essa camada, o agente de front-end não tem alvo visual e entrega um template chapado.

O Open Design fornece o **alvo de design** que faltava. O Pensador faz todo o **parse das informações** (tom visual, marca, referências, paleta, tipografia, estados, responsividade, acessibilidade, microcopy) e alimenta o Open Design para garantir o melhor resultado de acordo com o solicitado, gerando o artefato `design-system.md` (um `DESIGN.md`).

Mapeamento determinístico em `pensador-engine.mjs`: `OPEN_DESIGN`, `designSystemArtifactPath()`, `openDesignBriefPlan()`.

---

## Quando roda

- **BRAINSTORM_GERAL (lente de UI/UX, quando `hasFrontend`):** além das perguntas de produto/UX, o Pensador coleta o **brief de design** via `AskUserQuestion`, cobrindo as dimensões de `openDesignBriefPlan()`:

  | Dimensão | O que parsear |
  |---|---|
  | `visualTone` | Tom visual desejado (ex.: "clean azul/grafite tipo Linear/Vercel", "vibrante") |
  | `brandReferences` | Produtos/sites de referência ou identidade visual existente |
  | `colorPalette` | Cor de marca, neutros e semânticas (sucesso/erro/aviso/info) |
  | `typography` | Famílias, escala e pesos |
  | `componentStates` | default/hover/focus/active/disabled/loading/vazio/erro |
  | `responsiveness` | Breakpoints, grid, densidade |
  | `accessibility` | Contraste, foco visível, leitura de tela, alvo WCAG |
  | `microcopy` | Voz/tom dos textos e mensagens de estado |

- **FINAL (modo PRD, quando `hasFrontend`):** o Pensador aciona o Open Design com o brief consolidado e grava o artefato:

  ```text
  <featurePath>/design-system.md
  ```

  Esse é um **artefato final** (entra em `buildArtifactList` no modo PRD quando `hasFrontend`) e segue o schema de 9 seções do `DESIGN.md`: `color`, `typography`, `spacing`, `layout`, `components`, `motion`, `voice`, `brand`, `anti-patterns`.

No modo Spec (OpenSpec), o `design-system.md` não se aplica — o entregável é o change set OpenSpec.

---

## Detecção (preflight)

O `preflight.mjs` reporta, no bloco `integrations.openDesign`:

- `available`: verdadeiro quando o binário `od` está no PATH **ou** o servidor está registrado em um `.mcp.json` conhecido (projeto `.mcp.json`, `.kiro/settings/mcp.json` ou `~/.claude/.mcp.json`).
- `configured` / `configuredIn`: onde foi encontrado.
- `relevantWhen: "hasFrontend"`: só importa quando a demanda tem front-end.
- `fallbackBehavior`: o que fazer quando indisponível.

Por ser opcional e condicional, a ausência do Open Design **nunca bloqueia** o fluxo e **não altera o `status`** do preflight (igual ao OpenSpec).

---

## Parse e acionamento do Open Design

Com o brief coletado, o Pensador dirige o Open Design (CLI `od` ou ferramentas MCP):

1. `od skill list` / seleção de skill de design (ex.: `web-prototype`, `saas-landing`, `dashboard`).
2. Escolha de um `DESIGN.md` base (entre os 150 sistemas que acompanham o Open Design) ou montagem de um novo a partir do brief.
3. `od plugin apply` / geração para emitir o sistema de design e, quando útil, artefatos de referência (hero, cards, dashboard).
4. `od get-file` / `od get-artifact` para capturar o `DESIGN.md` resultante e consolidá-lo em `<featurePath>/design-system.md`.

O Pensador nunca delega o diálogo: toda decisão de direção visual que precisa do usuário vira pergunta `AskUserQuestion`. O Open Design só produz o material de design que o Pensador relê e consolida.

---

## Fallback — instalação ou DESIGN.md inline

Quando o preflight reportar `integrations.openDesign.available = false` **e** a demanda tiver front-end (`hasFrontend = true`), o Pensador pergunta via `AskUserQuestion`:

```text
[Pensador | BRAINSTORM_GERAL/FINAL] O Open Design não foi detectado.
Ele gera um design system brand-grade (DESIGN.md) para a UI. Deseja instalar agora?
A instalação é local; o agente de design roda na sua máquina.

Opção A (recomendada): Instalar o Open Design
  O Claude executa o instalador, conecta o servidor MCP e retoma com o design system.

Opção B: Seguir sem o Open Design
  O Pensador escreve um design-system.md inline a partir do mesmo schema de 9 seções.
```

### Se o usuário escolher "Instalar" (Opção A)

O Claude executa o instalador para o agente em uso e conecta o MCP:

```bash
curl -fsSL https://open-design.ai/install.sh | sh -s claude
od mcp install claude
```

> Troque `claude` pelo agente em uso (`codex`, `cursor`, `copilot`, `antigravity`, `gemini`, `kiro`, etc.). Depois da instalação, o Pensador orienta o usuário a reconectar o MCP (ou reiniciar o agente), aguarda confirmação e retoma com o Open Design disponível.

### Se o usuário escolher "Seguir sem" (Opção B)

O Pensador escreve `design-system.md` inline, preenchendo as 9 seções do schema `DESIGN.md` a partir do brief coletado, e registra que foi gerado sem o Open Design.

Quando a demanda **não** tem front-end (`hasFrontend = false`), o Open Design não é relevante e nenhuma pergunta é feita.

---

## Leitura relacionada

- `references/stages.md`: BRAINSTORM_GERAL (lente de UI/UX) e FINAL (artefatos).
- `references/skill-stack.md`: skills como lentes de domínio; Open Design como motor de design.
- `references/codebase-memory.md`: padrão de oferta de instalação via `AskUserQuestion`.
- `references/feature-isolation.md` e `references/handoff-contract.md`: artefato `design-system.md` e role `design-system`.
- `skills/prd/SKILL.md`: seção **Design System & UI/UX** do `Strict_PRD_Schema`.
