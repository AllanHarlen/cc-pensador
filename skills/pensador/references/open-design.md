# Open Design (MCP + CLI) — sistema de design para front-end

O Pensador v2 integra o **Open Design** ([nexu-io/open-design](https://github.com/nexu-io/open-design)) como suporte **opcional e condicional a front-end** para fechar a lacuna de design que requisitos puramente funcionais deixam aberta.

> O Open Design é a alternativa open-source e local-first ao Claude Design. Ele entrega como **skills, CLI (`od`) e servidor MCP** consumidos nativamente por agentes de código. Em vez de "antd no tema default + fluxos funcionais" (que rende cara de template administrativo genérico), o Open Design transforma um **brief de design** em um `DESIGN.md` brand-grade: paleta, tipografia, espaçamento, layout, componentes, motion, voz e anti-padrões.

---

## Por que integrar

O diagnóstico recorrente de saídas do Pensador é: o PRD descreve a UI só em termos funcionais (quais telas e fluxos existem) e **zero em termos de design** — sem design system, tokens, paleta, tipografia, estados de componente (vazio/carregando/erro/sucesso), responsividade, acessibilidade, hierarquia visual ou microcopy. Sem essa camada, o agente de front-end não tem alvo visual e entrega um template chapado.

O Open Design fornece o **alvo de design** que faltava. O Pensador faz todo o **parse das informações** (tom visual, marca, referências, paleta, tipografia, estados, responsividade, acessibilidade, microcopy) e alimenta o Open Design para garantir o melhor resultado de acordo com o solicitado. O entregável é o **`DESIGN.md` verbatim** do system selecionado (baixado para `design-systems/<id>/`); o Pensador só escreve um `design-system.md` próprio no **fallback** (Open Design indisponível).

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

- **FINAL (modo PRD, quando `hasFrontend`):** o Pensador aciona o Open Design com o brief consolidado e **baixa os artefatos verbatim do system** para o repo-alvo:

  ```text
  <featurePath>/design-systems/<id>/{USAGE,DESIGN}.md · tokens.css · components.html · …  (verbatim, dentro de .pensador/<slug>-vN/)
  ```

  O `DESIGN.md` verbatim (9 seções `color`/`typography`/`spacing`/`layout`/`components`/`motion`/`voice`/`brand`/`anti-patterns`) **é** o documento de design — o Pensador **não gera um `design-system.md` standalone redundante** quando um system é usado. A seleção do system e o `<id>` viajam no `handoff.json` (role `design-system-files`). O `design-system.md` inline só existe no **fallback** (Open Design indisponível/recusado), preenchendo as 9 seções a partir do brief.

No modo Spec (OpenSpec), **o Open Design continua rodando** (diferente de `userhistory.md`/`communication.md`, que não se aplicam): só muda *onde* o design é escrito — ver a seção **Modo Spec** abaixo.

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

> ⚠️ **O Open Design não gera um `DESIGN.md` a partir de um brief em prosa.** Não é isso que o produto faz. Ele **cura ~72 design systems** prontos (DESIGN.md de 9 seções), **importa** systems de fontes reais (GitHub, shadcn, projeto local) e usa esse DESIGN.md como camada de system-prompt para gerar protótipos HTML. Portanto o Pensador não pede ao Open Design para "inventar" um design system; ele **seleciona/importa** o DESIGN.md mais próximo do brief e o **usa verbatim** (baixado para `design-systems/<id>/DESIGN.md`), sem re-escrevê-lo em um `design-system.md` separado.

Com o brief coletado, o Pensador dirige o Open Design pelos **verbos reais** do CLI `od` (caminho pnpm/local, que fornece o binário `od`) ou, no caminho Docker, pela **API REST do daemon** (os endpoints que o `od` encapsula):

| Passo | CLI `od` (pnpm/local) | Equivalente Docker (API do daemon) |
|---|---|---|
| 1. Listar os systems curados | `od design-systems list --json` | `GET http://localhost:7456/api/design-systems` |
| 2. **Apresentar top-3 candidates ao usuário** via `AskUserQuestion` (com o tom visual de cada system) | — | — |
| 3. (Opcional) Importar de uma marca/repo real citado no brief | `od design-systems import-github <url>` · `od design-systems import-shadcn <ref>` | `POST /api/design-systems/import/github` |
| 3a. ⚠️ **Import é async** | Após rodar o import, aguarde o daemon confirmar o slug antes de gravar em `state.designSystems`. Slug alucinado → exit 5 no FINAL. | idem |
| 4. Casar o brief com o system confirmado pelo usuário | escolha validada | escolha validada |
| 5. **Baixar TODOS os artefatos verbatim** — via `od get-file`, MCP `get_file` ou clone em disco | `od get-file design-systems/<id>/<file>` por arquivo | MCP `get_file` / cópia do clone (preferida) |
| 5a. ⚠️ **`GET /api/design-systems/<id>` retorna só metadados** | O endpoint REST não serve `tokens.css` / `components.html` como bodies — use `od get-file` ou o clone | idem |
| 6. Persistir os arquivos na pasta da feature | grava em `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`) | idem |
| 7. Derivar o `tokens.css` do projeto (composição rastreável, **nunca** objeto JS à mão) | base real do tema; `theme.ts` lê `var(--*)` | idem |
| 8. O `DESIGN.md` verbatim **é** o documento de design | nenhum `design-system.md` standalone (evita duplicação); seleção/overrides vão no `handoff.json` | idem |

> ⚠️ **O bug que isto corrige.** Versões anteriores puxavam **só o `DESIGN.md`** (prosa) e o re-escreviam em `design-system.md`, descartando `tokens.css`, `components.html` e `preview/`. O agente de front-end nunca via os tokens reais → tema chapado, magic numbers, anti-padrões. O Open Design **não é fonte de inspiração textual; é um pipeline de artefatos de código.**

### Artefatos verbatim (read order do `USAGE.md` oficial)

O `USAGE.md` de cada system define a ordem de leitura — e o Pensador deve **baixar e persistir** todos, não resumir (`OPEN_DESIGN.systemArtifacts` / `openDesignFetchPlan()`):

| Arquivo/Dir | Papel | Obrigatório |
|---|---|---|
| `manifest.json` | entrada machine-readable do system | — |
| `USAGE.md` | router: como consumir o pacote (ler primeiro) | — |
| `DESIGN.md` | intenção: 9 seções de prosa + anti-padrões | ✅ |
| `tokens.css` | **fonte de verdade**: CSS custom props compiladas — colar antes de qualquer CSS de componente | ✅ |
| `components.html` | fixtures: HTML/CSS real dos componentes + estados | — |
| `components.manifest.json` | inventário de componentes | — |
| `assets/` | brand assets (logos, ícones) | — |
| `fonts/` | webfonts — **necessário para fidelidade tipográfica** | — |
| `preview/` | diretório de sanity check visual para o gate de review | — |

> ⚠️ **`preview/` e `fonts/` variam por system.** Dos ~72 systems curados, a maioria traz `preview/colors.html`, `preview/spacing.html` e `preview/typography.html`; apenas alguns trazem `preview/app.html`. O `od-fetch-system.mjs` copia cada diretório inteiro via `copyTree`; o gate de review deve abrir `preview/` como diretório, não apontar para um arquivo fixo.

Destino no repo: `<featurePath>/design-systems/<id>/` — dentro da pasta da feature (`.pensador/<slug>-vN/`), mantendo a saída do Pensador autocontida e coerente com o contrato de handoff (nenhum artefato na árvore de código real). O `state.uiPackageDir` (derivado em ARCH via `resolveUiPackageDir()`; fallback `packages/ui`) **não** é o destino da cópia: é o **alvo de materialização** que o Orquestrador/Executor usa depois para mover os arquivos para `packages/ui`/`src/styles`. Ver `designSystemFilesRoot()` no engine.

> ⚠️ **Acesso aos arquivos — ordem de preferência verificada.** (1) `od get-file design-systems/<id>/<file>` — via daemon, compila `tokens.css` sob demanda; (2) MCP `get_file` — mesmo daemon, nativo ao agente; (3) clone em disco `open-design/design-systems/<id>/` — mais rápido, sem rede, mas `tokens.css` pode não estar pré-compilado para systems DESIGN.md-only. `GET /api/design-systems/<id>` **não serve raw file bodies** (`tokens.css`, `components.html`) — retorna só metadados + DESIGN.md. Não fabricar endpoint REST de arquivo.

O MCP do Open Design (`od mcp install <agent>`, depois `od mcp`) é o que conecta o servidor ao agente; ele expõe ferramentas como `list_projects`, `get_file`, `search_files` e `create_artifact`. O instalador deste repo (ver abaixo) tenta conectá-lo automaticamente.

O Pensador nunca delega o diálogo: toda decisão de direção visual que precisa do usuário vira pergunta `AskUserQuestion`. O Open Design fornece o material de design (os arquivos `tokens.css`/`components.html`/`DESIGN.md`) que o Pensador **persiste verbatim** e referencia — sem reinventar tokens.

---

## Do brief (`AskUserQuestion`) para o Open Design

As 8 dimensões de `openDesignBriefPlan()` **não** podem se dissolver na prosa do `design-system.md` (foi isso que gerou o tema chapado). Cada resposta tem um **destino estruturado** no Open Design — `openDesignBriefRouting()` define qual. O Open Design expõe dois mecanismos tipados no bloco `od:` de uma skill: **`inputs`** (conteúdo/componentes: `product_name`, `tagline`, `theme` enum) e **`parameters`** (estilização ao vivo: `accent_hue`, `hero_density`, `section_spacing`, `accent_strength`).

| Dimensão do brief | Destino | Onde age no Open Design |
|---|---|---|
| `visualTone` | `selection` | escolha do system curado + `theme` enum (`dark-glass`/`minimal`/…) |
| `brandReferences` | `selection` | marca real citada → `od design-systems import-github <url>` |
| `colorPalette` | `parameter` | `accent_hue` (matiz da cor de marca) / `accent_strength` (opacity) |
| `typography` | `parameter` | escala/família via `sections:[typography]` (override doc se conflita) |
| `componentStates` | `input` | inventário de estados exigidos, **validado vs `components.html`** |
| `responsiveness` | `parameter` | `section_spacing` / densidade |
| `accessibility` | `constraint` | gate de contraste WCAG AA — **enforced como requisito normativo no modo Spec** (review gate); no modo PRD, verificado no review contra o `DESIGN.md` verbatim |
| `microcopy` | `input` | `tagline` + copy das seções + CTAs |

**Regra inviolável (do `skills-protocol.md` do Open Design):** *"never invent new tokens."* Resposta que **bate** com o system vira `input`/`parameter`. Resposta que **conflita** vira **override documentado** — na seção *Decisions* do `design.md` (modo Spec) ou como nota de override no resumo do `handoff.json` (modo PRD) — nunca um hex/raio/spacing solto no `theme.ts`. As regras de uso do system viajam junto para o agente de front-end e o review: *accent usado ≤ 2× por página (hero + CTA + links), sem inventar hex, sem sombra se Depth & Elevation = minimal.*

---

## Modo Spec (OpenSpec) — onde o design entra no change set

O Open Design é **ortogonal ao `artifactMode`**: roda sempre que `hasFrontend`, nos dois modos. O que muda é **onde** cada saída é escrita (`openDesignDeliveryFor(artifactMode, changeName)` no engine). No modo Spec o Pensador **não escreve à mão** os arquivos do change — alimenta os comandos `openspec-*`.

| Saída do Open Design | Modo PRD | Modo Spec (OpenSpec) |
|---|---|---|
| Arquivos verbatim do system (`tokens.css`, `components.html`, …) | `<featurePath>/design-systems/<id>/` | **idem** (dentro de `.pensador/<slug>-vN/` nos dois modos — não são geridos pelo OpenSpec; o Executor materializa em `packages/ui` depois) |
| **Decisões** de design (seleção, merge, overrides justificados) | `DESIGN.md` verbatim + `handoff.json` (role `design-system-files`) — **sem `design-system.md` standalone** | seção **Decisions** do `openspec/changes/<nome>/design.md` |
| **Requisitos** de UI do design system (estados, contraste AA, uso do accent) | `DESIGN.md` verbatim (schema de 9 seções) | capability delta-spec `openspec/changes/<nome>/specs/ui-design-system/spec.md` |

### A capability `ui-design-system` (delta spec)

Os requisitos de design viram uma capability OpenSpec com requisitos normativos (`SHALL`/`MUST`) e cenários `#### Scenario:` — testáveis, como manda o OpenSpec. Exemplo do que o Pensador alimenta no `proposal.md` (lista de capabilities) e no `specs/ui-design-system/spec.md`:

```markdown
## ADDED Requirements

### Requirement: Tokens são a fonte de verdade do estilo
O front-end MUST consumir `packages/ui/design-systems/<id>/tokens.css` como base de
estilo e NÃO MUST inventar valores de cor/raio/espaçamento fora dos tokens.

#### Scenario: Cor de marca aplicada
- **WHEN** um componente precisa da cor primária
- **THEN** usa a custom property do `tokens.css` (ex.: `var(--color-accent)`), nunca um hex literal

### Requirement: Uso contido do accent
O accent MUST aparecer no máximo 2× por página (hero + CTA), além de links.

#### Scenario: Landing não floda o accent
- **WHEN** a landing é renderizada
- **THEN** o accent aparece só no hero e no CTA do rodapé (e em links)
```

> A regra "never invent new tokens" e o uso do accent ≤ 2× saem como **requisitos verificáveis** no modo Spec — o que dá ao review (Fase 9 do Orquestrador) um critério de aceite formal, não só prosa.

### Fluxo no FINAL (modo Spec)

Use o contrato `openDesignSpecContract(featurePath, state.designSystems, state.uiPackageDir)` como fonte dos caminhos concretos (ver `references/openspec.md` › **Contrato Spec ↔ Open Design**):

1. Baixa e persiste os arquivos verbatim do system em `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`, igual ao PRD) — esta é a `origem` (`verbatimDir`) do contrato.
2. Alimenta o `proposal.md` com a capability `ui-design-system` na seção **Capabilities**.
3. Conduz `/openspec-ff-change <nome>` (ou `continue`) para gerar: `design.md` (Decisions citando `verbatimDir` + `materializeInto` + `<id>` + overrides) e `specs/ui-design-system/spec.md` (requisitos `SHALL` que citam `materializedTokens` + cenários).
4. `/openspec-verify-change <nome>` valida — cenários com exatamente 4 `#` e todo requisito com ≥ 1 cenário.

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

