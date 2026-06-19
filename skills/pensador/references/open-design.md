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

- `available`: verdadeiro quando o servidor está registrado em um `.mcp.json` conhecido (projeto `.mcp.json`, `.kiro/settings/mcp.json` ou `~/.claude/.mcp.json`) **ou** quando há um `od` no PATH que **não** seja o `od` (octal-dump) do GNU coreutils.
- `configured` / `configuredIn`: onde foi encontrado.
- `relevantWhen: "hasFrontend"`: só importa quando a demanda tem front-end.
- `fallbackBehavior`: o que fazer quando indisponível.

> ⚠️ **Falso positivo do `od`:** o GNU coreutils instala um binário `od` (octal-dump) em praticamente todo sistema Unix-like, e seu `--version` anuncia "GNU coreutils". Esse **não** é o CLI do Open Design. O `checkOpenDesign()` filtra essa assinatura, então a deteç̧ão confiável é a **entrada MCP registrada**, não a presença de `od` no PATH.

Por ser opcional e condicional, a ausência do Open Design **nunca bloqueia** o fluxo e **não altera o `status`** do preflight (igual ao OpenSpec).

---

## Parse e acionamento do Open Design

> ⚠️ **O Open Design não gera um `DESIGN.md` a partir de um brief em prosa.** Não é isso que o produto faz. Ele **cura ~129 design systems** prontos (DESIGN.md de 9 seções), **importa** systems de fontes reais (GitHub, shadcn, projeto local) e usa esse DESIGN.md como camada de system-prompt para gerar protótipos HTML. Portanto o Pensador não pede ao Open Design para "inventar" um design system; ele **seleciona/importa** o DESIGN.md mais próximo do brief e o **consolida + adapta** em `design-system.md`.

Com o brief coletado, o Pensador dirige o Open Design pelos **verbos reais** do CLI `od` (caminho pnpm/local, que fornece o binário `od`) ou, no caminho Docker, pela **API REST do daemon** (os endpoints que o `od` encapsula):

| Passo | CLI `od` (pnpm/local) | Equivalente Docker (API do daemon) |
|---|---|---|
| 1. Listar os systems curados | `od design-systems list --json` | `GET http://localhost:7456/api/design-systems` |
| 2. (Opcional) Importar de uma marca/repo real citado no brief | `od design-systems import-github <url>` · `od design-systems import-shadcn <ref>` | `POST /api/design-systems/import/github` |
| 3. Casar o brief (tom, marca, paleta, tipografia) com o system mais próximo | escolha do Pensador | escolha do Pensador |
| 4. Puxar o `DESIGN.md` escolhido | `od design-systems show <id> --json` | `GET /api/design-systems/<id>` |
| 5. Consolidar + adaptar em `design-system.md` | reconcilia cores semânticas, estados de componente, microcopy e alvo WCAG do brief | idem |

O MCP do Open Design (`od mcp install <agent>`, depois `od mcp`) é o que conecta o servidor ao agente; ele expõe ferramentas como `list_projects`, `get_file`, `search_files` e `create_artifact`. O instalador deste repo (ver abaixo) tenta conectá-lo automaticamente.

O Pensador nunca delega o diálogo: toda decisão de direção visual que precisa do usuário vira pergunta `AskUserQuestion`. O Open Design só fornece o material de design (o `DESIGN.md`) que o Pensador relê e consolida.

---

## Fallback — instalação (Docker, via script) ou DESIGN.md inline

Quando o preflight reportar `integrations.openDesign.available = false` **e** a demanda tiver front-end (`hasFrontend = true`), o Pensador pergunta via `AskUserQuestion`:

```text
[Pensador | BRAINSTORM_GERAL/FINAL] O Open Design não foi detectado.
Ele fornece um design system brand-grade (DESIGN.md) para a UI. Deseja instalar agora?
A instalação é local e usa Docker; o Open Design roda na sua máquina.

Opção A (recomendada): Instalar o Open Design via Docker
  O Claude executa o script instalador do cc-pensador (verifica git+docker, sobe o
  daemon, conecta o MCP) e retoma usando o Open Design.

Opção B: Seguir sem o Open Design
  O Pensador escreve um design-system.md inline a partir do mesmo schema de 9 seções.
```

### Se o usuário escolher "Instalar" (Opção A)

O Claude executa o **script instalador** que acompanha o cc-pensador. Ele automatiza o caminho Docker do [QUICKSTART oficial](https://github.com/nexu-io/open-design/blob/main/QUICKSTART.md): verifica `git`/`docker`/`docker compose`, clona `nexu-io/open-design`, prepara `deploy/.env` com um `OD_API_TOKEN` gerado, sobe `docker compose up -d`, aguarda o daemon em `http://localhost:7456` e tenta `od mcp install <agent>`.

```powershell
# Windows (PowerShell)
pwsh -File "${CLAUDE_PLUGIN_ROOT}/scripts/install-open-design.ps1"
```

```bash
# macOS / Linux
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-open-design.sh"
```

Parâmetros úteis: `-Agent`/`--agent` (slug do agente, padrão `claude`), `-Port`/`--port` (padrão 7456), `-McpConfig`/`--mcp-config` (alvo do `.mcp.json`, padrão `<cwd>/.mcp.json`), `-McpName`/`--mcp-name` (padrão `open-design`), `-SkipMcp`/`--skip-mcp`. Pré-requisitos que o usuário precisa ter: **git** e **Docker Desktop** (com Compose v2). O script é idempotente — preserva um `OD_API_TOKEN` existente e apenas atualiza o repo em execuções seguintes.

**Conexão do MCP (automática):** o script conecta o MCP nos dois cenários:

- Se houver o binário `od` no host (caminho pnpm), usa o nativo `od mcp install <agent>`.
- No modo Docker (sem `od` no host), chama o helper `scripts/od-mcp-config.mjs`, que busca a spec de lançamento canônica do daemon em `GET /api/mcp/install-info` (o mesmo payload do Settings → MCP) e faz **merge** da entrada `mcpServers.<nome>` no `.mcp.json`, preservando o resto do arquivo. Usa Node (já requerido pelo cc-pensador), sem depender de `jq`/`python`.

> Ressalva honesta: o bridge **stdio** do MCP (`od mcp`) precisa de um binário `od` no host para realmente subir. No modo Docker puro a entrada é gravada no `.mcp.json`, mas se o agente reportar falha ao iniciar o MCP `open-design`, o caminho que dá um `od` real é o pnpm. Independentemente disso, o Pensador lê os design systems pela API do daemon (`/api/design-systems`) — então a integração funciona mesmo sem o MCP stdio. Depois que o daemon sobe, o Pensador aguarda a confirmação do usuário e retoma.

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
