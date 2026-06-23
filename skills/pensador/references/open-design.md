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

- **FINAL (modo PRD, quando `hasFrontend`):** o Pensador aciona o Open Design com o brief consolidado, **baixa os artefatos verbatim do system** para o repo-alvo e grava o documento de decisões:

  ```text
  packages/ui/design-systems/<id>/{USAGE,DESIGN}.md · tokens.css · components.html · …  (verbatim)
  <featurePath>/design-system.md                                                         (decisões + ponteiros)
  ```

  Os arquivos verbatim são a **fonte de design real**; o `design-system.md` (artefato final em `buildArtifactList`, schema de 9 seções `color`/`typography`/`spacing`/`layout`/`components`/`motion`/`voice`/`brand`/`anti-patterns`) deixa de duplicar tokens e passa a **documentar** a seleção do system, o merge e os overrides justificados, **apontando** para `tokens.css`/`components.html`.

No modo Spec (OpenSpec), **o Open Design continua rodando** (diferente de `userhistory.md`/`comunication_json.md`, que não se aplicam): só muda *onde* o design é escrito — ver a seção **Modo Spec** abaixo.

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
| 4. Seguir o `USAGE.md` do system e **baixar TODOS os artefatos verbatim** | `od design-systems show <id> --json` + `get_file` (MCP) por arquivo | `GET /api/design-systems/<id>` + MCP `get_file` / cópia do clone |
| 5. Persistir os arquivos no repo-alvo | grava em `packages/ui/design-systems/<id>/` | idem |
| 6. Derivar o `tokens.css` do projeto (composição rastreável, **nunca** objeto JS à mão) | base real do tema; `theme.ts` lê `var(--*)` | idem |
| 7. `design-system.md` = **documento de decisões** (seleção, merge, overrides justificados, ponteiros) | referencia os arquivos; não os duplica | idem |

> ⚠️ **O bug que isto corrige.** Versões anteriores puxavam **só o `DESIGN.md`** (prosa) e o re-escreviam em `design-system.md`, descartando `tokens.css`, `components.html` e `preview/`. O agente de front-end nunca via os tokens reais → tema chapado, magic numbers, anti-padrões. O Open Design **não é fonte de inspiração textual; é um pipeline de artefatos de código.**

### Artefatos verbatim (read order do `USAGE.md` oficial)

O `USAGE.md` de cada system define a ordem de leitura — e o Pensador deve **baixar e persistir** todos, não resumir (`OPEN_DESIGN.systemArtifacts` / `openDesignFetchPlan()`):

| Arquivo | Papel | Obrigatório |
|---|---|---|
| `USAGE.md` | router: como consumir o pacote (ler primeiro) | — |
| `DESIGN.md` | intenção: 9 seções de prosa + anti-padrões | ✅ |
| `tokens.css` | **fonte de verdade**: CSS custom props compiladas — colar antes de qualquer CSS de componente | ✅ |
| `components.html` | fixtures: HTML/CSS real dos componentes + estados | — |
| `components.manifest.json` | inventário de componentes | — |
| `preview/` | diretório de sanity check visual para o gate de review | — |

> ⚠️ **`preview/` varia por system.** Dos ~152 systems curados, só 1 traz `preview/app.html`. A maioria traz `preview/colors.html`, `preview/spacing.html` e `preview/typography.html`. O `od-fetch-system.mjs` copia o diretório inteiro via `copyTree`; o gate de review deve abrir `preview/` como diretório, não apontar para um arquivo fixo.

Destino no repo: `packages/ui/design-systems/<id>/` (constante `OPEN_DESIGN.systemsDir`).

> ⚠️ **Acesso aos arquivos — verificar empiricamente.** `GET /api/design-systems/<id>` pode devolver só metadados+`DESIGN.md`. Os arquivos brutos (`tokens.css`, `components.html`) vêm, em ordem de preferência: (1) MCP `get_file`; (2) cópia do clone Docker em `open-design/design-systems/<id>/`. **Não fabricar** um endpoint REST de arquivo sem confirmar o payload real do daemon.

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
| `accessibility` | `constraint` | gate de validação (contraste WCAG AA) sobre o output |
| `microcopy` | `input` | `tagline` + copy das seções + CTAs |

**Regra inviolável (do `skills-protocol.md` do Open Design):** *"never invent new tokens."* Resposta que **bate** com o system vira `input`/`parameter`. Resposta que **conflita** vira **override documentado** no `design-system.md` (com justificativa) — nunca um hex/raio/spacing solto no `theme.ts`. As regras de uso do system viajam junto para o agente de front-end e o review: *accent usado ≤ 2× por página (hero + CTA + links), sem inventar hex, sem sombra se Depth & Elevation = minimal.*

---

## Modo Spec (OpenSpec) — onde o design entra no change set

O Open Design é **ortogonal ao `artifactMode`**: roda sempre que `hasFrontend`, nos dois modos. O que muda é **onde** cada saída é escrita (`openDesignDeliveryFor(artifactMode, changeName)` no engine). No modo Spec o Pensador **não escreve à mão** os arquivos do change — alimenta os comandos `openspec-*`.

| Saída do Open Design | Modo PRD | Modo Spec (OpenSpec) |
|---|---|---|
| Arquivos verbatim do system (`tokens.css`, `components.html`, …) | `packages/ui/design-systems/<id>/` | **idem** (vão para o repo nos dois modos — não são geridos pelo OpenSpec) |
| **Decisões** de design (seleção, merge, overrides justificados, ponteiros) | `design-system.md` (standalone) | seção **Decisions** do `openspec/changes/<nome>/design.md` |
| **Requisitos** de UI do design system (estados, contraste AA, uso do accent) | `design-system.md` (schema de 9 seções) | capability delta-spec `openspec/changes/<nome>/specs/ui-design-system/spec.md` |

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

1. Baixa e persiste os arquivos verbatim do system em `packages/ui/design-systems/<id>/` (igual ao PRD).
2. Alimenta o `proposal.md` com a capability `ui-design-system` na seção **Capabilities**.
3. Conduz `/openspec-ff-change <nome>` (ou `continue`) para gerar `design.md` (Decisions de design) e `specs/ui-design-system/spec.md` (requisitos + cenários).
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
- `scripts/od-fetch-system.mjs`: script I/O que executa o `openDesignFetchPlan()` no FINAL — copia os arquivos verbatim do clone Docker (ou fallback REST) para `packages/ui/design-systems/<id>/`.