> 🔑 **Localização do `OD_API_TOKEN`:** o script instalador gera e grava o token em `~/.open-design/deploy/.env` (dentro do clone Docker). O `od-fetch-system.mjs` lê `OD_API_TOKEN` do ambiente — quando o clone em disco está disponível, o token não é necessário (caminho primário). Ele só é exigido pelo fallback REST (`GET /api/design-systems/<id>` retorna 401 sem ele). Se precisar exportar manualmente: `export OD_API_TOKEN=$(grep OD_API_TOKEN ~/.open-design/deploy/.env | cut -d= -f2-)`.

**Conexão do MCP (automática):** o script conecta o MCP nos dois cenários:

- Se houver o binário `od` no host (caminho pnpm), usa o nativo `od mcp install <agent>`.
- No modo Docker (sem `od` no host), chama o helper `scripts/od-mcp-config.mjs`, que busca a spec de lançamento canônica do daemon em `GET /api/mcp/install-info` (o mesmo payload do Settings → MCP) e faz **merge** da entrada `mcpServers.<nome>` no `.mcp.json`, preservando o resto do arquivo. Usa Node (já requerido pelo cc-pensador), sem depender de `jq`/`python`.

> Ressalva honesta: o bridge **stdio** do MCP (`od mcp`) precisa de um binário `od` no host para realmente subir. No modo Docker puro a entrada é gravada no `.mcp.json`, mas se o agente reportar falha ao iniciar o MCP `open-design`, o caminho que dá um `od` real é o pnpm. Independentemente disso, o Pensador lê os design systems pela API do daemon (`/api/design-systems`) — então a integração funciona mesmo sem o MCP stdio. Depois que o daemon sobe, o Pensador aguarda a confirmação do usuário e retoma.

