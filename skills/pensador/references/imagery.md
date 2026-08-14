# Imagery & Iconografia — de onde vem e quem gera

## O problema que isto corrige

Uma entrega real do pipeline Pensador → Orquestrador (SaaS de oficina automotiva) chegou ao navegador com **0 `<img>`, 0 `background-image`, 0 tooltips** e apenas 3 regras `:hover` em toda a aplicação — apesar do design system selecionado (Open Design) já especificar tratamento de imagem, hero cinematográfico e estados de hover no `components.html`. A causa raiz: nenhum estágio do processo *pede* imagery/iconografia como entregável, e o mecanismo de geração de imagem que já existe (`cc-antigravity-plugin`, `--generate-image`, modelo Nano Banana) nunca é acionado nesse fluxo.

Este documento fecha essa lacuna descrevendo o pipeline ponta a ponta: o que o Pensador coleta, o que ele grava, e como o Orquestrador aciona a geração.

---

## Papel do Pensador: coletar `sectorContext` e persistir onde o Orquestrador o encontre

O Pensador **não gera nem baixa imagens de produto**. O papel dele é garantir que a informação necessária para o Orquestrador (e o `antigravity-coder`) tomarem boas decisões de imagery chegue ao PRD/`design-system.md`:

- A dimensão `sectorContext` de `openDesignBriefPlan()` (ver `references/open-design.md`) captura o setor/indústria do negócio (ex.: "oficina automotiva de carro/moto", "clínica odontológica", "e-commerce de moda").
- No FINAL, `sectorContext` é registrado na seção **Brand** do `design-system.md` (schema de 9 seções: `color`/`typography`/`spacing`/`layout`/`components`/`motion`/`voice`/`brand`/`anti-patterns`) — é o slot correto porque orienta identidade de marca e vocabulário do domínio, não é um token visual.
- No modo PRD, a seção **8. Design System & UI/UX** do `prd.md` referencia essa informação (via `design-system.md`); no modo Spec, ela entra na seção *Decisions* de `design.md`.

Sem isso, o front-end sabe *como* estilizar (tokens, componentes) mas não sabe *o que* fotografar/ilustrar — resultado: zero imagery, ou pior, imagery genérica desconectada do produto real.

---

## Papel do Orquestrador: acionar `IMAGE_SUGGESTIONS` do `antigravity-coder`

O `cc-antigravity-plugin` já expõe um mecanismo nativo de geração de imagem (`--generate-image`, modelo Nano Banana) e o agente `antigravity-coder` já é instruído a **proativamente sugerir** oportunidades de imagery ao implementar UI (hero, banners, ilustrações de estado vazio/erro, ícones de produto/serviço) — ver `agents/antigravity-coder.md` no `cc-antigravity-plugin`. O gap não era técnico, era de **orquestração**: o Orquestrador nunca instruía a task front-end a devolver esse bloco, nem tratava a resposta.

Isso é responsabilidade do `cc-orchestrador-subagents` (ver `references/workflow.md` e `references/subagent-prompts.md` desse plugin, seção "Imagery/icones (`IMAGE_SUGGESTIONS`)"):

1. Todo prompt de task front-end carrega `sectorContext` (vindo do PRD/`design-system.md` que o Pensador produziu).
2. O `antigravity-coder` devolve um bloco `IMAGE_SUGGESTIONS` quando identifica oportunidades — **nunca gera sem aprovação prévia**.
3. O Orquestrador apresenta as opções ao usuário via `AskUserQuestion` (multiSelect).
4. Apenas as aprovadas são geradas (`--generate-image --output-dir <dir>`) e fiadas nos componentes antes de a task ser fechada.

---

## Por que a divisão de responsabilidade é assim

- O Pensador não tem acesso a um ambiente de implementação (não roda o bridge AGY, não edita a árvore de código real) — ele só produz artefatos de planejamento.
- O Orquestrador é quem já delega para `antigravity-coder` (que tem o bridge nativo) e é quem já possui o padrão `AskUserQuestion` para decisões visuais que dependem do usuário (ex.: seleção de design system, seleção de imagery).
- Gerar imagem sem contexto de setor é o mesmo erro que gerou "vibe genérica de luxo automotivo" sem nenhuma peça/veículo real — por isso `sectorContext` é pré-requisito, não afterthought.

## Leitura relacionada

- `references/open-design.md` — brief de design completo, incluindo `sectorContext`.
- `skills/frontend-design/SKILL.md`, `skills/ui-ux-pro-max/SKILL.md` — lentes que alimentam o brief.
- No `cc-orchestrador-subagents`: `references/workflow.md` (seção "Imagery/icones"), `references/subagent-prompts.md` (seção 2a).
