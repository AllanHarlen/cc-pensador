# Open Design (MCP + CLI) — sistema de design para front-end

O Pensador v2 integra o **Open Design** ([nexu-io/open-design](https://github.com/nexu-io/open-design)) como suporte **opcional e condicional a front-end** para fechar a lacuna de design que requisitos puramente funcionais deixam aberta.

> O Open Design é a alternativa open-source e local-first ao Claude Design. Ele entrega como **skills, CLI (`od`) e servidor MCP** consumidos nativamente por agentes de código. Em vez de "antd no tema default + fluxos funcionais" (que rende cara de template administrativo genérico), o Open Design transforma um **brief de design** em um `DESIGN.md` brand-grade: paleta, tipografia, espaçamento, layout, componentes, motion, voz e anti-padrões.

---

## Por que integrar

O diagnóstico recorrente de saídas do Pensador é: o PRD descreve a UI só em termos funcionais (quais telas e fluxos existem) e **zero em termos de design** — sem design system, tokens, paleta, tipografia, estados de componente (vazio/carregando/erro/sucesso), responsividade, acessibilidade, hierarquia visual ou microcopy. Sem essa camada, o agente de front-end não tem alvo visual e entrega um template chapado.

O Open Design fornece o **alvo de design** que faltava. O Pensador faz todo o **parse das informações** (tom visual, marca, referências, paleta, tipografia, estados, responsividade, acessibilidade, microcopy) e o converte em seed do brand engine do Open Design para garantir o melhor resultado de acordo com o solicitado. O entregável é o **`DESIGN.md` verbatim** do system selecionado (baixado para `design-systems/<id>/`); o Pensador só escreve um `design-system.md` próprio no **fallback** (Open Design indisponível).

Mapeamento determinístico em `pensador-engine.mjs`: `OPEN_DESIGN`, `designSystemArtifactPath()`, `openDesignBriefPlan()`, `buildDesignBrief()`, `briefToSeed()`, `designBriefPath()`.

### Fontes canônicas (upstream)

> ⚠️ **O `CHANGELOG.md` da raiz do repo upstream está congelado em `0.9.0` (2026-05-29)** — não reflete releases posteriores. O changelog canônico migrou para `docs/CHANGELOG/v<versão>/<locale>.md` (locale `en` obrigatório), com `RELEASE-NOTES-0.10.0.md` na raiz cobrindo a transição e o restante disponível só pela [API de Releases do GitHub](https://api.github.com/repos/nexu-io/open-design/releases). Não planejar uma atualização deste plugin só a partir do `CHANGELOG.md` — ele perde tudo entre `0.10.0` e o release atual.

Para revalidar este documento contra o upstream, checar:

- `docs/CHANGELOG/v<versão>/en.md` e a API de Releases (histórico real de mudanças).
- `docs/design-systems.md` (contrato de `manifest.json`, schema `od-design-system-project/v1`).
- `docs/plugins-spec.md` (vocabulário `od plugin`/`od marketplace`).
- `docs/skills-protocol.md` (contrato de skills, distinto de plugins).
- `docs/agent-adapters.md` (ids de agente suportados, ex.: `claude`, `codex`, `kiro`, `antigravity`).
- `docs/install-guide.md` (instalador oficial `deploy/scripts/install.sh`).

Última verificação registrada: **upstream v0.20.2 (2026-08-21)**, checada em 2026-08-22 via GitHub API/raw content (sem instalação local do Open Design — ver "Suposições não verificadas" no plano de implementação). Nenhuma superfície do catálogo (`od design-systems`, `od get-file`, `GET /api/design-systems`) faz parte do fluxo: o Pensador usa apenas o brand engine (`POST /api/brand/build` / `pnpm brand:build`), cuja disponibilidade é verificada na Fase 0 do plano.

> **Decisão registrada: sem probe de versão do daemon em `preflight.mjs`.** O plano cogitava sondar `GET /api/version` para reportar a versão do Open Design observada. Não implementado: `preflight.mjs` inteiro é síncrono (`execSync` para CLI, leitura de arquivo para MCP config) e adicionar uma chamada de rede assíncrona exigiria converter o script inteiro para `async`/`await` só por causa desta sonda opcional — custo desproporcional ao ganho para um endpoint cujo contrato (`/api/version`, sem token) tampouco foi confirmado ao vivo. Revisitar quando o Open Design estiver instalado localmente para validar o endpoint e medir o custo real de latência de um preflight assíncrono.

---

## Quando roda

- **BRAINSTORM_GERAL (lente de UI/UX, quando `hasFrontend`):** além das perguntas de produto/UX, o Pensador coleta o **brief de design** via `AskUserQuestion`, cobrindo as dimensões de `openDesignBriefPlan()`:

  | Dimensão | O que parsear |
  |---|---|
  | `sectorContext` | Setor/indústria do negócio (ex.: oficina automotiva, clínica odontológica, e-commerce de moda). Não é tema visual — orienta iconografia, imagery de produto/serviço e o vocabulário de domínio da microcopy. Sem esta dimensão o system fica com uma "vibe" de marca genérica sem nada do ramo real do usuário (ex.: loja de autopeças com texto institucional fixo em inglês e zero imagem de produto). |
  | `visualTone` | Tom visual desejado (ex.: "clean azul/grafite tipo Linear/Vercel", "vibrante") |
  | `brandReferences` | Produtos/sites de referência ou identidade visual existente |
  | `colorPalette` | Cor de marca, neutros e semânticas (sucesso/erro/aviso/info) |
  | `typography` | Famílias, escala e pesos |
  | `componentStates` | default/hover/focus/active/disabled/loading/vazio/erro |
  | `responsiveness` | Breakpoints, grid, densidade |
  | `accessibility` | Contraste, foco visível, leitura de tela, alvo WCAG |
  | `microcopy` | Voz/tom dos textos e mensagens de estado |

- **DESIGN (quando `hasFrontend`):** o Pensador gera o design system a partir do brief consolidado (sem catálogo):

  ```text
  <featurePath>/design-systems/<id>/source/    brand.json · seed.json · engine-run.json (proveniência)
  <featurePath>/design-systems/<id>/resolved/  design-contract.json · tokens.css · DESIGN.md · components.html · preview/ · …  (dentro de .pensador/<slug>-vN/)
  ```

  O `DESIGN.md` de `resolved/` (9 seções `color`/`typography`/`spacing`/`layout`/`components`/`motion`/`voice`/`brand`/`anti-patterns`) **é** o documento de design — o Pensador **não gera um `design-system.md` standalone redundante** quando o pacote foi gerado. O `<id>` viaja no `handoff.json` (role `design-system-files`). O `design-system.md` inline só existe no **fallback** (Open Design indisponível/recusado), preenchendo as 9 seções a partir do brief.

No modo Spec (OpenSpec), **o Open Design continua rodando** (diferente de `userhistory.md`/`communication.md`, que não se aplicam): só muda *onde* o design é escrito — ver a seção **Modo Spec** abaixo.

---

## Detecção (preflight)

O `preflight.mjs` reporta, no bloco `integrations.openDesign`:

- `available`: verdadeiro quando o servidor está registrado em um `.mcp.json` conhecido (projeto `.mcp.json`, `.kiro/settings/mcp.json`, `~/.claude/.mcp.json` **ou** `~/.claude/settings/mcp.json` — quatro locais sondados) **ou** quando há um `od` no PATH que **não** seja o `od` (octal-dump) do GNU coreutils.
- `configured` / `configuredIn`: onde foi encontrado.
- `mcpFunctional`: verdadeiro **somente** quando um `od` real (não coreutils) está no PATH. `available` via só uma entrada MCP registrada (`cli.ok = false`) já é suficiente para ler design systems pela API REST do daemon, mas o bridge stdio do MCP (`od mcp`) exige o binário `od` no host — `mcpFunctional` distingue essas duas garantias para quem consome o relatório.
- `relevantWhen: "hasFrontend"`: só importa quando a demanda tem front-end.
- `fallbackBehavior`: o que fazer quando indisponível.

> ⚠️ **Falso positivo do `od`:** o GNU coreutils instala um binário `od` (octal-dump) em praticamente todo sistema Unix-like, e seu `--version` anuncia "GNU coreutils". Esse **não** é o CLI do Open Design. O `checkOpenDesign()` filtra essa assinatura, então a deteç̧ão confiável é a **entrada MCP registrada**, não a presença de `od` no PATH.

Por ser opcional e condicional, a ausência do Open Design **nunca bloqueia** o fluxo e **não altera o `status`** do preflight (igual ao OpenSpec).

---

## Como o Pensador usa o Open Design

> **O Open Design gera design system a partir de um brief.** O brand engine determinístico (`apps/daemon/src/brands/engine/`) transforma um *seed* de ~20 campos em tokens claro/escuro/compacto, com escadas de 10 passos, sem LLM; a skill `design-brief` define as 8 dimensões ortogonais do brief. (Uma versão anterior deste documento afirmava o contrário e tratava o Open Design como um catálogo a ser consultado.)

**Sem catálogo.** O Pensador **não lista, não baixa, não escolhe e não verifica** systems do catálogo do Open Design. Uma medição sobre os 152 systems empacotados mostrou que 150 têm prosa (`DESIGN.md`) divergente do `tokens.css`, então o catálogo não é uma base confiável para um pacote sem divergência.

Fluxo (o Pensador dirige o Open Design; o diálogo continua sendo `AskUserQuestion`):

| Etapa | O que acontece |
|---|---|
| BRAINSTORM_GERAL | o brief de design é coletado via `AskUserQuestion` (`openDesignBriefPlan()`); campos decididos pelo usuário ficam travados |
| DESIGN — seed | `design-brief.mjs build` persiste o `design-brief.json` e `design-brief.mjs seed` (`briefToSeed()`) grava `brand.json`, `seed.json` e `seed-origin.json` em `source/`; o AGY só propõe os campos **não travados**, e o usuário confirma |
| DESIGN — derivação | `od-brand-build.mjs` roda o brand engine do Open Design (cadeia **clone → `BLOCKED`**, a partir do clone do daemon do host) e mapeia a saída para o TOKEN_SCHEMA; nunca um LLM |
| DESIGN — contrato e render | `design-contract.json` (v2) → `tokens.css`, `design-tokens.json` (DTCG), `tailwind-v4.css`, `DESIGN.md`, `components.html`, `preview/`, `USAGE.md`, `manifest.json` (`design-package.mjs render`, obrigatório) |
| DESIGN — gates | `design-package.mjs audit` → `design-audit.json` com `checks` por gate: `structure` (arquivos, escalas monótonas, estados com `focus-visible`), `contrast` (matriz WCAG 2.2 AA nos temas claro **e** escuro, só variantes seguras), `conformance` (campo **travado** do brief que diverge bloqueia; primária comparada só ao tema claro, ΔE ≤ 2), `integrity` (re-render em memória byte a byte + `provenance.json`) e `engineRun` (`source/engine-run.json` com `status: "ok"` para o mesmo contrato) |
| DESIGN — aprovação visual | o usuário vê `preview/` nos dois temas via `AskUserQuestion`; ajustes rápidos (primária, densidade, raio, tipografia, tema padrão) passam por `design-brief.mjs adjust` e refazem só seed → derivação → render → audit; `design-brief.mjs approve` grava `approvedAt` + `approvedSha256` no brief e o registro assinado `.pensador-approval.json` (só para um contrato auditado e com a pergunta `AprovDesign` registrada pelo hook; `brief` e registro são protegidos contra escrita direta). Protótipo do Open Design e Critique Theater são **opcionais e consultivos**, nunca bloqueiam |
| FINAL | `state.designPackages[<id>]` recebe o `auditStatus` real e o `contractSha256` (o `statePatch` do `audit`); o handoff publica só `resolved/` como autoridade |

### Derivação pelo brand engine (Fase 0 medida, Fase 3 implementada)

O README do engine cita `POST /api/brand/build` e `pnpm brand:build`, mas **nenhum dos dois existe** na versão 0.22.1 (a rota devolve 404; não há script no `package.json`). O engine roda, porém, só com built-ins do Node, importando `seed`, `derive` e `export` dele. `scripts/od-brand-build.mjs` (adaptador em `scripts/lib/brand-engine.mjs`) executa:

1. **clone:** `node --import scripts/lib/ts-register.mjs -e <runner>` sobre `~/.open-design/apps/daemon/src/brands/engine/*.ts` — o **mesmo clone** de onde o daemon do host roda (ou `OD_CLONE_DIR`; Node >= 22.6 com remoção de tipos). Sem estado, sem token, sem `node_modules`.
2. **`BLOCKED`** (`reasonCode: OD_BRAND_ENGINE_UNAVAILABLE`, exit 1) com `attempts[]`, remediação (clonar/instalar o Open Design no host) e comando de retomada, gravados em `source/engine-run.json`.

> O passo `container` (`docker exec` no engine compilado do daemon em Docker, `OD_CONTAINER`, `--engine container`) foi **removido**: o Docker não é mais um runtime suportado. `--engine` aceita `auto` e `clone` (a mesma coisa); `container` é recusado com um erro explícito.

O runner replica o merge de `brands/system.ts:139-143`: `seedFromBrand()` ignora `brand.seed`, então as sobreposições sanitizadas (20 campos) são aplicadas por cima. O mesmo seed produz o mesmo `design-contract.json` byte a byte (mesma versão do engine); qual caminho rodou fica só em `source/engine-run.json` e no `provenance.json`, nunca no contrato.

O mapeador (`scripts/lib/token-mapper.mjs`) troca o namespace `--brand-*` pelo TOKEN_SCHEMA do Open Design e aplica regras determinísticas para o que o engine não emite (`--accent-on` = branco ou preto de maior contraste; `--section-y-*` = 24/16/12 × `sizeUnit`; `--container-*`; `--elev-*`; `--tracking-display`). Extensões (camada C, declaradas pelo Pensador): `--info`, `--success-text`, `--warn-text`, `--danger-text`, `--info-text`, `--border-strong`, `--focus`, `--border-width`, `--control-h*`. Valores crus do engine que reprovam WCAG AA (semânticas como texto, `--border` a 1.41:1, foco no escuro) são trocados por variantes seguras (`*-text`, `--border-strong` ≥ 3:1, `--focus` ≥ 3:1) escolhidas na própria escada do engine e, se nenhuma servir, misturadas em direção ao `--fg`. O tema escuro é derivado pelo engine e **não** mantém a cor de marca travada (só o tema claro a mantém); `themes.compact` guarda apenas a densidade.

O `DESIGN.md` de `resolved/` **é** o documento de design — o Pensador não gera um `design-system.md` standalone redundante quando o pacote foi gerado. O `design-system.md` inline só existe no **fallback** (Open Design indisponível/recusado).

Destino: `<featurePath>/design-systems/<id>/` — dentro da pasta da feature (`.pensador/<slug>-vN/`), com `<id>` derivado do produto (ex.: `gestuor`), mantendo a saída do Pensador autocontida e coerente com o contrato de handoff (nenhum artefato na árvore de código real). O `state.uiPackageDir` (derivado em ARCH via `resolveUiPackageDir()`; fallback `packages/ui`) **não** é o destino da geração: é o **alvo de materialização** (`<uiPackageDir>/design-systems/<id>/`, o `materializeInto` do handoff) que o Orquestrador/Executor usa depois. Ver `designSystemFilesRoot()` no engine.

O MCP do Open Design (`od mcp install <agent>`, depois `od mcp`) é o que conecta o servidor ao agente; ele expõe ferramentas como `list_projects`, `get_file`, `search_files` e `create_artifact` — releases mais recentes (não verificado ao vivo) ampliaram o conjunto de tools para incluir escrita/exclusão de arquivos, exclusão de projetos e resolução do diretório ativo do projeto; a partir da 0.19.0 o daemon também encaminha múltiplos skill IDs por run quando o cliente MCP fornece mais de um. O instalador deste repo (ver abaixo) tenta conectá-lo automaticamente.

> **Gate de qualidade opcional — `od lint`** (upstream 0.20.0+, não verificado ao vivo neste repo): valida um artefato gerado (arquivo ou stdin), aplica um threshold de falha e retorna achados legíveis ou JSON **sem subir modelo** — útil como checagem determinística antes de considerar o front-end pronto. Capability-probed, nunca pressuposto: `OPEN_DESIGN.commands.odLint` documenta a forma (`od lint <file> --json`); não existe em versões anteriores à 0.20.0.

> **Vocabulário de plugins** (upstream 0.8.0+): distribuição de scenarios/skills como plugins via `od plugin install|apply|upgrade|trust|doctor` e `od marketplace add|trust`, com manifesto opcional `open-design.json` (`specVersion: "1.0.0"`). Um plugin com `SKILL.md` continua funcionando como skill de agente comum (Claude Code, Cursor, Codex, …) mesmo sem esse manifesto — não é um sistema substituto do protocolo de skills, é uma camada de empacotamento/marketplace sobre ele. Fora do escopo de uso ativo deste plugin; documentado aqui para referência futura.

O Pensador nunca delega o diálogo: toda decisão de direção visual que precisa do usuário vira pergunta `AskUserQuestion`. O Open Design fornece o **brand engine** que deriva os tokens do seed do brief; o Pensador renderiza e audita o pacote (`tokens.css`/`components.html`/`DESIGN.md`) a partir do `design-contract.json` — sem reinventar tokens.

---

## Do brief (`AskUserQuestion`) para o Open Design

As dimensões de `openDesignBriefPlan()` **não** podem se dissolver na prosa do `design-system.md` (foi isso que gerou o tema chapado). Cada resposta vira um campo `{ value, locked, questionRef }` do **`design-brief.json`** (`buildDesignBrief()`, `assets/design-brief.schema.json`, gravado em `designBriefPath(featurePath)`); `locked: true` é decisão explícita do usuário e prevalece sobre qualquer proposta. `briefToSeed(brief, proposals)` é a função pura que gera o seed do brand engine: **travado ▸ proposta do AGY (só campos não travados, confirmada pelo usuário) ▸ valor não travado ▸ default do engine**. Só os 20 campos do `SeedToken` saem (`OPEN_DESIGN_SEED_FIELDS`), `colorInfo` é sempre enviado explicitamente (o engine o iguala à primária se faltar) e a fonte display não é campo do seed. Mapeamento: paleta → `colorPrimary/Success/Warning/Error/Info`; tipografia → `fontFamily/fontFamilyCode/fontSize`; `density` (`compact|comfortable|spacious`) → `sizeUnit/sizeStep/controlHeight`; `borderRadius`; `motion` (`none|subtle|standard`) → `motion/motionUnit`. Tema padrão (`themeDefault`) e exposição do tema (`themeExposure`) não são campos do seed: seguem no brief para o contrato e para o Testador.

A tabela abaixo descreve o papel de cada dimensão no Open Design (o antigo destino `selection|input|parameter|constraint` deixou de ser código). O Open Design expõe dois mecanismos tipados no bloco `od:` de uma skill: **`inputs`** (conteúdo/componentes: `product_name`, `tagline`, `theme` enum) e **`parameters`** (estilização ao vivo: `accent_hue`, `hero_density`, `section_spacing`, `accent_strength`).

| Dimensão do brief | Destino | Onde age no Open Design |
|---|---|---|
| `sectorContext` | `input` | vocabulário de domínio para `tagline`/copy das seções e **seleção de imagery/iconografia** (ver `references/imagery.md`) — não escolhe o system, mas orienta o que popular nele |
| `visualTone` | `selection` | tom/mood: alimenta a **proposta do AGY para os campos não travados** do seed, que o usuário confirma (não há mais escolha de system de catálogo) |
| `brandReferences` | `selection` | marca de referência (texto ou URL da marca): entra como referência do seed. A URL vai no campo opcional `brandUrl`; `design-brief.mjs brand-url` a deriva pelo `buildFromUrl` do próprio engine (sem LLM; roda o `build.js` compilado do clone do daemon do host, `<clone>/apps/daemon/dist/brands/engine/build.js`, com as dependências do próprio clone) e propõe `colorPrimary`/`fontFamily` para os campos não travados, com o resultado confirmado pelo usuário |
| `colorPalette` | `parameter` | `accent_hue` (matiz da cor de marca) / `accent_strength` (opacity) |
| `typography` | `parameter` | escala/família via `sections:[typography]` (override doc se conflita) |
| `componentStates` | `input` | inventário de estados exigidos, **validado vs `components.html`** |
| `responsiveness` | `parameter` | `section_spacing` / densidade |
| `accessibility` | `constraint` | gate de contraste WCAG AA — **enforced como requisito normativo no modo Spec** (review gate); no modo PRD, verificado no review contra o `DESIGN.md` gerado |
| `microcopy` | `input` | `tagline` + copy das seções + CTAs |

**Regra inviolável:** *"never invent new tokens."* O valor de cada token vem do brand engine do Open Design a partir do seed do brief — nunca de um hex/raio/spacing escrito à mão. Campos do brief marcados como travados prevalecem sobre qualquer proposta; uma decisão do usuário que precisa de token fora do que o engine deriva vira **override documentado** — na seção *Decisions* do `design.md` (modo Spec) ou como nota de override no resumo do `handoff.json` (modo PRD) — nunca um valor solto no `theme.ts`. As regras de uso do design system viajam junto para o agente de front-end e o review: *accent usado ≤ 2× por página (hero + CTA + links), sem inventar hex, sem sombra se Depth & Elevation = minimal.*

---

## Modo Spec (OpenSpec) — onde o design entra no change set

O Open Design é **ortogonal ao `artifactMode`**: roda sempre que `hasFrontend`, nos dois modos. O que muda é **onde** cada saída é escrita (`openDesignDeliveryFor(artifactMode, changeName)` no engine). No modo Spec o Pensador **não escreve à mão** os arquivos do change — alimenta `/opsx:propose`.

| Saída do Open Design | Modo PRD | Modo Spec (OpenSpec) |
|---|---|---|
| Pacote de design gerado (`resolved/`) (`tokens.css`, `components.html`, …) | `<featurePath>/design-systems/<id>/` | **idem** (dentro de `.pensador/<slug>-vN/` nos dois modos — não são geridos pelo OpenSpec; o Executor materializa em `packages/ui` depois) |
| **Decisões** de design (seleção, merge, overrides justificados) | `DESIGN.md` gerado + `handoff.json` (role `design-system-files`) — **sem `design-system.md` standalone** | seção **Decisions** do `openspec/changes/<nome>/design.md` |
| **Requisitos** de UI do design system (estados, contraste AA, uso do accent) | `DESIGN.md` gerado (schema de 9 seções) | capability delta-spec `openspec/changes/<nome>/specs/ui-design-system/spec.md` |

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

1. Confirma o pacote gerado no DESIGN em `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`, igual ao PRD) — esta é a `origem` (`verbatimDir`) do contrato.
2. Alimenta o `proposal.md` com a capability `ui-design-system` na seção **Capabilities**.
3. Conduz `/opsx:propose <nome ou descrição>` para gerar: `design.md` (Decisions citando `verbatimDir` + `materializeInto` + `<id>` + overrides) e `specs/ui-design-system/spec.md` (requisitos `SHALL` que citam `materializedTokens` + cenários).
4. `openspec validate <nome> --strict --json` valida — cenários com exatamente 4 `#` e todo requisito com ≥ 1 cenário.

---

## Fallback — instalação (daemon no host, via script) ou DESIGN.md inline

Quando o preflight reportar `integrations.openDesign.available = false` **e** a demanda tiver front-end (`hasFrontend = true`), o Pensador pergunta via `AskUserQuestion`:

```text
[Pensador | BRAINSTORM_GERAL/FINAL] O Open Design não foi detectado.
Ele fornece um design system brand-grade (DESIGN.md) para a UI. Deseja instalar agora?
A instalação é local: o daemon roda NO SEU HOST (não em Docker), para poder usar os
agentes que você já tem (claude, codex, antigravity).

Opção A (recomendada): Instalar o Open Design no host
  O Claude executa o script instalador do cc-pensador (verifica git/node/pnpm,
  compila o clone, sobe o daemon no host com os agentes no PATH, conecta o MCP)
  e retoma usando o Open Design.

Opção B: Seguir sem o Open Design
  O Pensador escreve um design-system.md inline a partir do mesmo schema de 9 seções.
```

### Se o usuário escolher "Instalar" (Opção A)

O Claude executa o **script instalador** que acompanha o cc-pensador. **Não usa Docker**: um daemon num container Linux não enxerga `claude.cmd` / `codex.cmd` / `agy.exe` do host, então nunca poderia lançar o agente que o usuário escolher em `AgenteDesign`. O script verifica `git`, `node` (>= 22.6; o Open Design pede 24) e `corepack`, clona `nexu-io/open-design` em `~/.open-design`, delega ao `onboard-open-design-agents` (registra os agentes, `pnpm install` + build, guarda de porta, sobe o daemon no host), aguarda o daemon em `http://127.0.0.1:7456` e tenta `od mcp install <agent>`.

```powershell
# Windows (PowerShell) — use "powershell" (Windows PowerShell 5.1, presente em todo Windows);
# "pwsh" (PowerShell 7) nao vem instalado por padrao e falhou em uma run real
powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install-open-design.ps1"
```

```bash
# macOS / Linux
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-open-design.sh"
```

Parâmetros úteis: `-Agent`/`--agent` (slug do agente, padrão `claude`), `-Port`/`--port` (padrão 7456), `-McpConfig`/`--mcp-config` (alvo do `.mcp.json`, padrão `<cwd>/.mcp.json`), `-McpName`/`--mcp-name` (padrão `open-design`), `-SkipMcp`/`--skip-mcp`, `-SkipLaunch`/`--skip-launch` (só clona e registra os agentes), `-StopLegacyContainer`/`--stop-legacy-container` (ver a guarda de porta abaixo) e, só no Windows, `-Autostart` (registra a Tarefa Agendada). Pré-requisitos que o usuário precisa ter: **git**, **Node 24** (com corepack). O script é idempotente: atualiza o repo e não sobe um segundo daemon se já houver um respondendo.

> 🔑 **Token da API:** o daemon do host em loopback **não exige token** (a autenticação só liga quando `OD_API_TOKEN` está definido para ele). Os scripts do Pensador (`preflight.mjs`, `od-register-system.mjs`, `od-mcp-config.mjs`) usam `OD_API_TOKEN` do ambiente e, depois, `<clone>/.env` (o clone é `~/.open-design`, ou `OD_CLONE_DIR`); sem nenhum dos dois seguem sem `Authorization`. O antigo `deploy/.env` do Docker **não é mais lido**. O token nunca é impresso.

> 🌐 **Use `127.0.0.1`, nunca `localhost`:** o daemon trata `localhost` como a origem de "powered preview" e responde `403 Powered preview origin cannot access this API route` a clientes de API com cabeçalhos `Sec-Fetch-*` (o `fetch` do Node os envia). Os scripts normalizam `localhost` para `127.0.0.1`; passe sempre `--daemon-url http://127.0.0.1:<porta>`.

**Conexão do MCP (automática):** o script conecta o MCP nos dois cenários:

- Se houver o binário `od` no PATH, usa o nativo `od mcp install <agent>`.
- Sem `od` no PATH (o build por pnpm não o coloca lá), chama o helper `scripts/od-mcp-config.mjs`, que busca a spec de lançamento canônica do daemon em `GET /api/mcp/install-info` (o mesmo payload do Settings → MCP) e faz **merge** da entrada `mcpServers.<nome>` no `.mcp.json`, preservando o resto do arquivo. Usa Node (já requerido pelo cc-pensador), sem depender de `jq`/`python`.

> Ressalva honesta: o bridge **stdio** do MCP (`od mcp`) precisa de um binário `od` no PATH para realmente subir. Sem ele a entrada é gravada no `.mcp.json`, mas se o agente reportar falha ao iniciar o MCP `open-design`, o caminho que dá um `od` real é o `pnpm tools-dev`. Independentemente disso, o Pensador lê os design systems pela API do daemon (`/api/design-systems`) — então a integração funciona mesmo sem o MCP stdio. Depois que o daemon sobe, o Pensador aguarda a confirmação do usuário e retoma.

### Vínculo do agente do design (`AgenteDesign`)

O protótipo e o Critique Theater do Open Design só rodam com um **agente de código** vinculado. O `preflight.mjs` reporta `integrations.designAgents` (somente leitura, sem segredos, sem executar nada que grave estado):

- `agents[]`: `{ id, where: "host", available, authenticated: true|false|"unknown", source }`. `where: "host"` vem do PATH da máquina (`claude`, `codex`, `gemini`, `opencode`, `cursor-agent`, `qwen`, e `agy`/`kiro-cli` só quando os plugins irmãos `cc-antigravity-plugin`/`cc-kiro-plugin` estão instalados); a entrada do **daemon** vem de `GET /api/agents` (a detecção do próprio Open Design) (o daemon roda no host; sem resposta do daemon fica só o palpite por PATH). Só entram no JSON os agentes `available`; `undetectedCount` conta o resto. Os ids seguem os do Open Design (`agy → antigravity`, `kiro-cli → kiro`).
- `daemonWhere`: onde o daemon roda (`host`; `container` **só** quando um container Docker legado do OD publica a porta que respondeu — situação recusada, ver a guarda de porta; `null` se inalcançável) e `daemonStatus` (`ok`, `auth-required`, `unreachable`, `legacy-container`, …).

Regra: **o daemon só lança um agente que existe no ambiente dele.** Um agente que o daemon do host não enxerga devolve `agent-not-visible-to-daemon` com a remediação `install-and-authenticate-<id>-in-daemon-host`; um daemon que na verdade é um **container legado** devolve a mesma recusa com `stop-legacy-container` e `start-host-daemon` (o container não vê nenhum agente do host). O Pensador pergunta como proceder via `AskUserQuestion`.

Pergunta (uma vez, antes do DESIGN, com front-end e ao menos um agente `available`; `multiSelect: false`, `header: "AgenteDesign"`):

> **Qual agente deve gerar o protótipo do design e a crítica (Open Design)?** — uma opção por agente detectado (descrição `id@where`) + **Nenhum (pular protótipo)**.

A escolha é gravada por `design-brief.mjs agent --agents <preflight.json> --choose <id|none>` em `state.designAgent` (`null` = ainda não perguntado; `{ id: "none" }` = pulado; `{ id, where, chosenAt }` = vinculado; `validateDesignAgent`). O hook `track-questions.mjs` registra só o cabeçalho da pergunta, nunca a resposta. O `od run start --agent <id>` **nunca** dispara sem o aceite explícito do usuário (consome tokens); sem vínculo, protótipo e Critique ficam desligados e o DESIGN não é afetado.

### Registro do design system no daemon (protótipo opcional)

O protótipo (`od project create --design-system user:<id>`) só respeita os tokens se o daemon servir o `tokens.css` do `resolved/` **verbatim**. Não use `od design-systems import-local`: ele reescaneia a fonte e **regenera** o `tokens.css` (`buildDesignTokenContract`), o `resolved/` não é copiado, o daemon entrega uma paleta genérica e o agente reconstrói os valores por inferência (medido no daemon 0.22.1: tema claro 31 de 56 tokens idênticos, escuro 0 de 16). O `resolved/` do Pensador já é o layout nativo do daemon (`manifest.json` com `schemaVersion: "od-design-system-project/v1"` e `id` igual ao nome do diretório). O procedimento é **um comando**, com o aceite do usuário (grava estado no daemon; `header: "RegistroOD"`):

```bash
node scripts/od-register-system.mjs --dir <featurePath>/design-systems/<id> \
  --daemon-url http://127.0.0.1:<porta> [--data-dir <dados do daemon>] --accepted
```

1. `POST /api/design-systems` com `{ title: <id>, category: "Generated", status: "published", body: <DESIGN.md> }` — o `<id>` sai do slug do título e precisa ser o `--system-id` e o `id` do `manifest.json`, ou o daemon ignora o sistema. O daemon cria `<dados>/design-systems/<id>/` com um wrapper genérico.
2. Sobrepõe `tokens.css`, `design-tokens.json`, `tailwind-v4.css`, `components.html`, `components.manifest.json`, `USAGE.md`, `manifest.json`, `DESIGN.md` e `preview/` nesse diretório, e `tokens.css` também sobre `colors_and_type.css` (o wrapper não entrega uma paleta genérica por outro canal). O `--data-dir` padrão é o do daemon do host (`~/.open-design/.od`, ou `OD_DATA_DIR`); o daemon em Docker (`--container`) não é mais suportado.
3. **Confere pelo daemon, não pelo disco:** `GET /api/design-systems/user%3A<id>/file?path=tokens.css` (e `colors_and_type.css`) precisa ser byte a byte o `resolved/tokens.css`. Divergência → exit 1, `OD_REGISTER_TOKENS_DIVERGED`, o sistema volta a rascunho (`PATCH … {"status":"draft"}`) e o protótipo **não** deve rodar. O hash de contrato que o daemon lê do `manifest.json` também é conferido (`OD_REGISTER_MANIFEST_DIVERGED`).

Códigos estáveis: `OD_REGISTER_CONSENT_REQUIRED`, `OD_REGISTER_INPUT_INVALID`, `OD_REGISTER_NO_TARGET`, `OD_REGISTER_INSECURE_TARGET` (o token só vai a hosts loopback, salvo `--allow-remote`), `OD_REGISTER_DAEMON_UNREACHABLE`, `OD_REGISTER_AUTH_REQUIRED`, `OD_REGISTER_ID_MISMATCH`, `OD_REGISTER_MANIFEST_ID_MISMATCH`, `OD_REGISTER_DAEMON_REJECTED`, `OD_REGISTER_LAYOUT_MISSING`, `OD_REGISTER_COPY_FAILED`, `OD_REGISTER_TOKENS_UNREADABLE`, `OD_REGISTER_TOKENS_DIVERGED` e `OD_REGISTER_MANIFEST_DIVERGED`, cada um com `remediation`.

**Limite honesto:** o passo 2 escreve em um diretório que o daemon possui. Isso **não é API pública** e foi validado só no daemon **0.22.1**; a versão (`/api/health`) fica em `statePatch.designRegistrations[<id>].daemonVersion` e a ausência do diretório esperado é a recusa `OD_REGISTER_LAYOUT_MISSING` com remediação (apontar o `--data-dir` certo ou usar uma versão validada), nunca um registro parcial silencioso. O daemon do host leva de 10 a 30 s para responder no primeiro start. O script **nunca** dispara `od run start`: o run consome tokens, exige o aceite explícito e usa o agente escolhido em `AgenteDesign` (`od run start --daemon-url <url> --project <id> --agent <designAgent.id>`). Mesmo com o registro verbatim o protótipo é **uma execução de um agente não determinístico**: continua opcional e consultivo, e a fidelidade é garantida pelos gates do Orquestrador/Executor e pelo probe do Testador (evidência: subseção 10.10.2 do plano, 23 de 23 tokens em cada tema).

### Onboarding de agentes (claude / codex / antigravity)

O onboarding do Open Design detecta um agente de código probing seu **binário no PATH do processo do daemon** (`apps/daemon/src/runtimes/executables.ts → resolveOnPath`). Por isso o daemon do cc-pensador roda **sempre no host**, onde `process.env.PATH` é o PATH real do usuário: um daemon em container Linux não enxerga nem executa os binários do host (`claude.cmd` / `codex.cmd` / `agy.exe`) e reportaria `available: false` para os três, então o Docker **não é suportado**.

O cc-pensador resolve isso em três peças:

- **`scripts/od-onboard-agents.mjs`** (núcleo determinístico, testado em `test/onboard-agents.test.js`): localiza o path de cada agente (PATH walk que espelha o `resolveOnPath` do Open Design, honrando `PATHEXT` no Windows; aceita overrides `--claude-bin`/`--codex-bin`/`--agy-bin`) e grava os overrides que o Open Design entende no `app-config.json` do daemon **local** (`<clone>/.od/app-config.json`):
  - `claude → agentCliEnv.claude.CLAUDE_BIN` e `codex → agentCliEnv.codex.CODEX_BIN` (chaves da allowlist em `apps/daemon/src/app-config.ts`).
  - **`antigravity` não tem chave `*_BIN`** (o `bin` é `agy`): é resolvido **por PATH**, então o script reporta o diretório do `agy` em `pathAdditions` para o launcher prepender ao PATH do daemon. Com `--verify <daemon-url>` consulta `/api/agents` e confirma `available`.

- **`scripts/onboard-open-design-agents.ps1|.sh`** (orquestrador): registra os agentes e, com `--launch`/`-Launch`, garante deps + build do daemon local, aplica a **guarda de porta**, não sobe um segundo daemon se já houver um respondendo e sobe `node apps/daemon/dist/cli.js` com `CLAUDE_BIN`/`CODEX_BIN` setados e o diretório do `agy` prependido ao PATH — então verifica `/api/agents` (por `127.0.0.1`). Com `--foreground`/`-Foreground` o script só retorna quando o daemon encerra (para um supervisor reiniciá-lo).

- **`scripts/register-open-design-daemon-task.ps1`** (Windows): registra uma **Tarefa Agendada por usuário** (`OpenDesignDaemon`, sem administrador) que roda `onboard-open-design-agents.ps1 -Launch -SkipBuild -StopLegacyContainer -Foreground` oculto a cada logon, reinicia até 5 vezes (1 min) se o daemon cair e não tem limite de tempo. Sem ela o daemon é um processo solto que morre no reinício da máquina. `-StartNow` inicia na hora; `-Unregister` remove. No macOS/Linux use `launchd`/`systemd --user` chamando `bash scripts/onboard-open-design-agents.sh --launch --skip-build --foreground`.

**Guarda de porta.** Um container Docker `open-design` antigo pode continuar segurando a 7456 (e o Docker Desktop pode religá-lo no boot, se a política de restart for `always`/`unless-stopped`). Ele responde à API mas não vê nenhum agente do host, então é tratado como conflito, não como daemon utilizável:

- o `preflight.mjs` (`integrations.openDesign`) devolve `reasonCode: "LEGACY_CONTAINER_DAEMON"`, `available: false`, `daemon.where: "container"` e `portConflict: { container, port, remediation[] }` (`docker stop`, `docker update --restart=no`, subir o daemon do host); o bloco `legacyContainer` substitui o antigo `docker`. `OD_PREFLIGHT_DISABLE_DOCKER=1` desliga a consulta;
- o onboarding recusa subir o daemon enquanto o container segurar a porta, a menos que receba `-StopLegacyContainer`/`--stop-legacy-container` (alias `-StopDocker`/`--stop-docker`), que faz `docker stop` **e** `docker update --restart=no` para ele não voltar sozinho.

O instalador (`install-open-design.ps1|.sh`) chama tudo isso e, no Windows, registra a tarefa com `-Autostart`.

> **AMR embutido (upstream 0.9.0+, não verificado ao vivo):** o Open Design passou a empacotar seu próprio runtime de modelo (`vela`/AMR), com login em `~/.amr`, eliminando a necessidade de configurar uma API key separada só para o app funcionar. O onboarding acima continua relevante para **claude/codex/antigravity como agentes de código** (a integração deste plugin), não para o AMR em si.
>
> **Outros adapters de agente relevantes ao workspace (documentação apenas — fora de escopo aqui):** o upstream também suporta `kiro` e `antigravity` como adapters nativos — os dois bridge plugins deste workspace (`cc-kiro-plugin`, `cc-antigravity-plugin`). Não há wiring cruzado hoje; ficaria a cargo de um plano futuro se fizer sentido.

### Se o usuário escolher "Seguir sem" (Opção B)

O Pensador escreve `design-system.md` inline, preenchendo as 9 seções do schema `DESIGN.md` a partir do brief coletado, e registra que foi gerado sem o Open Design.

Quando a demanda **não** tem front-end (`hasFrontend = false`), o Open Design não é relevante e nenhuma pergunta é feita.

---

## Leitura relacionada

- `references/stages.md`: BRAINSTORM_GERAL (lente de UI/UX) e FINAL (artefatos).
- `references/imagery.md`: contrato de imagery/iconografia — o Pensador e o unico proprietario das decisoes e artefatos visuais; o Orquestrador so materializa `resolved/assets/manifest.json`, nunca pergunta nem gera imagem.
- `references/skill-stack.md`: skills como lentes de domínio; Open Design como motor de design.
- `references/codebase-memory.md`: padrão de oferta de instalação via `AskUserQuestion`.
- `references/feature-isolation.md` e `references/handoff-contract.md`: role `design-system-files` (pacote gerado, inclui `DESIGN.md`) e o `design-system.md` de fallback.
- `skills/prd/SKILL.md`: seção **Design System & UI/UX** do `Strict_PRD_Schema`.
- `scripts/od-onboard-agents.mjs` + `scripts/onboard-open-design-agents.ps1|.sh`: onboarding dos agentes do host (claude/codex/antigravity) num daemon local — ver a seção **Onboarding de agentes** acima.
# Contrato resolved (v2.22)

O Pensador produz `design-systems/<id>/source/` (proveniência do engine: `brand.json`, `seed.json`, saída bruta e `engine-run.json`) e `design-systems/<id>/resolved/` como a única autoridade. Não existe `original/` nem cópia verbatim de catálogo. O resolved contem `design-contract.json` (v2, com `sha256`), `tokens.css` (`:root` claro, `[data-theme="dark"]`, `prefers-color-scheme`), `design-tokens.json` (W3C DTCG), `tailwind-v4.css` (`@theme`), `DESIGN.md` (front matter normativo + 9 seções), `components.html`, `components.manifest.json`, `preview/` (index, colors, typography, spacing, components, app; nos dois temas), `USAGE.md`, `manifest.json` (`od-design-system-project/v1`), `assets/manifest.json`, `design-audit.json` e `provenance.json` (hash do contrato e de cada arquivo). Tudo é renderizado do contrato por `design-package.mjs render`; nada é copiado de fora. Quando o brand engine não está disponível o DESIGN fecha como `BLOCKED`; o fallback de apenas `design-system.md` foi removido.

## Pipeline Generativo e Discovery Visual (v2.23)

O Open Design no Pensador evoluiu de uma tabela de tokens para um motor ativo de design generativo integrado ao estágio `DESIGN`:

### 1. Geração de Brand Assets com Contexto Semântico do Setor
- Baseado no `sectorContext` definido no `RESEARCH` (ex.: oficina automotiva, SaaS financeiro, e-commerce pet), são gerados assets de mídia reais (SVGs vetoriais para logos e ícones de serviços, imagens rasterizadas para banners e cards).
- Os assets são persistidos em `<featurePath>/assets/` e indexados no `<featurePath>/assets/manifest.json`.
- Cada asset possui SHA-256 verificado, rota, slot de componente e dimensões semânticas, eliminando placeholders e links quebrados no downstream.

### 2. Fixtures de Componentes em `components.html`
- O arquivo `components.html` serve como a especificação visual viva de todos os componentes do sistema (Botões, Cards, Inputs, Badges, Modais) renderizados nos 4 estados obrigatórios: `default`, `hover`, `focus` e `disabled`.
- O Pensador sempre gera as fixtures deterministicamente a partir do `design-contract.json` (`design-package.mjs render`); elas usam só `var(--token)`, sem hex nem valor de fallback, e aparecem nos dois temas.

O preflight detecta CLI `od` real (ignorando GNU coreutils), MCP estruturado e REST por `OD_DAEMON_URL`/MCP/`<clone>/.env`/porta 7456 (sempre por `127.0.0.1`). `401/403` significa `AUTH_REQUIRED`; um container Docker legado sem endpoint significa `DETECTED_UNREACHABLE` e um que segura a porta que respondeu significa `LEGACY_CONTAINER_DAEMON`; nesses casos nao se oferece reinstalacao, e sim subir o daemon do host. O token vem de `OD_API_TOKEN` ou de `<clone>/.env` (o loopback do host nao exige) e nunca aparece em stdout, logs ou snapshots.

A precedencia de sintese e: escolhas explicitas do usuario, PRD/criterios e prosa. Os valores de token vem do brand engine (nunca do AGY); o AGY escreve apenas o inventario de componentes, layouts, iconografia, imagery, microcopy, anti-patterns e a justificativa textual (`rationale`); renderizadores deterministas derivam CSS/JSON/Markdown; Codex audita read-only. Sao permitidas duas correcoes automaticas. Finding alto/critico bloqueia o handoff.