### Onboarding de agentes (claude / codex / antigravity)

O onboarding do Open Design detecta um agente de código probing seu **binário no PATH do processo do daemon** (`apps/daemon/src/runtimes/executables.ts → resolveOnPath`). Há uma limitação estrutural: no install **Docker** o daemon roda num container **Linux** que não enxerga nem executa os binários do **host** (`claude.cmd` / `codex.cmd` / `agy.exe`). Por isso o onboarding sempre reporta `available: false` para os três — não é erro de configuração, é isolamento do container. **Detectar e rodar agentes do host exige um daemon rodando NO HOST.**

O cc-pensador resolve isso em duas peças:

- **`scripts/od-onboard-agents.mjs`** (núcleo determinístico, testado em `test/onboard-agents.test.js`): localiza o path de cada agente (PATH walk que espelha o `resolveOnPath` do Open Design, honrando `PATHEXT` no Windows; aceita overrides `--claude-bin`/`--codex-bin`/`--agy-bin`) e grava os overrides que o Open Design entende no `app-config.json` do daemon **local** (`<clone>/.od/app-config.json`):
  - `claude → agentCliEnv.claude.CLAUDE_BIN` e `codex → agentCliEnv.codex.CODEX_BIN` (chaves da allowlist em `apps/daemon/src/app-config.ts`).
  - **`antigravity` não tem chave `*_BIN`** (o `bin` é `agy`): é resolvido **por PATH**, então o script reporta o diretório do `agy` em `pathAdditions` para o launcher prepender ao PATH do daemon. Com `--verify <daemon-url>` consulta `/api/agents` e confirma `available`.

- **`scripts/onboard-open-design-agents.ps1|.sh`** (orquestrador): registra os agentes e, com `--launch`/`-Launch`, garante deps + build do daemon local, libera a porta (parando o container Docker com `--stop-docker`/`-StopDocker`) e sobe `node apps/daemon/dist/cli.js` com `CLAUDE_BIN`/`CODEX_BIN` setados e o diretório do `agy` prependido ao PATH — então verifica `/api/agents`.

O instalador (`install-open-design.ps1|.sh`) chama a etapa de **registro** (rápida, sem build) ao final por padrão (desligável com `-SkipOnboardAgents`/`--skip-onboard-agents`) e imprime o comando único para subir o daemon local. O Docker permanece como fallback **só-design-systems** (a leitura de `/api/design-systems` independe de agente).

### Se o usuário escolher "Seguir sem" (Opção B)

O Pensador escreve `design-system.md` inline, preenchendo as 9 seções do schema `DESIGN.md` a partir do brief coletado, e registra que foi gerado sem o Open Design.

Quando a demanda **não** tem front-end (`hasFrontend = false`), o Open Design não é relevante e nenhuma pergunta é feita.

---

## Leitura relacionada

- `references/stages.md`: BRAINSTORM_GERAL (lente de UI/UX) e FINAL (artefatos).
- `references/skill-stack.md`: skills como lentes de domínio; Open Design como motor de design.
- `references/codebase-memory.md`: padrão de oferta de instalação via `AskUserQuestion`.
- `references/feature-isolation.md` e `references/handoff-contract.md`: role `design-system-files` (arquivos verbatim, inclui `DESIGN.md`) e o `design-system.md` de fallback.
- `skills/prd/SKILL.md`: seção **Design System & UI/UX** do `Strict_PRD_Schema`.
- `scripts/od-fetch-system.mjs`: script I/O que executa o `openDesignFetchPlan()` no FINAL — copia os arquivos verbatim do clone Docker (ou fallback REST) para `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`, via `--out-dir <featurePath>`).
- `scripts/od-onboard-agents.mjs` + `scripts/onboard-open-design-agents.ps1|.sh`: onboarding dos agentes do host (claude/codex/antigravity) num daemon local — ver a seção **Onboarding de agentes** acima.
