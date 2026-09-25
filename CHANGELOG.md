# Changelog

## [2.38.0] — 2026-09-25 — Protótipo do Open Design obrigatório (`design-prototype`), `components.css` no pacote e RNF/ARC no `requirements.json`

- **Novo role `design-prototype`:** `HANDOFF_ROLES_BY_STAGE.pensador` (`scripts/lib/handoff-validator.mjs`) e a tabela de roles do Pensador em `references/handoff-contract.md` (byte-idêntica nos quatro plugins) ganham o role `design-prototype` (`prototypes/`) — o protótipo interativo (HTML/CSS/JS) que um agente de design do Open Design gera no estágio DESIGN, referência de fidelidade visual para o Orquestrador reproduzir as telas na stack de front-end definida pelo PRD. **O Open Design só gera HTML/CSS/JS**: não há conversão mecânica para a linguagem de destino — a reprodução é delegada ao AGY como parte da própria implementação das tasks front-end (ver `cc-orchestrador-subagents` 4.25.0), não um script determinístico de transpilação.
- **`planArtifacts()`/`buildArtifactList()`:** `designPrototype` passa a `hasFrontend && usesOpenDesign` (antes considerava também `state.designAgent` isoladamente, o que permitia o artefato aparecer mesmo com o agente pulado).
- **Agente do design deixa de ter opção de pular:** `design-brief.mjs agent` (`agentCommand`) chama `resolveDesignAgent` sempre com `requireAgent: true` — `--choose none` é recusado (`design-agent-required`/`select-an-available-design-agent`), nunca um skip silencioso. Mandatório **sempre que o Open Design for usado** com front-end; sem nenhum agente `available`, o Pensador bloqueia e pergunta como instalar/autenticar um agente em vez de seguir sem protótipo. `preflight.mjs`, `commands/pensador.md`, `SKILL.md` e `references/open-design.md` perdem a opção "Nenhum (pular protótipo)" e recuperam a linguagem de aceite explícito (`od run start` continua exigindo uma segunda pergunta separada — a escolha do agente não é o consentimento de custo).
- **Gate de fechamento do DESIGN:** `validateVisualCompleteness()` passa a exigir o role `design-prototype` para `status: DONE` sempre que `design-system-files` estiver presente (`MISSING_DESIGN_PROTOTYPE_FOR_DONE_STATUS`) — o fallback inline (`design-system`, sem Open Design) continua sem exigir protótipo.
- **Removido o termo "Cenário 2 exclusivo"** (não definido em lugar nenhum do plugin) da prosa nova; a condição é descrita em termos concretos (Open Design em uso, com front-end).
- **Testes:** `test/handoff-validator.test.js` (rejeita DONE com `design-system-files` sem `design-prototype`; aceita o fallback sem exigir o role) e `test/design-agents.test.js` (`agentCommand` recusa `none`).

### `components.css` no pacote de design (auditoria da run OficinaAI)

- **Achado:** as regras de `.btn`, `.card`, `.input`, `.badge`, `.alert`, `.modal` existiam só dentro de `components.html`/`preview/preview.css`; o front-end da run OficinaAI (2026-09-22) chegou ao build final com Button/Card/Input/Dialog sem estilo — typecheck, lint e build passaram.
- **`design-render.mjs`/`design-package.mjs`:** o render gera `components.css` (só as regras de produto e seus estados; nada do andaime do preview, cujo `.grid` é `display:flex` e quebra o utilitário `grid` do Tailwind) e ele entra em `REQUIRED_PACKAGE_FILES`. `preview.css` continua byte a byte igual. `USAGE.md` e `manifest.json` apontam para ele; `componentStyleCoverage()` lista no `USAGE.md` e no cabeçalho do `components.css` os componentes do contrato sem regra dedicada (construídos a partir dos tokens).
- **`od-register.mjs`:** `components.css` entra na sobreposição do `resolved/` no daemon, para o protótipo gerado pelo agente usar a mesma folha de componentes do produto.
- **Efeito colateral:** um `resolved/` renderizado antes desta versão reprova em `structure`/`integrity` se for reauditado — rode `design-package.mjs render` de novo.
- **Contrato:** a seção 6 do `handoff-contract.md` (byte-idêntica nos quatro plugins) lista `components.css` no layout do `resolved/` e define que ela é a única folha de componentes importável.

### `requirements.json` passa a indexar RNF e padrões de arquitetura

- **Achado:** o índice só carregava RF/CA; na run OficinaAI os RNF (performance, isolamento por tenant) e os padrões que o próprio PRD declarou (Repository + UnitOfWork, stack de testes) não tiveram task nem evidência, e nada acusou.
- **`requirements-extractor.mjs`:** novas listas irmãs `nonFunctionalRequirements` (`RNF-XX`, seção 7) e `architecturePatterns` (ids sintéticos `ARC-01`… na ordem da tabela da seção 15); `requirements`/`acceptanceCriteria` mantêm a forma anterior. Avisos `NO_NON_FUNCTIONAL_REQUIREMENTS_PARSED`/`NO_ARCHITECTURE_PATTERNS_PARSED` degradam sem lançar.
- **Contrato:** a linha `requirements-index` do `handoff-contract.md` documenta as duas listas e a exigência de task + evidência para RF/RNF/ARC (consumida pelo `cc-orchestrador-subagents` 4.25.0).
- **Testes:** `test/requirements-extractor.test.js` (7 casos novos) e `test/design-package.test.js`.

### Componentes com regra real, review do design registrada e contrato de API executável

- **Componentes:** `design-render.mjs` ganha `componentKind()` (nomes exatos EN/pt-BR e sufixos — `ServiceCard` → card, `StatusPill` → badge, `PhoneInput` → input) e regras de produto no `components.css` para ~30 tipos (icon-button, textarea, select, form field, checkbox, radio, switch, carrossel, tabela, abas, toast, sidebar, topnav, estado vazio, skeleton, stepper, tooltip, avatar, paginação, breadcrumb, progresso, spinner, acordeão, menu), com fixtures por estado no `components.html`. No contrato real da run OficinaAI, 18 de 24 componentes eram um placeholder cinza genérico e o audit dava PASS; agora os 24 têm regra. O cabeçalho do `components.css` lista as classes (`COMPONENT_CLASSES`) e os componentes sem regra.
- **`checks.componentCoverage`** no `design-audit.json` (`PASS`/`WARN`, não bloqueante): componente sem tipo conhecido vira `COMPONENT_WITHOUT_RULES` (severidade `medium`).
- **Review do design amarrada ao contrato:** `design-package.mjs review --dir <resolved> --verdict PASS|FAIL --reviewer codex [--report] [--blocking-findings N]` grava `resolved/design-review.json` (`contractSha256`, `verdict`); recusa `PASS` com achado bloqueante ou sem audit `PASS` do mesmo contrato. O gate do DESIGN exige review `PASS` do contrato atual (`DESIGN_REVIEW_MISSING`/`_STALE`/`_NOT_PASS`) e o handoff só declara `validation.status: PASS` com audit **e** review `PASS` (`UNREVIEWED`/`FAIL` caso contrário; `validation.review`, `auditStatus`, `reviewStatus`). Uma run real fechou o handoff com `PASS` enquanto o próprio resumo dizia que a auditoria do Codex tinha reprovado o pacote.
- **Contrato de API:** o comando `validate` do handoff passa a `st run openapi.yaml --url <base-url>` (Schemathesis precisa da URL base para um schema em arquivo; `schemathesis run openapi.yaml` nunca era executável e nunca rodou).
- **Contrato compartilhado (`handoff-contract.md`, 4 plugins):** seção 6 com `validation.review` e a regra PASS = audit + review; `components.css` descrito por tipos.
- **Investigado e sem defeito:** o DESIGN da run OficinaAI levou 64 de 120 min, mas 43 min foram espera pela resposta do usuário a um `AskUserQuestion` ("Imagens"), não processamento.
- **Testes:** `test/design-gates.test.js` (review registrada, cobertura de componentes dos 24 do contrato real, WARN não bloqueante), `test/stage-gate.test.js` (`DESIGN_REVIEW_*`), `test/artifacts.test.js` (PASS só com audit + review), `test/integrations.test.js`, `test/design-e2e-real.test.js`.

- **Motivo:** o protótipo e a Critique do Open Design só rodam com um agente de código que exista no ambiente do daemon. Um daemon em container Linux não enxerga o `claude.cmd`/`codex.cmd`/`agy.exe` do host, então o `AgenteDesign` sempre caía em `agent-not-visible-to-daemon`. Em vez de um proxy de processo entre container e host (SSH/shims, caminhos e PTY frágeis), o daemon passa a rodar **no host**, e o Docker sai do plugin.
- **Removido (breaking para quem usava Docker):** o instalador via `docker compose` (`install-open-design.ps1|.sh` reescritos), `od-brand-build.mjs --engine container` e `--container`, `OD_CONTAINER`, `design-brief.mjs brand-url --container`, `od-register-system.mjs --container/--container-data-dir` (`dockerTarget`), o probe `command -v` dentro do container (`probeContainerAgents`), o `installCommands.docker` e a leitura do `~/.open-design/deploy/.env`. `deriveWithEngine({ engine: "container" })` lança `TypeError` explícito; `auto` e `clone` são a mesma cadeia (`clone → BLOCKED`).
- **Brand engine e URL da marca a partir do clone do host:** o passo `container` da cadeia saiu. A proposta por URL (`deriveSeedFromUrl`) agora roda o `build.js` compilado do clone (`<clone>/apps/daemon/dist/brands/engine/build.js`, com as dependências do próprio clone) e devolve `CLONE_NOT_BUILT` se o daemon não foi compilado. Verificado ao vivo: `https://stripe.com` → `#533AFD` / `sohne-var`, o mesmo resultado que o container dava.
- **Instalador no host:** `install-open-design.ps1|.sh` verificam git, Node >= 22.6 (o Open Design pede 24) e corepack, clonam/atualizam `~/.open-design`, delegam ao `onboard-open-design-agents` (registra claude/codex/antigravity, `pnpm install` + build, sobe o daemon) e conectam o MCP. Novos parâmetros: `-SkipLaunch`, `-StopLegacyContainer`, `-Autostart` (Windows); saem `-SkipOnboardAgents` e o token gerado.
- **Guarda de porta contra container legado:** o `preflight.mjs` (`integrations.openDesign`) devolve `reasonCode: "LEGACY_CONTAINER_DAEMON"`, `available: false`, `daemon.where: "container"` e `portConflict: { container, port, remediation[] }` quando um container `open-design` publica a porta que respondeu (o bloco `docker` virou `legacyContainer`; `OD_PREFLIGHT_DISABLE_DOCKER=1` continua desligando a consulta). `resolveDesignAgent` recusa com `stop-legacy-container` + `start-host-daemon`; `DESIGN_AGENT_LOCATIONS` é só `host`. O onboarding recusa subir o daemon com um container segurando a porta, salvo `-StopLegacyContainer`/`--stop-legacy-container` (alias `-StopDocker`), que faz `docker stop` **e** `docker update --restart=no` para o Docker Desktop não religá-lo no boot. Também não sobe um segundo daemon se já houver um respondendo (idempotente).
- **Token do daemon local:** o daemon do host em loopback **não exige token** (a autenticação só liga se `OD_API_TOKEN` estiver definido para ele; `GET /api/agents` sem cabeçalho devolve 200). `odApiToken()` lê `OD_API_TOKEN` e, depois, `<clone>/.env` (`OD_CLONE_DIR` relocaliza); sem nenhum dos dois segue sem `Authorization`. `od-register-system.mjs` ganhou `--data-dir` padrão `~/.open-design/.od` (ou `OD_DATA_DIR`).
- **Tarefa Agendada no Windows:** novo `scripts/register-open-design-daemon-task.ps1` registra `OpenDesignDaemon` por usuário (sem administrador): a cada logon roda oculto `onboard-open-design-agents.ps1 -Launch -SkipBuild -StopLegacyContainer -Foreground`, reinicia até 5 vezes (1 min) se cair, sem limite de tempo. `-StartNow` inicia na hora, `-Unregister` remove. O onboarding ganhou `-Foreground`/`--foreground` (só retorna quando o daemon encerra) para o Agendador ou um supervisor `systemd`/`launchd` reiniciarem.
- **Correção — `localhost` recebe 403:** o daemon trata `localhost` como a origem de "powered preview" e recusa a maioria das rotas de API a requisições com cabeçalhos `Sec-Fetch-*` (o `fetch` do Node os envia): `onboard --verify http://localhost:7456` voltava `daemon 403`. Os scripts de instalação/onboarding e o `od-mcp-config.mjs` usam `127.0.0.1`; `preflight` e `od-register` normalizam `localhost` → `127.0.0.1`.
- **Migração de quem tinha o Docker:** `docker stop open-design && docker update --restart=no open-design`, depois `scripts/install-open-design.ps1 -StopLegacyContainer` (ou só `onboard-open-design-agents.ps1 -Launch -StopLegacyContainer`). O volume Docker (`/app/.od`) **não** é migrado: rode `od-register-system.mjs` de novo para os design systems que precisar no daemon do host (ou copie o volume com `docker cp open-design:/app/.od/. ~/.open-design/.od/` antes de subir o daemon do host).
- **Docs:** `SKILL.md`, `commands/pensador.md`, `references/open-design.md` (seções de derivação, instalação, `AgenteDesign`, registro, onboarding e guarda de porta) e `references/agent-stack.md`; READMEs EN/pt-BR.
- **Testes:** reescritos `brand-engine` (cadeia só-clone, `--engine container` recusado), `brand-url` (clone compilado, `CLONE_NOT_BUILT`), `od-register` (`--data-dir` padrão, `localhost` → `127.0.0.1`), `design-agents` (daemon no host, container legado recusado), `integrations` (`installCommands` sem Docker) e `open-design-runtime` (token de `<clone>/.env`, `deploy/.env` ignorado, guarda de porta, isolamento do daemon real da 7456).

## [2.36.0] — 2026-09-19 — Registro verbatim do design system no daemon do Open Design

- **Achado (subsecao 10.10.2 do plano):** `od design-systems import-local` reescaneia a fonte e regenera o `tokens.css`; o daemon serve uma paleta generica e o agente inventa o tema escuro (claro 31 de 56 tokens identicos, escuro 0 de 16). Registrando o `resolved/` no layout nativo, o protótipo reproduziu 23 de 23 tokens em cada tema, 44 de 44 no bloco base e 0 hex fora de token.
- **Novo `scripts/od-register-system.mjs` (+ `scripts/lib/od-register.mjs`):** `--dir <featurePath>/design-systems/<id> --daemon-url <url> (--data-dir <dir> | --container <nome>) --accepted`. `POST /api/design-systems` (`status: published`, id = slug do titulo = `manifest.json` id), sobrepoe o `resolved/` (incl. `tokens.css` sobre `colors_and_type.css` e `preview/`) e **le de volta pelo daemon**: recusa (exit 1, `OD_REGISTER_TOKENS_DIVERGED`) se o `tokens.css` servido nao for byte a byte o do `resolved/` e devolve o sistema a rascunho. Confere tambem o `contractSha256` do manifest lido pelo daemon (`OD_REGISTER_MANIFEST_DIVERGED`).
- **Codigos estaveis com remediacao:** `OD_REGISTER_CONSENT_REQUIRED`, `_INPUT_INVALID`, `_NO_TARGET`, `_INSECURE_TARGET`, `_DAEMON_UNREACHABLE`, `_AUTH_REQUIRED`, `_ID_MISMATCH`, `_MANIFEST_ID_MISMATCH`, `_DAEMON_REJECTED`, `_LAYOUT_MISSING`, `_COPY_FAILED`, `_TOKENS_UNREADABLE`, `_TOKENS_DIVERGED`, `_MANIFEST_DIVERGED`.
- **Aceite e seguranca:** grava estado no daemon, entao exige `--accepted` (pergunta `RegistroOD`); **nunca** dispara `od run start`. O token vem de `OD_API_TOKEN` ou do `.env` do OD, nunca e impresso e so e enviado a hosts loopback (`--allow-remote` para o resto). Daemon no host: `--data-dir`; daemon em Docker: `--container` (`docker exec` + `docker cp`).
- **Limite honesto:** a sobreposicao escreve em diretorio interno do daemon, que **nao e API publica** (validada so no 0.22.1). A versao (`/api/health`) e registrada e a ausencia do diretorio esperado e a recusa `OD_REGISTER_LAYOUT_MISSING`, nunca um registro parcial silencioso.
- **Estado:** `state.designRegistrations[<id>] = { registeredAt, daemonWhere, daemonVersion, contractSha256, tokensBytes }` (o CLI imprime o `statePatch`).
- **Docs:** `SKILL.md` (bullet do prototipo opcional e a linha de DESIGN do mapa de scripts) e `references/open-design.md` (nova secao "Registro do design system no daemon") trocam `import-local` pelo procedimento, anotam que o daemon do host leva de 10 a 30 s no primeiro start e que o agente escolhido em `AgenteDesign` e o do `od run start --agent`; READMEs EN/pt-BR.
- **Testes:** `test/od-register.test.js` com daemon simulado por injecao (ok, tokens divergentes, layout ausente, token ausente, mais consentimento, id, host remoto, cópia via Docker e a garantia de que nenhum `run` e disparado).

### Tambem na 2.36.0 — Testes estaveis sob carga (so testes e config)

- **Causa:** o timeout padrao de 5s do Vitest e os timeouts de deteccao de 100ms e 500ms nos testes eram curtos demais para suites que criam subprocessos reais (`node` do engine, `docker exec`, `runPreflight` completo) em workers paralelos. Reproduzido com 6 instancias de `vitest --run` em paralelo: 18 de 18 rodadas falharam (`Test timed out in 5000ms`, com testes levando de 5 a 27s), mais uma falha que nao era timeout em `Open Design REST preflight` (`timeoutMs: 100` no fetch do endpoint local).
- **Correcao:** `vitest.config.js` com `testTimeout` e `hookTimeout` de 60s (so limita um teste travado, nao atrasa um saudavel); `timeoutMs` de 100 e 500 para 5000 em `open-design-runtime.test.js` e `design-agents.test.js` (o endpoint local responde na hora, entao nao ha custo).
- **Prova:** 42 de 42 rodadas verdes com 6 instancias em paralelo (antes: 18 de 18 falhas nas mesmas condicoes). `npm test` isolado: 835 passam, 2 puladas.

## [2.35.0] — 2026-09-19 — Vinculo do agente do design (`AgenteDesign`)

- **Deteccao no preflight (`integrations.designAgents`):** somente leitura, sem segredos e sem gravar estado. Agentes do host (`claude`, `codex`, `gemini`, `opencode`, `cursor-agent`, `qwen`; `agy`/`kiro-cli` so quando os plugins irmaos estao instalados) por PATH, e o que o daemon do Open Design enxerga por `GET /api/agents` (ou, sem token, `command -v` dentro do container). Saida: `agents[]` com `id`, `where` (`host`|`container`), `available`, `authenticated`, `source`; so os `available` entram, `undetectedCount` conta o resto. `daemonWhere` diz onde o daemon roda (o `docker ps` passou a ser consultado tambem quando o REST autentica, porque antes um daemon em Docker era classificado como `host`).
- **Engine (funcoes puras):** `resolveDesignAgent(agents, choice, { daemonWhere, now })` recusa com `agent-not-visible-to-daemon` (e as duas remediacoes: instalar/autenticar no ambiente do daemon, ou mover o daemon) o agente que existe so no host com daemon no container, ou o inverso; `validateDesignAgent` valida `state.designAgent` (`null`, `{ id: "none" }` ou `{ id, where, chosenAt }`); `DESIGN_AGENT_HEADER = "AgenteDesign"`. `initState` ganhou `designAgent: null`: sem escolha, prototipo e Critique ficam desligados.
- **CLI:** `design-brief.mjs agent --agents <preflight.json> --choose <id|none> [--daemon-where host|container]` imprime `statePatch.designAgent` (exit 1 com `remediations` quando recusa).
- **Fluxo:** com front-end e ao menos um agente disponivel, o Pensador pergunta uma vez antes do DESIGN via `AskUserQuestion` (`header: "AgenteDesign"`, opcoes = agentes detectados + "Nenhum (pular prototipo)"), grava a escolha e usa `--agent <id>` no `od run start`, so apos o aceite explicito do usuario (o run consome tokens). O hook `track-questions.mjs` continua registrando so o cabecalho.
- **Correcao:** `design-brief.mjs` e `preflight.mjs` perderam o shebang. O Vite move os imports para o topo e deixava `#!/usr/bin/env node` na linha 17 do codigo transformado (`SyntaxError`) assim que um teste importava o modulo com mais imports; ambos sao sempre chamados como `node <script>`.
- **Docs:** `SKILL.md`, `commands/pensador.md`, `references/open-design.md` (secao "Vinculo do agente do design"), READMEs EN/pt-BR e a subsecao 10.10 do plano. Testes: `test/design-agents.test.js` (PATH, `fetch`, Docker e `exec` injetados).

## [2.34.0] — 2026-09-19 — Aprovacao assinada com HMAC e chave por usuario

- **Assinatura HMAC-SHA256:** `.pensador-approval.json` (schemaVersion 2) deixa de usar o nonce gravado no workspace, que qualquer um que lesse o arquivo reproduzia. A prova agora e HMAC-SHA256 com uma chave por usuario fora do projeto (`%LOCALAPPDATA%/pensador/approval.key` no Windows, `~/.pensador/approval.key` nos demais; `PENSADOR_APPROVAL_KEY_DIR` sobrescreve), criada com permissao restrita (arquivo 0600, diretorio 0700) pelo primeiro `design-brief.mjs approve`, nunca impressa nem gravada em estado, handoff ou registro. Assina id do design system + `contractSha256` + hash do brief + `approvedAt` (+ flag `unverified`).
- **Sem chave, sem modo fraco:** o `stage-gate` falha com `DESIGN_APPROVAL_KEY_MISSING` (outra maquina, CI) e a remediacao e aprovar de novo naquela maquina. Registros no formato antigo (nonce) falham como `DESIGN_APPROVAL_FORGED`; assinatura para outro sistema falha como `DESIGN_APPROVAL_STALE`.
- **Guard:** o PreToolUse agora tambem cobre `Read`, `Grep` e `Glob` e bloqueia qualquer chamada que cite `approval.key` (Read/Grep/Glob/Edit/Write/MultiEdit e shell, leitura inclusa).
- **Limite residual (honesto):** quem executa codigo arbitrario como o mesmo usuario do SO le a chave e consegue assinar; o guard fecha os caminhos das ferramentas, nao um atacante local determinado. A chave protege contra edicao manual do workspace, nao contra comprometimento da conta.
- **Testes:** `test/approval-key.test.js` (chave, assinatura valida, chave ausente/de outro usuario, campo alterado, brief/contrato alterados depois), casos novos no `stage-gate` e no guard; `vitest.config.js` aponta a chave dos testes para um diretorio temporario.

## [2.33.0] — 2026-09-19 — Aprovacao assinada, URL da marca e teste real do engine (pendencias das Fases 0 a 5)

- **Aprovacao nao forjavel:** `design-brief.mjs approve` agora exige a pergunta `AskUserQuestion` com `header: "AprovDesign"` registrada pelo hook no DESIGN (`approval-question-not-observed`; `--unverified` so onde os hooks estao desligados) e grava, alem de `approvedAt`/`approvedSha256`, o registro `.pensador-approval.json` (hash do contrato + hash do brief + nonce + prova). O `stage-gate` reprova aprovacao digitada a mao (`DESIGN_APPROVAL_UNSIGNED`), prova invalida (`DESIGN_APPROVAL_FORGED`) e brief ou contrato alterado depois da aprovacao (`DESIGN_APPROVAL_STALE`); em modo estrito so conta a pergunta com o cabecalho de aprovacao (`DESIGN_APPROVAL_NOT_OBSERVED`). O hook `track-questions` passa a registrar os `headers` (nunca as respostas).
- **Guard:** o PreToolUse bloqueia Edit/Write/MultiEdit e escritas de shell em `design-brief.json` (dentro de `.pensador/`) e `.pensador-approval.json`.
- **URL da marca (opcional):** novo campo `brandUrl` no brief e subcomando `design-brief.mjs brand-url`, que roda o `buildFromUrl` do proprio engine (sem LLM) no container e grava `source/brand-url.json` com a proposta de `colorPrimary`/`fontFamily`, confirmada pelo usuario antes de entrar no seed; campo travado nunca e sobrescrito. Verificado contra o daemon real (0.22.1); o clone nao roda esse caminho (sem `node_modules`).
- **Verificado e documentado:** `build.ts` completo (`buildBrandSystem` usa so `seedFromBrand`, como na Fase 0) e a CLI real `od` (`docker exec open-design node /app/apps/daemon/bin/od.mjs`; o `od` do PATH e o BusyBox). `project create`/`run start` gravam estado no daemon e acionam um agente: nao foram executados e continuam opcionais.
- **Teste de ponta a ponta real:** `test/design-e2e-real.test.js` (brief → seed → engine real → render → audit → aprovacao → gate), que pula quando nem o container nem o clone rodam o engine.
- **Corrigido:** o import da CLI `design-brief.mjs` no Vitest quebrava com crases em comentario de cabecalho.

## [2.32.0] — 2026-09-19 — Contrato de handoff do design system (Fase 6 do plano)

Fase 6 do plano de design system: a secao 6 do `handoff-contract.md` (byte-identica nos 4 plugins) e reescrita para o pacote `resolved/` como unico normativo, `source/` como proveniencia do engine e politica de mudanca de token (`DESIGN_CHANGE_REQUEST`).

- **Contrato:** `design-system-files` aponta para `design-systems/<id>/resolved/` (unico pacote normativo); `source/` guarda so a proveniencia do engine; nao existe mais `original/` nem verbatim de catalogo. Front matter do `DESIGN.md` e normativo, a prosa nao. `materializeInto` = `<uiPackageDir>/design-systems/<id>/`.
- **Novos campos da entrada:** `contractSha256` (sha256 hex ou `null`), `themes` (inclui `light` e `dark`), `designBriefPath` (relativo ao `artifactRoot`), alem de `variant`, `authoritative`, `sourcePath`, `assetsManifest` e `validation.{status,audit}` no schema.
- **Politica de token:** token novo so por nova versao do Pensador; a correcao que o exigir registra `DESIGN_CHANGE_REQUEST`.
- **Validador:** `validateHandoff()` rejeita `contractSha256` malformado (`INVALID_CONTRACT_SHA256`), `themes` sem `light`/`dark` (`INVALID_DESIGN_THEMES`) e `designBriefPath` vazio (`INVALID_DESIGN_BRIEF_PATH`) em entradas `resolved`; fixture e casos de teste em cada um dos 4 plugins.

## [2.31.0] — 2026-09-19 — Design system derivado do brief: brief, engine, render e gates (Fases 2 a 5 do plano)

O brief coletado no BRAINSTORM_GERAL deixa de ser um descritor de destinos e passa a ser um contrato persistido e executavel. Os tokens deixam de ser escritos pelo AGY: saem do brand engine do Open Design e todo arquivo do pacote e renderizado do contrato. Os gates do DESIGN passam a ser mecanicos e a aprovacao visual fica registrada no brief.

- **Novo:** `buildDesignBrief()` (respostas do `AskUserQuestion` → campos `{ value, locked, questionRef }`; campo desconhecido ou valor invalido vai para `issues`, nunca vira default silencioso), `briefToSeed(brief, proposals)` (funcao pura: travado ▸ proposta do AGY ▸ valor nao travado ▸ default do engine; so os 20 campos do `SeedToken`; `colorInfo` sempre explicito; `provenance` por campo), `designBriefPath()`, `state.designBriefPath` e `skills/pensador/assets/design-brief.schema.json` (`approvedAt`/`approvedSha256` reservados para a aprovacao visual da Fase 5).
- **Brief:** `openDesignBriefPlan()` ganha `themeDefault` (`light|dark|system`) e `themeExposure` (`toggle|system|light-only`). Presets de densidade (`compact|comfortable|spacious` → `controlHeight` 28/32/40, grade 4px) e movimento (`none|subtle|standard`).
- **Removido:** `openDesignBriefRouting()` (destinos `selection|input|parameter|constraint`) e o teste correspondente.
- **Testes:** propriedade com `fast-check` (campo travado nunca e sobrescrito por proposta; seed so com campos do `SeedToken`; deterministico) e paridade entre o schema e `DESIGN_BRIEF_FIELDS`.

- **Fase 0 (medida):** `POST /api/brand/build` (404) e `pnpm brand:build` (inexistente) nao existem na 0.22.1. A cadeia real e **container do Open Design → clone `~/.open-design` → `BLOCKED`** (`OD_BRAND_ENGINE_UNAVAILABLE`); o engine roda so com built-ins do Node e da byte a byte o mesmo resultado nos dois caminhos.
- **Novo:** `scripts/od-brand-build.mjs` (grava `source/{brand.json,engine/,engine-run.json}` e `resolved/design-contract.json`), `scripts/lib/brand-engine.mjs` (adaptador; replica o merge de `brand.seed` que `seedFromBrand()` ignora), `scripts/lib/token-mapper.mjs` (engine → TOKEN_SCHEMA do Open Design com regras deterministicas para os tokens que o engine nao emite; extensoes `--info`, `--*-text`, `--border-strong`, `--focus`, `--border-width`, `--control-h*`; variantes seguras para WCAG AA), `scripts/lib/color.mjs` (hex, rgb, oklch, contraste), `scripts/lib/design-render.mjs`, `scripts/lib/ts-register.mjs` + `ts-resolve-hook.mjs` (importa o engine `.ts` do clone).
- **Contrato v2:** `design-contract.schema.json` com `themes.light` e `themes.dark` obrigatorios (`themes.compact` so densidade), `provenance` por token (`brief|proposed|derived|engine-default`), `engine`, `briefRef`, `version` e `sha256` (hash do JSON canonico sem o proprio campo). O contrato nao carrega o caminho do engine (vive em `source/engine-run.json`), para que container e clone produzam os mesmos bytes.
- **Render completo (P4–P9):** `design-package.mjs render` e obrigatorio e gera tudo do contrato — `tokens.css` (`:root` claro, `[data-theme="dark"]`, `prefers-color-scheme`, `prefers-reduced-motion`, densidade compacta), `design-tokens.json` em DTCG, `tailwind-v4.css` (`@theme`), `DESIGN.md` (front matter normativo + 9 secoes), `components.html` e `preview/` (cores, tipografia, espaco, componentes e tela-chave, nos dois temas) so com `var(--token)`, `USAGE.md`, `manifest.json` (`od-design-system-project/v1`) e `provenance.json` (hash por arquivo). Deixa de copiar `components.html`/`preview/` de `--original`.
- **Audit v2 (Fase 4, P10):** `design-package.mjs audit` devolve `checks` por gate — `structure`, `contrast`, `conformance`, `integrity`, `engineRun` — e `contractSha256`, e grava `design-audit.json`. **Contraste:** a matriz obrigatoria (texto 4.5:1, nao textual 3:1) e exigida nos temas **claro e escuro**; um par ausente, um minimo rebaixado ou um valor cru do engine no lugar da variante segura (`--*-text`, `--border-strong`, `--focus`) reprova; cores em hex 3/6/8, `rgb[a]` e `oklch`. **Escalas:** escadas primitivas e escalas de espaco/tipo/raio/secao/controle nao podem decrescer. **Estados:** todo componente declara `default`, `hover`, `focus-visible` (`focus` sozinho nao vale) e `disabled`, com `--focus`/`--focus-ring` presentes. Contrato v1 falha com `CONTRACT_VERSION_UNSUPPORTED`.
- **Conformidade com o brief (Fase 4):** `checkBriefConformance(brief, contract)` (`scripts/lib/design-gates.mjs`): campo **travado** que diverge no contrato bloqueia (primaria comparada so ao tema **claro** por ΔE CIE76 ≤ 2 e igualdade do seed; semanticas; familias de fonte; tamanho base; raio; densidade; movimento; tema padrao); campo nao travado so gera achado `info`. `--brief` (padrao `<feature>/design-brief.json`) e obrigatorio na CLI.
- **Integridade (Fase 4):** o audit re-renderiza o pacote em memoria (`renderPackageFiles`) e compara byte a byte com `resolved/`; `provenance.json` grava o hash de cada arquivo, `contractSha256` e `packageSha256`. Editar `tokens.css`, `DESIGN.md`, `components.html` ou um preview a mao (`INTEGRITY_DRIFT`), ou re-assinar o contrato depois da derivacao (`ENGINE_RUN_CONTRACT_MISMATCH`), reprova. `source/engine-run.json` precisa existir, com `status: ok` e o mesmo `contractSha256`.
- **Gate do estagio (Fase 4):** sair do DESIGN com front-end exige, por design system, `design-audit.json` `PASS` com os cinco `checks` em `PASS` (`SKIPPED` nao vale) e ligado ao contrato em disco (`DESIGN_AUDIT_STALE`), `source/engine-run.json` bem-sucedido e a aprovacao visual do **mesmo** contrato. Um `{"status":"PASS"}` escrito a mao e recusado.
- **Aprovacao visual (Fase 5):** `applyDesignAdjustments()` (ajustes rapidos: primaria, densidade, raio, tipografia, tema padrao — travam o campo, mudam o seed e limpam a aprovacao anterior), `approveDesignBrief()` (grava `approvedAt` + `approvedSha256` no `design-brief.json`) e `isDesignApproved()`. Novo `scripts/design-brief.mjs` (`build`, `seed`, `adjust`, `approve`): `seed` grava `source/{seed,brand,seed-origin}.json` a partir do brief; `approve` so aceita um contrato auditado (`PASS`). O gate confere que o hook `AskUserQuestion` registrou uma pergunta no DESIGN. Prototipo do Open Design e Critique Theater ficam **opcionais e consultivos**, nunca bloqueiam.
- **Estado (P12):** `design-package.mjs audit|render` imprime `statePatch` (`designPackages[<id>] = { auditStatus, contractSha256 }` e `designBriefPath`), que a camada de skill grava no estado — o handoff passa a carregar o status e o hash reais.
- **Mudanca de comportamento:** `REQUIRED_COMPONENT_STATES` passa a exigir `focus-visible` no lugar de `focus`; contratos anteriores que so declaram `focus` precisam ser derivados de novo.
- **Testes (Fases 4–5):** `design-gates` (matriz nos dois temas, escalas, estados, conformidade por campo, integridade por arquivo, engine-run, CLI, aprovacao) e propriedade com `fast-check`: para qualquer brief valido (campos travados e livres misturados), `seed → contrato → render → audit` passa em audit, conformidade e integridade, e alterar uma cor travada apos a derivacao e sempre detectado. `stage-gate` cobre cada condicao do gate do DESIGN.
- **Fluxo:** o AGY deixa de escrever valores de token; so propoe seed para campos nao travados e escreve `--extras` (componentes, layouts, iconografia, imagery, microcopy, anti-patterns, `rationale`). SKILL.md (DESIGN), `references/open-design.md` e READMEs EN/pt-BR atualizados.
- **Testes:** `design-package`, `token-mapper` (propriedade com `fast-check`: mesmo seed → mesmos bytes, independente da ordem das chaves, todo par de contraste respeitado), `brand-engine` (cadeia, classificacao de falhas, engines reais quando disponiveis, container == clone). `handoff-contract-sync` continua falhando pela divergencia `ui-prototype` do Executor (Fase 6).

## [2.30.0] — 2026-09-19 — Design system sem catalogo do Open Design (Fase 1 do plano)

O Pensador deixa de consultar o catalogo do Open Design. Uma medicao sobre os 152 systems empacotados mostrou 150 com
prosa (`DESIGN.md`) divergente do `tokens.css`, e o fetch rodava no FINAL — depois do DESIGN que precisava dele — e ainda
bloqueava o FINAL com `exit 7` por divergencia do proprio upstream. O design system passa a ser **gerado a partir do brief**
em `design-systems/<id>/{source,resolved}/`, com `<id>` derivado do produto.

- **Removido:** `scripts/od-fetch-system.mjs`, `scripts/od-verify-system.mjs` (e seus testes), `openDesignFetchPlan()`,
  `OPEN_DESIGN.systemArtifacts`/`manifestSchemaVersion`, os verbos de catalogo em `OPEN_DESIGN.commands`
  (`designSystemsList`, `designSystemShow`, `importGithub`, `importShadcn`, `apiDesignSystems`, `odGetFile`, `mcpGetFile`,
  `clonedSystemsDir`), a selecao top-3 no BRAINSTORM_GERAL, o fetch/verificacao no FINAL, `--accept-design-divergence`
  e `design-consistency.json`. `docs-consistency` passa a banir esses identificadores fora deste CHANGELOG.
- **Handoff (P12):** `validation.status` deixa de ser um `PASS` fixo. `buildArtifactList()` le
  `state.designPackages[<id>] = { auditStatus, contractSha256 }` (novo campo de estado, gravado pela camada de skill depois do
  `design-package.mjs audit`; o engine nao faz I/O) e emite o status real — `UNVERIFIED` quando nao ha evidencia — mais
  `contractSha256` (`null` ate ser gravado).
- **`sourcePath` (P2):** `design-systems/<id>/source/` (proveniencia do engine) em vez de `original/`.
- **`materializeInto` (P13):** `<uiPackageDir>/design-systems/<id>/`, alinhado com `OPEN_DESIGN.systemsDir`, a documentacao e o
  requisito OpenSpec (antes o engine emitia `<uiPackageDir>/styles/design-systems/<id>/`). `openDesignSpecContract()` idem.
- **Documentacao:** `references/open-design.md` reescrito (corrige a afirmacao de que o Open Design nao gera design system a
  partir de um brief: o brand engine deriva tokens de um seed, sem LLM); SKILL.md, `stages.md`, `skill-stack.md`,
  `feature-isolation.md`, `openspec.md`, comando e READMEs EN/pt-BR atualizados.
- **Estado transitorio ate a Fase 3:** o AGY ainda sintetiza o `design-contract.json`, agora **somente a partir do brief**
  (sem catalogo); a derivacao pelo brand engine (`POST /api/brand/build` / `pnpm brand:build`), o `briefToSeed()` e o render
  completo (`design-package.mjs render` ainda copia `components.html`/`preview/` de um `--original` quando informado) chegam nas
  Fases 2–3. `handoff-contract.md` (byte-identico nos 4 plugins) ainda descreve `original/` e `styles/design-systems/`; sera
  reescrito na Fase 6.


## [2.29.0] — 2026-09-18 — Gate executavel de avanco de estagio; fluxo no fio principal

Corrige as falhas observadas numa run real (OficinaAI, sessao `oficinaai-dd`): o modelo delegou os
estagios RESEARCH→FINAL a um fork em segundo plano (74 min bloqueado sem progresso), depois moveu o
checkpoint de `INIT` direto para `DONE` com um unico `Edit` — pulando EXPAND, COMPLEXITY,
BRAINSTORM_GERAL, CODEX, AGY e DESIGN — e entregou um `handoff.json` escrito a mao que reprovava em
`validate-handoff.mjs` (sem `handoffVersion`, `stage`, `producer`, `artifactRoot`, ...), apresentado como "PRD completo".

- **Novo** `scripts/advance-stage.mjs` + `scripts/lib/stage-gate.mjs`: unico caminho para mudar o `stage` do checkpoint.
  Recusa saltos (`STAGE_SKIP`), artefato de saida ausente (`MISSING_ARTIFACT`: `codebase-memory.md`, `market-research.md` +
  `tech-research.md`, `prd.md`, `architecture.md`, `shared-agents/*.response.md`), perguntas pendentes e `DONE` sem
  `stageHistory` completo ou sem `validate-handoff.mjs` `ok: true`. Registra cada visita em `stageHistory`.
- SKILL.md / command: nova secao "Execucao no fio principal" proibindo fork/segundo plano/`ScheduleWakeup` para conduzir o
  fluxo; regra "nunca edite o `stage` a mao"; FINAL passo 6 explicitamente bloqueante; recap final obrigado a listar estagios
  reduzidos e proibido de dizer "PRD completo" sem todos os estagios.
- Instalador do Open Design no Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File` em vez de `pwsh` (PowerShell 7 nao vem instalado por padrao).
- **Gate de conteudo e de registro** (fecha a limitacao "so confere existencia; EXPAND..AGY sem checagem"):
  - artefatos precisam de conteudo real (piso de caracteres nao-brancos; JSON valido e nao vazio) — `ARTIFACT_TOO_SHORT`;
  - novo `--record`/`--record-file` ao sair de EXPAND, COMPLEXITY, BRAINSTORM_GERAL, CODEX, AGY (e DESIGN sem front-end):
    desfecho (`asked`/`none`/`fallback`/`skipped`), perguntas feitas x fechadas, justificativa quando nada foi perguntado,
    `complexityMode`, `hasFrontend`/`hasBackend`. Gravado em `stageRecords`; `DONE` exige o registro de cada estagio;
  - CODEX/AGY passam a gravar `shared-agents/<codex|agy>.stage.response.md` (prova de que o subagente rodou);
  - DESIGN com front-end exige `design-systems/<id>/resolved/design-audit.json` com `status: PASS`;
  - `DONE` confere `project-baseline.json`, `requirements.json`, `ui-data-map.json` (front-end), `seed-plan.json` (back-end) e
    que todo artefato `required` declarado no `handoff.json` existe e nao esta vazio.
- **Novo hook `PreToolUse`** (`hooks/hooks.json` → `scripts/guard-checkpoint.mjs`, decisao em `scripts/lib/checkpoint-guard.mjs`):
  bloqueia `Edit`/`Write`/`MultiEdit` e escritas via Bash/PowerShell que alterem `stage`, `stageHistory`, `stageRecords`,
  `complexityMode`, `hasFrontend` ou `hasBackend` de `.pensador-progress.json` (demais campos, leitura e a criacao inicial em INIT seguem livres; falha aberta).
- **Selo de integridade** (`integrity`, SHA-256 dos campos do gate): gravado a cada transicao e conferido antes da proxima.
  Qualquer edicao dos campos do gate por fora do script — mesmo por um caminho que o hook nao reconhece — vira
  `CHECKPOINT_TAMPERED`. Novos `advance-stage.mjs --seal` (checkpoint recem-criado em INIT) e `--adopt` (checkpoint de versao
  anterior, a pedido do usuario; estagios cumpridos ficam `backfilled`). Sem selo o avanco e recusado (`CHECKPOINT_NOT_SEALED`).
- **Perguntas verificadas**: novo hook `PostToolUse` de `AskUserQuestion` (`scripts/track-questions.mjs`) grava
  `<featurePath>/.pensador-questions.jsonl` com o estagio corrente; um registro `asked` que declare mais perguntas do que as
  registradas e recusado (`QUESTIONS_NOT_OBSERVED`). `"unverified": true` e a saida explicita quando hooks estao desativados.
  O guard bloqueia escrita manual no log.
- Testes: `test/stage-gate.test.js` (ordem, conteudo, registros, DESIGN, DONE, selo, perguntas), `test/checkpoint-guard.test.js` (hook) e
  `test/stage-gate-cli.test.js` (CLI, tracker e uma caminhada completa pelos 13 estagios com o validador real).

## [2.28.0] — 2026-09-17 — Remove a sub-etapa de prototipacao do estagio DESIGN

Simplificacao confirmada com o usuario: o estagio `DESIGN` deixa de gerar 1-3 protótipos HTML
interativos dos fluxos criticos e de gatear o avanco para `FINAL` num `AskUserQuestion` de
aprovacao visual desses protótipos. O restante do estagio `DESIGN` (pacote de design/contrato
visual, tokens/Open Design, geracao de midia e brand assets, fixtures de componentes e auditoria)
continua intacto — `STAGE_ORDER` nao muda, so a sub-atividade de prototipagem sai de dentro dele.

- **`skills/pensador/SKILL.md`:** removidos os passos "Prototipacao no Discovery" e "Gate de
  Aprovacao Visual" do `## DESIGN` (junto com a checagem de cobertura de benchmark que so fazia
  sentido contra um protótipo), passos renumerados; `design-package.mjs audit` deixa de receber
  `--prototypes`; a condicao de fechamento do estagio e a tabela de gates deixam de exigir
  aprovacao de protótipos; a tabela de Delegacao v2 deixa de listar protótipos como saida do
  pipeline `resolved-design-package`; `FINAL` deixa de declarar o role `ui-prototype` no
  `handoff.json` (mantem `brand-assets`).
- **`scripts/pensador-engine.mjs`:** removidos `OPEN_DESIGN.prototypesDir`, o campo `prototypesDir`
  de `openDesignDeliveryFor()`, o campo `uiPrototype` de `planArtifacts()` (e a variavel
  `hasPrototypes`/`state.prototypes` que so o alimentava) e o artefato `kind: 'ui-prototype'` de
  `buildArtifactList()`. Os typedefs JSDoc de `Artifact`/`kind` deixam de listar `ui-prototype`.
- **`scripts/design-package.mjs`:** removida a funcao `audit` + `Prototypes()` (auditoria de CDN
  externo e CSS local dos protótipos) e a chamada correspondente dentro de `auditDesignPackage()`,
  incluindo o parametro `prototypesDir`; removido o flag `--prototypes` do CLI.
- **`scripts/lib/handoff-validator.mjs`:** `HANDOFF_ROLES_BY_STAGE.pensador` deixa de aceitar o role
  `ui-prototype`; `validateVisualCompleteness()` deixa de exigir esse role para `status: DONE`
  (removido o codigo `MISSING_UI` + `_PROTOTYPE_FOR_DONE_STATUS`) — a checagem irmã de
  `brand-assets` continua bloqueante.
- **Handoff contract (replicado verbatim nos quatro plugins — `cc-pensador`,
  `cc-orchestrador-subagents`, `cc-testador-subagents`, `cc-executor-subagents`):**
  `references/handoff-contract.md` secao 5 deixa de listar o role `ui-prototype` na tabela de roles
  do Pensador.
- **`skills/pensador/references/feature-isolation.md`:** `ui-prototype` removido da lista de roles
  validos do Pensador (mantida em lockstep com `handoff-contract.md` por
  `test/handoff-roles-consistency.test.js`).
- **`skills/pensador/references/open-design.md`:** removida a subsecao "Descoberta e Prototipação de
  Fluxos Críticos" do Pipeline Generativo e Discovery Visual; subsecoes seguintes renumeradas.
- **`skills/pensador/references/stages.md`:** removida a mencao ao gate de cobertura de protótipo de
  superficie `conversion`/`catalog` no resumo do estagio `DESIGN`.
- **`skills/ui-ux-pro-max/SKILL.md` e `skills/frontend-design/SKILL.md`:** a prosa dessas lentes do
  `BRAINSTORM_GERAL` deixa de prometer que os fluxos criticos "viram protótipos interativos HTML
  standalone" — a pergunta sobre fluxos criticos continua existindo para priorizar UX/auditoria
  visual, sem ficar amarrada a um artefato de protótipo que nao e mais gerado.
- Testes atualizados: `test/handoff-validator.test.js` e `test/open-design-discovery.test.js`
  perdem as fixtures/assercoes do role/helper/campo de protótipo; `test/docs-consistency.test.js`
  ganha guardas para banir a reintroducao acidental dos identificadores removidos (o helper de
  auditoria de protótipos, o codigo de handoff `MISSING_UI` + `_PROTOTYPE_FOR_DONE_STATUS` e os
  codigos de achado do antigo auditor de protótipos).

## [2.27.0] — 2026-09-17 — Superficies de produto, cobertura de contrato (ui-data-map) e plano de seed

Segunda rodada de correcao sobre a mesma run real (OficinaAI, 2026-09-16, apos a 2.26.0 ja em
producao): a vitrine publica ficou visualmente fraca porque a deteccao de arquetipo so olhava o
top-1 (SaaS/ERP), e o painel interno inteiro leu de `localStorage` porque `openapi.yaml` tinha 21
operacoes para 41 RFs sem que nada cruzasse tela x operacao. Ver tambem cc-orchestrador-subagents
4.19.0 (metade Orquestrador destas mesmas correcoes).

- **`detectProductSurfaces()` substitui a dependencia de um unico arquetipo top-1 para decisao
  visual.** `detectProductArchetype()` so retorna o melhor casamento; uma demanda "SaaS de gestao
  com site publico de captacao de leads" tem DUAS superficies (`operational` do SaaS + `conversion`
  do site), e a segunda ficava invisivel — o arquetipo vencedor (ERP/SaaS) nunca menciona
  hero/prova-social/CTA/contato em `baselineFeatures`. Nova funcao mapeia arquetipo -> tipo de
  superficie (`ARCHETYPE_SURFACE_TYPE`) e captura superficies secundarias via
  `SECONDARY_SURFACE_SIGNALS` (bilingue, incluindo o padrao "catalogo/vitrine de X" que a versao
  anterior so reconhecia via palavra fixa).
  - Nova pergunta obrigatoria no RESEARCH (passo 4a): benchmark real (`WebFetch`, nao so
    `WebSearch`) de >= 3 referencias por superficie `conversion`/`catalog`, com secoes observadas
    em >=2 referencias promovidas a `benchmarkedSections` (mesma regra `>=2 fontes = table-stakes`
    ja usada por `classifyFeatureTier`). Novo artefato `surface-benchmark.json` (role
    `surface-benchmark`, schema `surface-benchmark.schema.json`).
  - Novo gate de fidelidade no DESIGN: um protótipo de superficie `conversion`/`catalog` precisa
    cobrir as secoes do benchmark — um wireframe minimo (hero + formulario, sem prova
    social/diferenciais/contato) deixa de ser aceito como spec visual autoritativa dessa superficie.
- **`inferVisualImageryPlan()` corrigido: politica agora vem da superficie, nao de palavras
  soltas.** A versao anterior marcava `required` so por "banner"/"hero"/"mockup" aparecerem no
  texto (falso bloqueio: uma landing page mencionando "hero banner" virava `required` mesmo sem
  nenhum outro sinal) e nunca reconhecia uma demanda em ingles ("public storefront with product
  gallery") por so ter palavras-chave em pt-BR (falso negativo). Agora `required` vem de
  `detectProductSurfaces()`: toda superficie `catalog`/`conversion` e um sinal estrutural (o
  benchmark cross-setor mostra fotografia real em toda pagina publica de referencia), nao um
  match de vocabulario solto.
  - `validateVisualCompleteness()` (`handoff-validator.mjs`) tinha o mesmo bug de contagem:
    contava so assets `purpose: "seed-demo"` contra `visualImageryPlan.minimumAssets`, que agora e
    sobre imagem de CONTEUDO (qualquer `purpose`). Separado em duas checagens: `visualImageryPlan`
    (conta qualquer asset vinculado, **bloqueante** quando `policy: "required"`) e
    `seedImageryRequired` (conta so `seed-demo`, `SEED_IMAGERY_LIKELY_MISSING` **nao bloqueante** —
    revertido ao comportamento documentado; a escalada para bloqueante introduzida na 2.26.0 nunca
    foi anunciada nem testada contra este cenario). O mesmo fix foi replicado em
    `pensador-ingest.mjs` do Orquestrador (mesma contagem, mesmo bug).
- **`ui-data-map.json` (role `ui-data-map`) + `validateContractCoverage()`
  (`scripts/lib/contract-coverage.mjs`).** Novo artefato: mapa tela -> operacao de contrato
  (leitura/escrita) por entidade, com `dataSource` fixo em `"api-contract"` — nunca
  `localStorage`/estado do cliente. `validate-handoff.mjs` cruza cada operacao referenciada contra
  o contrato real (parser OpenAPI proprio, sem dependencia de YAML — `paths:` isolado por indentacao,
  robusto a profundidade de schema arbitraria); uma tela sem operacao correspondente e
  `CONTRACT_COVERAGE_GAP`, bloqueante em `status: DONE`. Formatos fora de REST/OpenAPI (GraphQL/
  gRPC/AsyncAPI) degradam para `applicable: false` com motivo — nunca um passe silencioso. Testado
  contra o `openapi.yaml` real da run analisada: reproduz exatamente as 4 telas do painel sem
  endpoint de listagem que so foram descobertas na E2E do Orquestrador.
- **`seed-plan.json` (role `seed-plan`).** Esqueleto por entidade (`buildSeedPlanScaffold()`)
  derivado do `ui-data-map` preenchido: `minimumCount >= 3` para toda entidade lida como lista (uma
  linha so nao prova que a tela le uma colecao — exatamente o padrao do painel real, que tinha
  massa de demonstracao fixa em `SEED_ORDENS`/`SEED_CLIENTES` no cliente). `persistenceLayer` e
  fixo em `"database-seed"`, nunca inferido — dado de demonstracao pertence a camada de
  seed/migration do banco, independente da stack.
- `handoff-contract.md` (secao 5, Pensador) ganhou os tres roles novos, replicado byte-identico nos
  quatro plugins do workflow (Pensador, Orquestrador, Testador, Executor); `feature-isolation.md`
  atualizado no mesmo commit.
- `.gitattributes` (`*.mjs`/`*.js` -> `eol=lf`): quatro scripts com shebang tinham CRLF residual de
  um checkout Windows sem esse arquivo, o que quebrava o parser de shebang do esbuild/vitest (Node
  em si parseava sem erro) — `design-package.mjs`, `od-mcp-config.mjs`, `preflight.mjs`,
  `validate-handoff.mjs`.

## [2.26.0] — 2026-09-15 — IDs de requisito por dominio, bootstrap multi-tenant, imagens de seed separadas de marca

Continuacao do levantamento de gaps sobre uma run real do Pensador -> Orquestrador (OficinaAI,
apos a 2.25.0 ja em producao). Ver tambem cc-orchestrador-subagents 4.18.0 (metade Orquestrador
das mesmas correcoes).

- **`requirements-extractor.mjs`:** `RF_ROW_RE`/`CA_ROW_RE` so aceitavam a tabela `RF-01` do
  `prd-template.md`; o PRD real gerado usa bullets `- **RF-ORC-06**: ...` com ID por dominio sob
  subheadings — nem o formato de linha nem o de ID batiam, e o proprio Pensador registrou numa run
  real que a ferramenta "nao foi aplicada diretamente" (`requirements.json` escrito a mao). Agora
  aceita tabela e bullet, IDs simples e por dominio (inclusive sufixo alfabetico, `RF-OS-02a`), e
  uma nova `expandRequirementReferences()` expande listas compactas (`RF-PUB-01/02/03`) e
  intervalos (`RF-ORC-01..11`) que um CA real referenciava e o parser antigo truncava no primeiro
  RF. `prd-template.md` agora documenta os dois formatos como igualmente sancionados.
- **Bootstrap multi-tenant:** `skills/backend-development/SKILL.md` pergunta explicitamente, para
  demandas multi-tenant, como o operador da propria plataforma (distinto do Admin do tenant)
  autentica e provisiona o primeiro tenant/Admin — numa run real esse gap so apareceu na review de
  back-end, ja tarde, porque `POST /api/tenants` exigia um papel que nenhum fluxo de login emitia.
- **Imagens de seed/demo separadas de brand assets:** `references/imagery.md` deixa de tratar as
  duas como uma decisao so — `external-assets` para marca (logo/fotos que o tenant fornece depois)
  nao dispensa gerar 3-6 imagens reais de seed quando o PRD renderiza catalogo/vitrine com dados
  de demonstracao. Novo campo `project-baseline.json.seedImageryRequired` (heuristica de inferencia
  por `inferSeedImageryRequired()` a partir da demanda, ou setado explicitamente via
  `withSeedImageryRequirement()` no estagio DESIGN); `validateVisualCompleteness()` emite o warning
  nao bloqueante `SEED_IMAGERY_LIKELY_MISSING` quando ha menos de tres assets `purpose: "seed-demo"`
  vinculados. `design-package.mjs audit` tambem passa a exigir `seedBindings` no asset de seed
  (bloqueante ali, nao so aviso no handoff) — numa run real, o seed de demo tinha `imagemUrl: null`
  em todos os 6 itens do catalogo, e nenhuma das tres revisoes (back-end, front-end, E2E) percebeu.

## [2.25.0] — 2026-09-13 — Gate real para o estagio DESIGN antes de status DONE

Motivacao: numa run real (OficinaAI, 12/09) o estagio DESIGN foi pulado inteiro — o `handoff.json`
foi escrito a mao com `status: DONE` e `design-system-files[].variant: legacy-verbatim`, sem
`ui-prototype` nem `brand-assets` — e `validate-handoff.mjs --file handoff.json` reportou
`ok: true`, porque o validador so checava a estrutura do envelope, nunca se o `status: DONE`
realmente correspondia a um estagio DESIGN completo. `.claude-plugin/marketplace.json` tambem
estava com drift de versao (2.22.0) contra `package.json`/`plugin.json` (2.24.0).

- **`scripts/lib/handoff-validator.mjs`:** nova funcao `validateVisualCompleteness(handoff)`,
  deliberadamente separada de `validateHandoff()` (que continua envelope-only). Para
  `stage: pensador` com `status: DONE` e algum artefato de design (`design-system-files` ou o
  fallback `design-system`), exige `design-system-files[].variant === "resolved"` e a presenca dos
  roles `ui-prototype`/`brand-assets` — os codigos novos sao `DESIGN_PACKAGE_NOT_RESOLVED`,
  `MISSING_UI` + `_PROTOTYPE_FOR_DONE_STATUS` e `MISSING_BRAND_ASSETS_FOR_DONE_STATUS`. Sem sinal de
  front-end (nenhum artefato de design) ou com `status` diferente de `DONE`, e um no-op.
- **`scripts/validate-handoff.mjs`:** passa a rodar as duas funcoes e mesclar os erros; `ok` e
  `false` se qualquer uma reportar violacao.
- **`skills/pensador/SKILL.md`:** o estagio FINAL agora instrui explicitamente rodar
  `validate-handoff.mjs` antes de reportar — o script nunca era mencionado na prosa antes desta
  versao, apesar do proprio docstring do CLI dizer "Producers run this before writing status: DONE".
- **`test/handoff-validator.test.js`:** 9 testes novos, incluindo a reproducao exata da regressao
  (`status: DONE` + `variant: legacy-verbatim`) e a garantia de que `validateHandoff()` continua
  passando no loop generico de fixtures por role (a nova checagem nao vaza para o validador de
  envelope).
- `.claude-plugin/marketplace.json` realinhado com `package.json`/`plugin.json` (drift 2.22.0 →
  2.25.0 corrigido).

## [2.24.0] — 2026-09-12

- Pesquisa técnica com Context7 MCP (`tech-research.md`):
  - Diretrizes operacionais estritas na fase de `version-currency`: resolução de bibliotecas com pontuação oficial (`Next.js`, `ASP.NET Core`, `Three.js`).
  - Priorização do identificador versionado `/org/project/version` em projetos brownfield com versão fixada em manifests.
  - Regra de Single-Concept Scoping e teto de no máximo 3 consultas Context7 por tecnologia para prevenir diluição semântica e consumo indevido de cota.

## [2.23.0] — 2026-09-12

- Open Design (Shift-Left Front-end): `components.html` passa a ser fixture obrigatória (`✅`) no pacote de design quando há front-end (`hasFrontend`), eliminando adivinhação de layout ou criação de seletores do zero.
- Protocolo de transpilação shift-left documentado em `skills/pensador/references/open-design.md`: subagentes de front-end devem consumir e transpilar as fixtures de `components.html` diretamente para a stack do projeto, preservando tokens CSS e hierarquia visual.

## [2.22.0] — 2026-09-11

- Open Design passa a ser detectado por CLI, MCP estruturado, daemon REST autenticado e Docker/porta publicada, distinguindo autenticacao ausente de instalacao ausente.
- Novo estagio `DESIGN` produz `original/` imutavel e pacote `resolved/` autoritativo com contrato, tokens, componentes, previews, auditoria e proveniencia.
- AGY sintetiza o design e gera antecipadamente imagens obrigatorias/recomendadas; Codex executa auditoria read-only com no maximo duas correcoes.
- Manifesto de assets registra rotas, slots, alt, hashes, destinos e seed bindings; imagens obrigatorias ausentes bloqueiam o handoff.
- Iconografia vetorial e WCAG AA passam a ser gates do pacote visual; emojis funcionais e tokens indefinidos sao recusados.
- `design-package.mjs audit` deixa de aceitar apenas o diretorio `resolved/` implicito: `--prototypes <dir>` aponta explicitamente para `<featurePath>/prototypes/` (fora de `resolved/`, onde os protótipos realmente vivem — role `ui-prototype`), e o comando documentado no SKILL.md deixou de ter as aspas fechando no lugar errado. Auditoria de pacote/contrato ausente agora devolve `{status:"BLOCKED", findings:[...]}` estruturado em vez de crashar com stack trace.
- Detecção de capacidade de Codex/AGY no preflight passa a preferir o `agents` declarado no `plugin.json` do plugin irmão (contrato público e versionado) sobre um caminho interno hardcoded, com fallback para o caminho convencional quando o manifesto não declara `agents`; nunca confia apenas na declaração sem confirmar o arquivo no disco.
- Timeout de probe de CLI (Codex/AGY/Open Design/OpenSpec) no preflight sobe de 1,5s para 5s por padrão — 1,5s deixava ~35% de margem sobre a latência real medida do Codex (~950-980ms), arriscando falso-negativo sob carga.
- Contagem de estágios corrigida em toda a documentação (12 → 13, com `DESIGN`) e `docs-consistency.test.js` ganhou guarda dedicada contra essa classe de drift.

## [2.21.0] — 2026-09-09

### Open Design: divergência deixa de ser aviso manual e passa a bloquear FINAL

- `od-fetch-system.mjs` executa a verificação de conteúdo automaticamente após
  cada cópia completa, grava `design-consistency.json` e sai com código `7` em
  `DIVERGENT_BLOCKED`.
- A exceção requer tanto a decisão explícita do usuário quanto
  `--accept-design-divergence --design-authority tokens.css`; a saída registra
  `DIVERGENT_ACCEPTED` e a autoridade.
- `buildArtifactList()` inclui o sidecar de consistência e a regra de autoridade
  na entrada `design-system-files` do handoff.
- A comparação tipográfica não confunde mais `Inter` com a palavra
  `Interaction`.

## [2.19.0] — 2026-09-05

### Open Design: `system/` deixa de ser descartado e o FINAL passa a verificar a copia

Duas falhas independentes, achadas ao auditar um run real (`OficinaAI`, `.pensador/oficina-saas-v1`)
cuja pasta `design-systems/professional/` tinha **1 arquivo em vez de 24**.

**1. `system/` nunca era copiado, nem num run correto.** `manifest.json` (schema
`od-design-system-project/v1`) declara apenas *arquivos* — `files.*`, `usage`,
`componentsManifest`, `preview.pages[]`, `sourceFiles.*` — e nenhum campo para diretorio.
Logo, as entradas com `/` de `OPEN_DESIGN.systemArtifacts` sao a **unica** coisa que faz um
diretorio chegar na saida, nos dois caminhos (manifest e legado). Essa lista estava errada.
Medido nos 152 systems curados do clone upstream (2026-09-05): `preview/` em 152, `source/`
em 151, `system/` em 150, `assets/` em **0**, `fonts/` em **0**. Ou seja, a lista perseguia
dois diretorios que nao existem em system nenhum e ignorava o que esta em quase todos. Um run
que perdia os 11 arquivos de `system/` (kit renderizado + `system/artifacts/`) ainda reportava
`ok: true` com `unexpectedMissing: []` — perda silenciosa, nao falha.

- `scripts/pensador-engine.mjs` (alterado): `OPEN_DESIGN.systemArtifacts` passa a listar
  `preview/`, `system/`, `source/`, `assets/`, `fonts/` (nessa ordem). `assets/`/`fonts/`
  ficam porque um system **importado** (`import-github`/`import-shadcn`) pode traze-los.
  O bloco de doc explica por que a metade-diretorio da lista nao e um fallback.
- `scripts/od-fetch-system.mjs` (alterado): `LEGACY_DIRS` (lista fixa duplicada) vira
  `PACKAGE_DIRS`, **derivada** de `OPEN_DESIGN.systemArtifacts.filter(f => f.endsWith('/'))`,
  para as duas nao poderem divergir de novo. Nenhuma mudanca de comportamento alem do
  conjunto de diretorios; `copyTree` ja recursava corretamente.
- Verificacao contra o clone real: `--id professional` num destino limpo agora produz uma
  arvore **byte-identica** a `~/.open-design/design-systems/professional` (`diff -r` limpo,
  24 arquivos, exit 0).

**2. O FINAL podia fechar sem nunca rodar o `od-fetch-system.mjs`.** No run auditado o agente
instalou o Open Design no meio do fluxo, foi direto no `GET /api/design-systems/<id>` — que
serve **so metadados + `DESIGN.md`**, nunca raw file bodies — e gravou esse `DESIGN.md` com
`Write`. O gate do FINAL exigia apenas "artefatos gerados", entao o run fechou `DONE` com um
unico arquivo. O `handoff.json` tambem saiu sem `verbatim`/`materializeInto`, provando que nao
passou por `buildArtifactList()`.

- `skills/pensador/SKILL.md` (alterado): passo 5 do FINAL ganha uma **verificacao obrigatoria**
  em tres pontos (exit `0` + `results[].ok`; `tokens.css` e `DESIGN.md` em `copied[]`; e
  **listar o diretorio em disco** e conferir contra `copied[]`). O terceiro e o que pega o caso
  real — quando o script nao roda nao existe JSON para conferir. Documenta as assinaturas do
  modo de falha (pasta com so `DESIGN.md`; `DESIGN.md` com quebras de linha diferentes do clone,
  porque `copyFileSync` copia byte a byte e `Write` nao; entrada de handoff sem `materializeInto`)
  e proibe gravar arquivo de system com `Write`/`Edit`. O gate do FINAL e a linha da tabela
  **Resumo dos gates** passam a citar a verificacao.
- `skills/pensador/references/open-design.md` (alterado): tabela de artefatos verbatim ganha
  `system/` e `source/`; nova nota explicando que o `manifest.json` nao declara diretorios e
  registrando a medicao dos 152 systems; novo callout descrevendo a reincidencia do bug
  "so o DESIGN.md" pela via do FINAL escrito a mao.
- `README.md` / `README.pt-BR.md` (alterados): `system/`/`source/` na descricao de
  `design-systems/<id>/`.
- `test/integrations.test.js` (alterado): assercao de `systemArtifacts` atualizada com o
  racional e os numeros da medicao; novo teste garantindo que **nenhuma** entrada de diretorio
  e `required` (invariante de que um system sem diretorio nenhum ainda sai 0).
- `test/fetch-system.test.js` (alterado): dois testes novos de regressao — um copia um fixture
  com `system/artifacts/` aninhado e confere o conteudo em disco (nao so o `copied[]`), outro
  fixa que um system sem diretorio nenhum continua saindo `0`. `npm test`: 535 passed,
  2 skipped, 0 failed.

## [2.18.1] — 2026-09-03

### Suite de testes do handoff-validator alinhada com o estagio Testador

Uma sincronizacao anterior (`skills/pensador/references/handoff-contract.md`,
`assets/handoff.schema.json`, `scripts/lib/handoff-validator.mjs`) adicionou `testador` a
`HANDOFF_STAGES` e `HANDOFF_ROLES_BY_STAGE`, mas nao estendeu `test/handoff-validator.test.js`:
o teste "accepts every role declared for each stage" usava um ternario de 3 ramos que caia no
`else` (fixture de Executor) para o novo estagio, e o teste de alinhamento com a tabela do
contrato nao existia para `testador`. `npm test` reportava 1 falha.

- `test/handoff-validator.test.js` (alterado): adiciona `validTestadorHandoff()`, estende o
  ternario para 4 ramos, corrige o regex de `extractStageRoles` (`[a-z-]+` -> `[a-z0-9-]+`, que
  quebrava em roles com digito como `a11y-report`) e adiciona o teste de alinhamento
  "testador role set matches the contract table". `npm test`: 526 passed, 2 skipped, 0 failed.
- `skills/pensador/references/handoff-contract.md` (alterado, replicado nos quatro plugins):
  secao 9 corrigida — nao afirma mais que `handoff.schema.json`/`handoff-validator.mjs` sao
  byte-identicos entre plugins (nunca foram; a garantia real e equivalencia semantica testada).

## [2.18.0] — 2026-08-27

### Reconciliacao da superficie de comando unificada com os validadores de handoff

Esta versao integra a linha remota de interface unificada com as entregas locais 2.15.0–2.17.0,
sem reutilizar um numero de versao que ja representava outra mudanca:

- `--mode` passa a ser o nome canonico; `--modo` continua aceito como alias legado silencioso.
- Novos subcomandos: `help`, `preflight`, `status`, `resume [slug]` e `config`.
- `argument-hint` e documentacao agora expoem a superficie completa do comando.
- O handoff aponta para `/cc-orchestrador-subagents:orquestrador`.
- Mantidos o baseline de projeto, o schema/validador de `handoff.json` e a extracao de
  `requirements.json` adicionados na linha local.

## [2.17.0] — 2026-08-24

### `requirements.json` (role `requirements-index`) — materia-prima do gate de cobertura RF/CA do Orquestrador

Achado de auditoria: a premissa "o Orquestrador e obrigado a atender todos os criterios de aceite"
nao tinha nenhum respaldo deterministico rio abaixo — mas a materia-prima ja existia aqui: o PRD
gera tabelas `RF-XX`/`CA-XX` estaveis (secoes 6 e 14 de `prd-template.md`), com o vinculo `CA -> RF`
explicito, e o handoff nunca extraia esse conjunto de IDs — o Orquestrador tinha de re-derivar a
lista de requisitos lendo prosa, sem checagem contra a fonte.

- `scripts/lib/requirements-extractor.mjs` (novo): `extractRequirements(prdMarkdown)` — parser puro
  (sem I/O, sem estado do engine) das tabelas RF/CA reais do PRD, com fallback a `warnings[]` (nunca
  throw) para secao ausente, tabela vazia ou referencia `CA -> RF` pendurada. Ignora as linhas de
  template (`RF-N`/`CA-N`).
- `scripts/pensador-engine.mjs`: novo role `requirements-index` (`requirements.json`) em
  `buildArtifactList`, **somente modo PRD** — modo Spec expoe o equivalente ao vivo via
  `openspec status --change <nome> --json`, um caminho de extracao diferente que este modulo nao
  tenta espelhar.
- `skills/pensador/references/handoff-contract.md` (canonico, replicado byte-identico nos tres
  plugins) e `scripts/lib/handoff-validator.mjs` (idem): novo role documentado/validado.
- `SKILL.md` FINAL passo 5: instrucao para gerar `requirements.json` a partir do `prd.md` recem
  escrito, apos `project-baseline.json`.
- `test/requirements-extractor.test.js` (novo, 15 testes): caminho positivo (extracao completa,
  inclusive contra o `prd-template.md` real) e negativo (secao ausente, tabela vazia, referencia
  pendurada, linha malformada — tudo degrada com warning, nunca lanca excecao).

## [2.16.0] — 2026-08-24

### Schema + validador do envelope `handoff.json` (`validate-handoff.mjs`)

Achado de auditoria: `handoff.json` e a "ancora unica de descoberta" entre os tres plugins do
workflow (handoff-contract.md secao 4) — o unico sinal que distingue modo conjunto de modo
independente — mas nenhum codigo em nenhum dos tres repositorios escrevia, lia ou validava esse
arquivo (`grep -rn handoffVersion --include=*.mjs --include=*.json` nos tres retornava zero). Um
produtor podia divergir do contrato em silencio sem nenhum teste pegar — como ja tinha acontecido
com o proprio `feature-isolation.md` (2.15.0).

- `scripts/lib/handoff-validator.mjs` (novo, canonico, byte-identico nos tres plugins):
  `validateHandoff(handoff)` colige todas as violacoes do envelope numa passada — campos
  obrigatorios, enums de `stage`/`status`, e o vocabulario de `role` **por stage** (o que teria
  pego o drift do `feature-isolation.md` corrigido em 2.15.0), incluindo o caso de um role valido
  para outro estagio ser reivindicado pelo estagio errado.
- `scripts/validate-handoff.mjs` (novo, CLI): `node validate-handoff.mjs --file <path>`, JSON
  `{ ok, file, errors[] }`, exit 0 somente com `ok: true`.
- `skills/pensador/assets/handoff.schema.json` (novo): schema formal documentando o envelope, sem
  dependencia de biblioteca de JSON Schema — so o validador escrito a mao.
- `skills/pensador/references/handoff-contract.md` (canonico, replicado byte-identico nos tres
  plugins): nova secao 9 documentando o validador e quando roda-lo.
- `test/handoff-validator.test.js` (novo, 38 testes): caminho positivo (handoff bem formado por
  estagio, cada role valido aceito) e negativo (cada violacao especifica com o codigo certo,
  incluindo o role cruzado entre estagios) + round-trip do CLI + guarda que fixa
  `HANDOFF_ROLES_BY_STAGE` contra as tabelas de `handoff-contract.md` secao 5.

## [2.15.0] — 2026-08-24

### Baseline do projeto existente vira artefato de primeira classe do handoff (brownfield)

Achado de auditoria: `architecture.md` e `codebase-memory.md` — os dois artefatos que carregam a
exploração real do projeto (domínios descobertos, mapa de código, baseline do contrato de API
existente, convenções que o Executor deveria preservar) — eram classificados no motor como
"working files" e explicitamente excluídos de `buildArtifactList`, embora `handoff-contract.md`
já os declarasse roles válidos do Pensador e o Orchestrador já fosse instruído a ingeri-los nessa
ordem. O consumidor procurava um artefato que o produtor nunca emitia — em brownfield, exatamente
o conteúdo que mais importa nunca chegava ao handoff.

- `scripts/pensador-engine.mjs`: `planArtifacts`/`buildArtifactList` agora emitem `architecture`,
  `codebase-memory` e o novo `project-baseline` (papel `project-baseline.json`, resumo
  máquina-legível de `isGreenfield`/`techStack`/`apiStyle`/`uiPackageDir`/
  `existingApiContractGlobs`) incondicionalmente em FINAL/DONE, nos dois `artifactMode` — EXPLORE e
  ARCH sempre rodam na ordem fixa do `STAGE_ORDER`, independente de `hasBackend`/`hasFrontend`.
  Novo `state.isGreenfield` (via `withGreenfieldSignal`) e `buildProjectBaseline(state)`.
- `skills/pensador/references/handoff-contract.md` (canônico, replicado byte-idêntico em
  `cc-orchestrador-subagents` e `cc-executor-subagents`): tabela de roles do Pensador atualizada —
  `architecture`/`codebase-memory` passam de "opcional"/"quando houver ARCH" para "sim, sempre";
  novo role `project-baseline`; ordem de ingestão da Fase 1 do Orchestrador atualizada.
- `skills/pensador/references/feature-isolation.md`: lista de roles corrigida — estava sem
  `api-contract` e `openspec-change` (drift pré-existente) e sem o novo `project-baseline`.
- `test/handoff-roles-consistency.test.js` (novo): guarda que compara a lista de roles de
  `feature-isolation.md` contra a tabela do Pensador em `handoff-contract.md`, com prova de que a
  extração de fato pega drift (não só combina trivialmente).
- `test/artifacts.test.js`, `test/integrations.test.js`: cobertura de caminho positivo (os três
  artefatos presentes independente de back/front-end, em ambos os modos PRD/Spec, com filename e
  path corretos) e negativo (ausentes fora de FINAL/DONE, mesmo gate de prd/userhistory).

## [2.14.0] — 2026-08-22

### Integração Open Design atualizada contra o upstream v0.20.2 e drift interno corrigido

A integração nasceu na 2.7.0 (2026-06-18) contra o Open Design ~0.4–0.9 e nunca foi revalidada.
O upstream está hoje em v0.20.2 — 11 minors adiante — e o `CHANGELOG.md` da raiz do repo upstream
(a fonte óbvia para checar isso) está **congelado em 0.9.0**: o changelog canônico migrou para
`docs/CHANGELOG/v<versão>/<locale>.md`, então uma checagem ingênua perde tudo entre 0.10 e 0.20.2.
Nesta revisão o Open Design não estava instalado localmente — os itens que dependiam de execução
ao vivo (superfície `od design-systems`/`od get-file` após o rollback do release 0.20.0, `od lint`,
`/api/version`, `/api/mcp/install-info`) foram implementados como **sondados em runtime, nunca
pressupostos**, e ficam documentados como não verificados em `references/open-design.md`.

**Drift interno (independe do upstream) — a documentação já não descrevia o próprio plugin:**

- Treze lugares ainda afirmavam o modelo pré-2.8.6 ("Open Design gera `design-system.md`"), embora
  desde a 2.8.6 `design-system.md` só seja escrito no **fallback** (Open Design indisponível). Corrigido
  em `agent-stack.md`, `frontend-design/SKILL.md`, `ui-ux-pro-max/SKILL.md`, `prd-template.md`,
  `askuserquestion-protocol.md`, `README.md`/`README.pt-BR.md`, `preflight.mjs` e nas descrições de
  `package.json`/`plugin.json`/`marketplace.json`.
- `SKILL.md` tinha duas linhas duplicadas e contraditórias para `od-fetch-system.mjs` (destinos
  diferentes); `open-design.md` tinha `~72` e `~150` design systems no mesmo arquivo; READMEs
  listavam 8 das 9 dimensões do brief (faltava `sectorContext`); `frontend-design/SKILL.md` listava
  8 das 9 seções do `DESIGN.md` (faltava `brand`); a doc listava 3 locais de config MCP contra os 4
  que o preflight sonda; o campo `mcpFunctional` não era documentado em lugar nenhum.
- "exit 5" era citado em 3 lugares mas o script nunca o emitia (só `0`/`2`/`6`) — em vez de apagar
  a citação, `od-fetch-system.mjs` passou a **emitir exit 5 de verdade** quando nenhuma fonte é
  encontrada para um system (distinto de exit 6, quando uma fonte é encontrada mas
  `tokens.css`/`DESIGN.md` seguem faltando).
- `checkOpenDesign()` não tinha nenhum teste (o filtro coreutils, a fórmula `available` e o shape
  completo de `integrations.openDesign` estavam desguardados). Novo `describe('preflight: Open
  Design detection')` em `test/preflight-detection.test.js` cobre os seis casos, incluindo um shim
  de `od` fake para simular o falso-positivo do coreutils sem depender de um binário real.

**Contrato de design system dirigido por `manifest.json` (núcleo da atualização):**

- `od-fetch-system.mjs` agora busca `manifest.json` primeiro, valida
  `schemaVersion === "od-design-system-project/v1"` e deriva a lista de arquivos esperados dele
  (`files.*`, `usage`, `componentsManifest`, `preview.pages[]`, `sourceFiles.*`) em vez de uma lista
  fixa — a lista fixa (`OPEN_DESIGN.systemArtifacts`, agora com `design-tokens.json` e
  `tailwind-v4.css` também) vira fallback só para systems legados sem manifest.
- Novo campo `unexpectedMissing[]` no JSON de saída: todo arquivo que o manifest prometeu e não foi
  copiado por nenhuma fonte aparece ali — antes isso era silêncio total (só `tokens.css`/`DESIGN.md`
  eram reportados). Novo `test/fetch-system.test.js` (8 casos) exercita isso contra fixtures em
  disco, sem depender de uma instalação real do Open Design.
- Cadeia de aquisição **sondada, não pressuposta**: clone em disco primeiro (única fonte que não
  depende de nenhuma superfície de CLI — por isso primária diante do rollback do 0.20.0), depois
  `od get-file` (só se `od get-file --help` responder), depois REST. O JSON de saída registra qual
  fonte serviu cada arquivo (`fileSource`).
- Nova flag `--locale <bcp47>` baixa `DESIGN-<bcp47>.md` quando o system o oferece (upstream ships
  até ~17 variantes, incluindo `DESIGN-pt-br.md`); não baixado por padrão.
- O script ganhou um guard de entry-point (`invokedDirectly`, mesmo padrão de
  `od-onboard-agents.mjs`) e exporta `deriveExpectedFiles()` — permite testar a derivação do
  manifest sem tocar disco/rede.

**Falhas silenciosas corrigidas (Workstream F):**

- `preflight.mjs`: a detecção de config MCP do Open Design trocou `fileMentions()` (substring scan
  do arquivo inteiro) por `findMcpServer()` (parse estruturado de `mcpServers`, o mesmo helper que a
  detecção de Context7 já usava) — uma menção incidental à string `"open-design"` fora de
  `mcpServers` não conta mais como `configured: true`.
- `od-onboard-agents.mjs`: quando `--verify` roda e o daemon reporta **zero** dos agentes
  encontrados localmente como disponíveis, isso agora vira exit code `8` (distinto do exit `7` de
  "nada encontrado localmente") e uma nota explícita — antes o `ok: true` dependia só da detecção
  local de PATH, ignorando o que a verificação dizia.
- `onboard-open-design-agents.sh`/`.ps1`: o `catch {}` em volta do parse de `pathAdditions` agora
  registra um warning em vez de descartar a falha em silêncio (uma mudança de shape upstream
  derrubava o wiring do antigravity sem nenhum sinal).
- `install-open-design.sh`: o gerador de token parava de tentar `openssl` e caía para
  `od -An -tx1` (coreutils) — o mesmo binário que o resto do plugin trata como falso positivo do
  Open Design. Trocado por um fallback em Node (`crypto.randomBytes`), que nunca colide com o `od`
  que este mesmo script está instalando.

**Instalador reduzido ao que o upstream mantém (Workstream E):**

- `install-open-design.sh`/`.ps1` agora tentam `deploy/scripts/install.sh --non-interactive --port
  <port>` (não verificado ao vivo) antes do caminho manual `docker compose up -d`, caindo de volta
  para ele se o script upstream não existir ou falhar.
- Comentários que afirmavam que `open-design.ai/install.sh` "responde 404" foram corrigidos — o
  upstream **voltou a documentar** esse instalador hospedado; a decisão de não usá-lo (é opaco, e
  este repo já clona o código-fonte, que é auditável) continua valendo, só não fica mais justificada
  por uma alegação que deixou de ser verdadeira.

**Documentação (Workstreams C, G, H):** `references/open-design.md` ganhou uma seção "Fontes
canônicas" registrando o congelamento do `CHANGELOG.md` upstream e a versão validada (0.20.2);
documenta o gate opcional `od lint` (0.20.0+, capability-probed); documenta o vocabulário de plugins
(`od plugin`/`od marketplace`, 0.8.0+) e o AMR embutido (0.9.0+) como referência, sem uso ativo
neste plugin. Decisão registrada: nenhum probe de versão do daemon foi adicionado ao preflight — o
script é inteiramente síncrono e o custo de convertê-lo para async não se justificou para uma sonda
opcional cujo endpoint tampouco foi confirmado ao vivo.

## [2.13.0] — 2026-08-21

### Integração OpenSpec atualizada para o perfil core (CLI 1.9.0+, recomendado 1.10.0)

A integração de modo Spec estava escrita contra o OpenSpec ~1.1/1.3 e o **perfil expandido**
(`/openspec-new-change`, `/openspec-ff-change`, `/openspec-verify-change`, `/openspec-sync-specs`,
`/openspec-archive-change`). Desde a 1.4, `openspec init` instala por padrão o **perfil core**
(`/opsx:explore|propose|apply|update|sync|archive`) — numa instalação nova os comandos antigos
simplesmente não existem, e o modo Spec falhava silenciosamente.

- `OPENSPEC` (em `pensador-engine.mjs`) foi reancorado no perfil core: `commands` usa o prefixo
  `/opsx:*` atual (não mais `/openspec-*`, que era descrito — incorretamente — como o prefixo
  descontinuado). Novos campos: `minVersion` (`1.9.0`), `recommendedVersion` (`1.10.0`),
  `profile`, `configFile`, `skills` (nomes de diretório), `expandedCommands` (opcionais, nunca
  requisito), `cliCalls` (chamadas de CLI scriptáveis: `openspec validate --strict --json`,
  `openspec archive --json --yes`, `openspec doctor --json`, …) e `exitCodes`.
- `checkOpenSpec()` (preflight) ganhou piso de versão (`checkCli` agora aceita
  `{ minVersion, recommendedVersion }`), detecção de raiz via `openspec doctor --json` (com
  fallback estático) e detecção de perfil instalado. Abaixo do piso, o modo Spec não é oferecido —
  a invariante de que OpenSpec nunca afeta o `status` geral do preflight continua valendo.
- `state.skipSpecs` (default `false`): quando `true`, `planArtifacts`/`buildArtifactList` omitem o
  artefato `specs/`, espelhando `openspec archive --skip-specs` para mudanças de infra/tooling/doc
  que não alteram specs.
- `openspec validate <nome> --strict --json` substitui o antigo `verify-change`; arquivamento
  sempre via `openspec archive <nome> --json --yes` — nunca `mv`/`mkdir` manual (o contrato de
  agente do OpenSpec proíbe isso explicitamente).
- `references/openspec.md`, `SKILL.md`, `stages.md`, `open-design.md`, `feature-isolation.md`,
  `commands/pensador.md`, `README.md` e `README.pt-BR.md` atualizados para o novo comando set.
- A árvore gerada `.claude/skills/openspec-*` + `.claude/commands/opsx/*` foi regenerada
  localmente na 1.10.0 via `openspec update`. Ela **permanece ignorada pelo git** (`.claude/` no
  `.gitignore`): é artefato de ambiente, regenerável por `openspec update`, não conteúdo do plugin.

### Correcoes do review

- **Deteccao de perfil OpenSpec com tres estados.** `profile` reportava `"core"` mesmo sem nenhuma
  skill `openspec-*` instalada — o INIT oferecia Spec e o `PRD_BASE` invocava um `/opsx:propose`
  inexistente, exatamente a falha tardia que esta integracao existe para evitar. Agora e
  `core` / `expanded` / `none`, sondando `.claude/skills/` do projeto **e** `~/.claude/skills/`, e
  `available` exige `profile !== "none"`.
- **`/opsx:sync` sai do FINAL.** `references/openspec.md` e `references/stages.md` mandavam
  sincronizar antes de implementar, o que publicaria como spec vigente um comportamento ainda nao
  construido e drenaria os deltas que o Orchestrador ingere — e contradiziam `commands/pensador.md`
  e `SKILL.md`, que ja tinham a ordem certa. O Pensador planeja: roda `propose` + `validate` e faz
  handoff de `apply` -> `sync` -> `archive`.
- **`/opsx:propose` gera `specs/` tambem.** A documentacao afirmava apenas tres artefatos.
- **Deteccao do Context7 passa a parsear o JSON** em vez de varrer o texto dos arquivos de config.
  `~/.claude.json` e a config inteira do Claude Code (100+ KB com `allowedTools`, caminhos de exemplo
  e historico por projeto), entao um `ctx7`/`context7` solto ali marcava o servidor como disponivel;
  o RESEARCH elegia o Context7 como fonte preferida da fase de version-currency e so descobria o
  engano quando a chamada MCP falhava. Agora casa nomes de servidor registrados em `mcpServers`
  (raiz e do projeto atual), respeita `disabledMcpjsonServers`, e reconhece registro sob nome
  customizado pelo pacote/endpoint. A chave de projeto e normalizada (barra normal vs invertida,
  caixa, barra final) — sem isso o caso por projeto era um falso-negativo silencioso no Windows.
- **`checks.optional.mcp.context7` -> `integrations.context7`** em `references/tech-research.md`: o
  caminho documentado nao existia na saida do preflight.
- Novo `test/preflight-detection.test.js` cobre os tres estados de perfil e oito cenarios de
  deteccao do Context7 (ruido, servidor desabilitado, outro projeto, nome customizado, JSON invalido).

## [2.12.0] — 2026-08-19

### `handoff-contract.md` ressincronizado, byte-idêntico nos três plugins

O `cc-orchestrador-subagents` moveu o manifesto de handoff para `report/handoff.json` (layout 2, versão 4.1.0) e adicionou/reformulou seções (`Modos de operação`, `Open Design: contrato visual e materialização`) que a cópia do Pensador não recebeu — a divergência era de 26 linhas, todas nos caminhos do layout novo. Copiado verbatim da versão canônica do Orquestrador.

`test/handoff-contract-sync.test.js` — que existe desde o 2.9.0 justamente para blindar essa promessa e ficava com 2 skips (repositórios irmãos ausentes) em checkout isolado — passa a cobrir de fato num workspace com os três plugins lado a lado, e fica verde: as cópias do Orquestrador e do Executor agora batem byte a byte com a canônica do Pensador.

> Fecha o adiamento registrado no 2.10.0 ("exigiria replicação byte-idêntica nos três plugins, o que não pode ser feito a partir deste repositório isolado") — os três repositórios estavam neste workspace.

### Codebase Memory: gate de `index_status`, orçamento de consulta e regras de prova

O `codebaseMemoryExplorationPlan()` disparava `index_repository` — uma varredura do repositório inteiro — como primeiro passo automático, sem confirmação do usuário. A regra correspondente do Orquestrador (endurecida na sua versão `[Unreleased]`) é o oposto: `index_status` é sempre o primeiro passo, um gate somente-leitura; `index_repository` só roda depois de `AskUserQuestion` confirmar, porque indexar é uma decisão do usuário, não uma otimização silenciosa.

- **`codebaseMemoryExplorationPlan()`** (`scripts/pensador-engine.mjs`) agora começa com `index_status`, antes de `index_repository`. A função continua pura e determinística — o gate em si é regra de execução documentada em prosa, não algo que o array codifica.
- **`references/codebase-memory.md`** ganha a seção "Gate de índice antes de qualquer uso" (árvore de decisão `index_status` → sem índice/`AskUserQuestion` → índice fresco → índice pendente), "Limite de 30 s por consulta" (erro/timeout cai para `Read`/`Glob`/`Grep`; duas falhas seguidas do servidor tratam o MCP como ausente pelo resto da exploração), "Lacuna de cobertura: leia o arquivo" (grafo silencioso não prova inexistência de símbolo/chamada/referência — especialmente sensível aqui, porque uma afirmação errada vira requisito ausente no PRD) e "Resultado de MCP é evidência corroborativa" (nunca fecha, sozinho, um requisito ou uma afirmação sobre o código no PRD/Spec).
- `SKILL.md`, estágio EXPLORE, passo 2, reescrito para descrever o gate e as regras de prova em vez da sequência antiga `index_repository → get_architecture → ...`.
- `test/integrations.test.js` atualizado: o teste que afirmava a sequência começando em `index_repository` agora espera `index_status` primeiro.

### Context7 MCP (novo, opcional)

O Pensador não tinha nenhuma integração com Context7, apesar de o track `TECH_RESEARCH` (2.11.0) existir precisamente para não escrever "o app de ontem" a partir do corte de treinamento — Context7 é a fonte de documentação versionada que essa fase pede.

- **`scripts/preflight.mjs`**: novo bloco `integrations.context7` (`checkContext7()`), com a mesma heurística de detecção do Codebase Memory (skill instalada + menção em `.mcp.json`/`.claude.json`/`~/.claude/mcp.json` conhecidos). Opcional — nunca afeta `status`. Guidance textual adicionada em `buildGuidance()`.
- **`references/tech-research.md`**: a Fase 1 (`version-currency`, obrigatória) agora documenta o Context7 como fonte preferida quando disponível, coerente com a inversão de tiers de fonte da seção ("official-docs > release-notes > ..."), e a ordem obrigatória **resolver o identificador antes de pedir documentação** — mesmo quando "já conhecido" de uma consulta anterior na mesma feature, porque nome de pacote e identificador do servidor não são a mesma coisa. Sem Context7, a fase segue via `WebSearch`/`WebFetch` normalmente.
- `keywords` do `plugin.json` ganha `context7`.

### Stack de agentes e Dependency_Installer: avaliados, mantidos como estão

O Orquestrador (`[Unreleased]`) trocou a stack fixa Codex/AGY por uma Project_Config configurável com opção `claude-code` por papel, e formalizou o protocolo do Dependency_Installer (uma `AskUserQuestion` por dependência, benefício/impacto/comando). Avaliado para o Pensador e **não portado como está**: Codex e AGY aqui são **lentes de domínio** dentro do `BRAINSTORM_GERAL`, não executores por categoria de task — o modelo de roteamento é estruturalmente diferente do Orquestrador/Executor. O equivalente funcional ao fallback `claude-code` já existe: as lentes primárias determinísticas (`requirements-clarity`, `backend-development`, `ui-ux-pro-max`/`frontend-design`) sempre rodam independente de Codex/AGY, que atuam só como refinamento por cima; a seção "Fallback" de `references/agent-stack.md` já oferece, por domínio, retentar/seguir sem aquele domínio/registrar `"TBD"` via `AskUserQuestion` — a mesma decisão que uma opção `claude-code` formal produziria, sem duplicar um segundo sistema de configuração de papéis para um plugin que não executa nem revisa código.

## [2.11.0] — 2026-08-14

### Segundo track no RESEARCH: pesquisa tecnica (stack, arquitetura, padroes, convencoes)

A v2.10.0 trouxe o `RESEARCH` olhando para o **mercado**. Faltava a outra metade: o mesmo estagio precisa entender **como a stack pedida e construida hoje**. O estagio passa a ter **dois tracks**:

| Track | Pergunta | Descritor | Snapshot |
|---|---|---|---|
| `business` | O que essa categoria de produto entrega? | `WEB_RESEARCH` | `market-research.md` |
| `technical` | Como essa stack e construida hoje? | `TECH_RESEARCH` | `tech-research.md` |

**O problema que o track tecnico resolve.** O conhecimento de um LLM sobre um ecossistema em movimento esta congelado no corte de treinamento, e o modo de falha e **silencioso**. Pedindo *"tela de login com autenticacao e cadastro de usuario, front-end React e TypeScript, back-end com C#"*, o modelo pode produzir com total confianca um PRD ancorado em padroes que a documentacao oficial ja substituiu — estrutura de pastas de um major anterior, a abordagem antiga de busca de dados, JWT feito a mao onde o framework ja entrega identidade suportada, pacote de teste que deixou de ser o default. O PRD vira a **especificacao de construir o aplicativo de ontem**, e Orquestrador e Executor implementam fielmente a decisao vencida. Dai a regra: para toda tecnologia sensivel a versao, versao estavel atual e abordagem recomendada sao **pesquisadas, nunca lembradas**.

**Registro de tecnologias (`TECH_STACK_REGISTRY`).** ~70 entradas compactas (`{ id, label, category, keywords, docsUrl, versionSensitive }`) cobrindo linguagens, frameworks de front-end e back-end, kits de UI, estado/dados, ORMs, bancos, auth, testes, infra e mobile. **Nenhuma entrada guarda numero de versao** — fixar "React 19" no registro recriaria exatamente a obsolescencia que o track existe para eliminar; guarda so onde a verdade mora (`docsUrl`) e se precisa ser checada (`versionSensitive`). Um teste dedicado impede a regressao, inclusive versao embutida no `label` (foi o que pegou `OAuth 2.1`, corrigido para `OAuth / OpenID Connect`). As perguntas de pesquisa vivem na **categoria** (`TECH_CATEGORY_ANGLES`), nao em cada entrada: adicionar tecnologia e uma linha e ela ja herda os angulos certos. Tecnologia fora do registro nao e descartada — `resolveTechEntry()` devolve entrada generica com `versionSensitive: true`.

**Casamento por fronteira de palavra (`matchesKeyword`).** `includes()` nao serve neste dominio: `go` casaria em "algo"/"google" e `crm` em qualquer token maior. E `\b` e inutil justamente para os identificadores que mais importam — `c#`, `.net`, `c++` comecam/terminam em caractere nao-palavra, entao `\bc#\b` nunca dispara. A fronteira e expressa como lookaround sobre a classe alfanumerica, o que torna `C#`, `.NET` e `Go` detectaveis sem falso positivo. `detectProductArchetype` foi migrado para o mesmo matcher, ganhando precisao.

**Lacunas de stack viram pergunta, nao suposicao (`inferStackGaps`).** "Back-end com C#" nomeia a **linguagem**, nao o framework; "tela de login" nao diz a abordagem de auth. Adivinhar produziria um PRD sobre uma premissa que o usuario nunca fez. Tres lacunas detectadas — `backend-framework-missing` (com os candidatos de `SERVER_LANGUAGE_FRAMEWORKS`), `auth-approach-missing` (candidatos conforme o back-end detectado) e `database-missing` — cada uma virando `AskUserQuestion` com a pergunta pronta. Uma linguagem de servidor tambem passa a contar como o lado back-end da fronteira: sem isso `backend` vinha vazio e os angulos de integracao front↔back, os mais valiosos numa feature de login, nunca disparavam.

**Plano de consultas em tres fases (`techResearchQueryPlan`).** Duas correcoes de ordenacao que os testes expuseram:

1. **`version-currency` obrigatoria, primeiro.** Uma consulta por tecnologia sensivel a versao. Vem antes de tudo porque toda resposta posterior ("estrutura recomendada", "abordagem de auth recomendada") so tem sentido em relacao ao major atual. E a fase que neutraliza o corte de treinamento.
2. **`stack-patterns` em round-robin.** O primeiro angulo de cada tecnologia, depois o segundo de cada. O laco ingenuo por tecnologia gastava o orcamento inteiro em React e deixava o back-end C# quase sem consulta.
3. **Cross-cutting com vagas reservadas.** `integration-contract`, `auth-flow` e `project-conventions` dependem da **combinacao** front/back e nenhuma consulta por tecnologia os revela — mas eram os primeiros a serem truncados, o inverso do correto. Agora as fases 1 e 3 sao obrigatorias e o orcamento governa apenas quantas consultas da fase 2 cabem; o plano pode exceder `liteQueries` numa stack grande, porque seis tecnologias exigem genuinamente seis checagens de versao e descartar uma reintroduziria o bug. A consulta de fronteira tambem prefere o **framework concreto** a linguagem nua (`react + asp.net core` e melhor que `react + c#`).

**Gate de adocao (`classifyPatternAdoption`).** Quatro niveis (`PATTERN_ADOPTION`), precedencia do sinal mais forte: `deprecated` (a doc oficial desencoraja ou existe `replacedBy`) → `experimental` → `current` (doc oficial **e** evidencia com no maximo `PATTERN_STALENESS_MONTHS` = 24 meses) → `legacy`. So `current` (e `experimental` escolhido consciente) pode virar decisao de PRD; `legacy` exige justificativa; `deprecated` vai para os anti-padroes com o substituto documentado. O limite de 24 meses existe porque um tutorial de 2019 pode continuar **correto** sem ser a **pratica recomendada hoje** — e e a segunda coisa que o PRD precisa.

**Tiers de fonte invertidos.** `official-docs` > `release-notes` > `reputable-guide` > `community`, com `requiresOfficialSource: true`. Inversao proposital em relacao ao track de negocio: para afirmacao de **mercado** a pagina do fornecedor e enviesada; para afirmacao sobre **framework** o fornecedor **e** a autoridade.

**Diferimento e top-up no ARCH.** Quando nenhuma stack e detectavel (nem na demanda, nem no codigo), nao ha o que pesquisar ainda — a stack so e resolvida no `ARCH`. O track registra `status: DEFERRED` e o **ARCH executa o top-up** com as mesmas funcoes, apos resolver a stack por analise do projeto ou entrevista greenfield. Se ja foi pesquisada no RESEARCH, o ARCH reaproveita: nao pergunta nem pesquisa de novo.

**Prompt System agora cobre os dois tracks.** `PROMPT_SYSTEM_SECTIONS` passa de 9 para 16 secoes, com `PROMPT_SYSTEM_SECTION_GROUPS` separando `business` (8) de `technical` (7: `techStack`, `architectureBaseline`, `designPatterns`, `codingConventions`, `securityBaseline`, `testingBaseline`, `technicalAntiPatterns`) mais `openQuestions` compartilhada. Cada consumidor injeta **so o grupo pertinente** — o brief do Open Design nao tem uso para convencoes de ORM, a lente de back-end nao tem uso para precificacao de concorrente. `techStack` e derivavel da stack detectada, mas as **versoes** dentro dela sao sempre pesquisadas.

**PRD com as decisoes tecnicas rastreaveis.** A secao 15 do `prd-template.md` foi reescrita: tabela de stack com coluna **Versao (pesquisada)** e URL da documentacao oficial, blocos de **Estrutura de Projeto & Convencoes**, **Padroes de Arquitetura & Design** (com coluna de adocao) e **Anti-padroes Tecnicos** (com o substituto). A instrucao e explicita: nunca escrever versao de memoria — se nao foi pesquisada, `"TBD"`. `skills/prd/SKILL.md` ganhou as perguntas correspondentes na entrevista e a secao 15 do `Strict_PRD_Schema` foi atualizada.

**Estado.** `initState` ganha `techStack` e `techResearch`; `withTechResearch()` normaliza `status` (`DONE` | `PARTIAL` | `DEFERRED` | `SKIPPED`), `versions`, `patterns`, `conventions`, `antiPatterns`, `sources` e `notes`. Persistido no checkpoint v2. `tech-research.md` e **arquivo de trabalho** (como `codebase-memory.md` e `market-research.md`), fora de `buildArtifactList` — o baseline tecnico chega ao downstream dobrado no PRD e no `architecture.md`.

**Novos/atualizados:** `references/tech-research.md` (protocolo completo, registro, angulos, anti-padroes), `test/tech-research.test.js` (78 testes, incluindo property-based para totalidade de `detectTechStack`, `techResearchQueryPlan` e `classifyPatternAdoption`, e o teste que impede versao no registro), bloco `integrations.webResearch.tracks.*` no `preflight.mjs` com orcamento e tiers por track, e docs sincronizados (`SKILL.md` com a secao RESEARCH em dois tracks + top-up no ARCH + baseline no prompt do CODEX, `stages.md`, `feature-isolation.md`, `web-research.md`, `commands/pensador.md`, READMEs).

- **Versao:** `package.json`/`plugin.json`/`marketplace.json` → **2.11.0**. Testes: **381 passam** em 12 suites.

## [2.10.0] — 2026-08-14

### Novo estágio RESEARCH: pesquisa web / benchmark de mercado antes do PRD

O fluxo tinha um ponto cego: o `EXPLORE` olhava só para **dentro** (a base de código, via Code Base Memory) e o PRD nascia direto da demanda crua. Mas a demanda que chega ao Pensador quase sempre é uma **categoria de produto com milhares de implementações publicadas** — site comercial de empresa, landing page de prestador de serviço, SaaS, CRM, e-commerce, sistema de gestão. O conjunto de funcionalidades básicas dessa categoria é conhecimento público; escrever o PRD sem lê-lo significa re-derivar do zero o que o mercado já resolveu, e entregar um produto sem o obvio.

`STAGE_ORDER` passa de 11 para **12 estágios**, com o `RESEARCH` entre `EXPLORE` e `PRD_BASE`:

```text
INIT → EXPLORE → RESEARCH → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

**Arquétipos de produto (`PRODUCT_ARCHETYPES`).** 11 categorias reconhecidas — `landing-page`, `institutional-site`, `ecommerce`, `marketplace`, `crm`, `saas`, `erp`, `booking`, `dashboard`, `mobile-app`, `api-service` — mais o fallback `unknown`. Cada uma traz um checklist `baselineFeatures` (o table-stakes da categoria, conhecido **antes** de qualquer busca; a pesquisa confirma e estende), `researchAngles` (templates de consulta) e o sinal `broadScope`. `detectProductArchetype()` pontua palavras-chave PT-BR/EN de forma insensível a acento e caixa, com a ordem do registro como desempate; o resultado é **sugestão** confirmada via `AskUserQuestion`.

**`sectorContext` coletado primeiro — e uma única vez.** O setor/indústria do negócio ("oficina automotiva de carro/moto", "clínica odontológica") deixou de ser uma dimensão tardia do brief de design e passou a ser o **primeiro dado do RESEARCH**: sem ele a pesquisa retorna generalidades. O `BRAINSTORM_GERAL` agora **reaproveita** `state.sectorContext` em vez de perguntar de novo, e o inventário de concorrentes alimenta `brandReferences` do Open Design.

**Pesquisa com teto, não crawl.** `marketResearchQueryPlan()` monta um plano determinístico e truncado ao orçamento de `WEB_RESEARCH.budget` (4 consultas em `lite`, 8 em `completo`; 3 a 5 concorrentes; no máximo 2 `WebFetch` por consulta), cobrindo 6 ângulos: descoberta de concorrentes, inventário de funcionalidades, vocabulário do setor, precificação/empacotamento, reclamações de UX (fonte dos diferenciais) e conformidade legal do setor. `researchRelevance()` decide relevância e profundidade a partir dos sinais da própria demanda — o `COMPLEXITY` roda depois, então não serve para isso. Só demanda **sem superfície de produto** (refactor interno, build/CI, bump de dependência) é dispensada, e mesmo assim o estágio é visitado e registra o motivo.

**Classificação em tiers (`FEATURE_TIERS`).** `classifyFeatureTier()` separa `table-stakes` (cobertura ≥ 60% dos concorrentes — ausência é defeito, não escopo), `differentiator`, `anti-feature` (comum no mercado e **recusada**, documentada com o motivo) e `out-of-scope`. Decisão explícita do usuário sempre vence o sinal de mercado. Toda `table-stakes` ausente da demanda original vira pergunta `origin = 'web-research'` via `AskUserQuestion` — o benchmark nunca virou backlog automático.

**Prompt System reaproveitável.** `buildResearchPromptSystem()` empacota o contexto pesquisado nas 9 seções de `PROMPT_SYSTEM_SECTIONS` (`businessContext`, `productArchetype`, `marketBaseline`, `competitorFeatures`, `differentiators`, `antiFeatures`, `domainVocabulary`, `complianceNotes`, `openQuestions`), com a mesma garantia do `buildPrdBase()`: completude estrutural, `"TBD"` no que a pesquisa não preencheu — exceto arquétipo, baseline e contexto de negócio, sempre deriváveis sem busca. Esse bloco é injetado **verbatim** nos consumidores de `WEB_RESEARCH.promptSystemConsumers`: PRD base, EXPAND, `context-pack.md`, **toda unidade de trabalho delegada** em `--modo agy|kiro|codex`, brief do Open Design e handoff. Assim toda lente raciocina sobre o mesmo contexto de negócio, em vez de re-inferir o domínio a partir da demanda crua.

**Conformidade de conteúdo inegociável (`WEB_RESEARCH.compliance`).** Citar a URL de todo achado; nunca reproduzir mais de 30 palavras consecutivas de uma fonte; parafrasear preservando o sentido; jamais copiar logos, imagens, textos de marca ou código de concorrente; referenciar padrões de uma marca, nunca a identidade dela. `table-stakes` exige 2 fontes independentes (`official` > `comparison` > `community`). O produto do estágio é **análise, não cópia**.

**Estado e artefatos.** `initState` ganha `productArchetype`, `sectorContext` e `marketResearch`; `withMarketResearch()` normaliza o resultado (`DONE`/`PARTIAL`/`SKIPPED` + concorrentes, features, fontes, notas e o Prompt System) e o checkpoint v2 o persiste. O snapshot `market-research.md` é **arquivo de trabalho** (como `codebase-memory.md` e `architecture.md`), fora de `buildArtifactList` — o benchmark chega ao downstream dobrado no PRD: nova subseção **Benchmark de mercado** na seção 2 do `prd-template.md` (setor, arquétipo, matriz concorrente × funcionalidade com fonte e tier) e as anti-features explícitas na seção 5 (Escopo). `REQUIREMENT_STAGES` passa a incluir `RESEARCH` e `GAP_ORIGINS` ganha `web-research`, então as decisões de escopo do estágio consolidam como requisitos rastreáveis.

**Conflito de merge não resolvido corrigido em `skills/pensador/SKILL.md`.** O arquivo carregava marcadores `<<<<<<< HEAD` / `=======` / `>>>>>>>` (linhas 347-359) desde o merge `d008cdf`, deixando a seção de roteamento do `BRAINSTORM_GERAL` duplicada e ambígua para o LLM que executa a skill. Resolvido preservando a estrutura de lentes primárias (v2.9.0) **e** a menção a `sectorContext`, que existia só no outro lado do conflito.

**Novos/atualizados:** `references/web-research.md` (protocolo completo, arquétipos, plano de consultas, tiers, anti-padrões), `test/web-research.test.js` (62 testes, incluindo property-based para totalidade de `detectProductArchetype`/`classifyFeatureTier`/`marketResearchQueryPlan`), bloco descritivo `integrations.webResearch` no `preflight.mjs` (`probeable: false` — `WebSearch`/`WebFetch` são ferramentas nativas, não checáveis em disco), `WebSearch`/`WebFetch` adicionadas ao `allowed-tools` de `/pensador`, e docs sincronizados (`SKILL.md`, `stages.md`, `feature-isolation.md`, `skills/prd/SKILL.md`, `prd-template.md`, `commands/pensador.md`, READMEs).

- **Versão:** `package.json`/`plugin.json`/`marketplace.json` → **2.10.0**. Testes: **303 passam** em 11 suites.

> `references/handoff-contract.md` **não** foi alterado: adicionar uma role `market-research` exigiria replicação byte-idêntica nos três plugins (`cc-pensador`, `cc-orchestrador-subagents`, `cc-executor-subagents`), o que não pode ser feito a partir deste repositório isolado. O benchmark viaja para o downstream dentro do `prd.md`, que já é a fonte da verdade de produto.

## [2.9.0] — 2026-07-15

### Correções de processo identificadas em auditoria multi-frente (Pensador → Orquestrador)

Uma auditoria de ponta a ponta (código-fonte dos dois plugins + verificação real da entrega de um SaaS de oficina automotiva no navegador via Playwright) encontrou 9 problemas concretos no processo Pensador → Orquestrador. Esta versão corrige os que cabem ao Pensador:

- **`handoff-contract.md` ressincronizado (byte-idêntico nos 3 plugins).** A cópia do Pensador estava 118 linhas divergente da versão real usada pelo Orquestrador/Executor — faltava `artifactMode`, a role `api-contract`, e o path correto de `design-system-files` (`design-systems/<id>/` relativo ao `artifactRoot`, não `packages/ui/design-systems/<id>/`). O `pensador-engine.mjs` já emitia o formato novo; só a documentação estava desatualizada, virando uma armadilha para qualquer leitura/manutenção futura.
- **Nova dimensão `sectorContext` no brief de design (`openDesignBriefPlan()`).** As 8 dimensões anteriores eram só de estilo visual (paleta, tipografia, tom); nenhuma capturava o setor/indústria do negócio. Em uma entrega real isso produziu um design system com "vibe" genérica de marca, sem nenhuma imagem de produto/serviço e com texto institucional fixo em inglês. `sectorContext` é coletado primeiro e roteado como `input` (`openDesignBriefRouting()`), persistido na seção **Brand** do `design-system.md`.
- **Novo `references/imagery.md`.** Documenta a pipeline ponta a ponta de imagery/iconografia: o Pensador coleta `sectorContext` e o grava onde o Orquestrador o encontra; o Orquestrador aciona o mecanismo `IMAGE_SUGGESTIONS` já existente no `antigravity-coder` (`--generate-image`, Nano Banana) mediante aprovação do usuário via `AskUserQuestion`. Fecha a lacuna real observada: 0 `<img>`, 0 `background-image`, 0 tooltips numa entrega completa.
- **Credenciais de seed/demo agora fazem parte do PRD.** Nova pergunta na entrevista de descoberta (`skills/prd/SKILL.md`) e novo campo no template (`prd-template.md` seção 13, Observabilidade & Operação): quando há dados de demonstração via seed/migrations, credenciais conhecidas por papel/role devem ser documentadas — nunca apenas um hash sem plaintext. Sem isso, a verificação E2E autenticada do Orquestrador (Fase 9.5) fica bloqueada, como aconteceu na entrega real auditada.
- **Contagem de design systems curados corrigida (~72 → ~150).** `references/open-design.md` e o comentário em `test/integrations.test.js` afirmavam "~72 design systems" — confirmado via clone local em disco: são ~150 (151 excluindo `_schema`), e apenas 1 (`default`) traz `preview/app.html`. O número estava desalinhado do próprio `cc-orchestrador-subagents`, que já usava "~152" em changelogs anteriores.
- **222 testes verdes** (`npm test`) após todas as mudanças; `openDesignBriefPlan`/`openDesignBriefRouting` com cobertura atualizada para a nova dimensão.
## [2.9.0] — 2026-07-08

### Lentes primárias por domínio + contrato máquina-legível como fonte da verdade (SDD)

Duas mudanças de metodologia no BRAINSTORM_GERAL e na geração de contratos, alinhando o Pensador a Spec-Driven Development.

**Lentes de domínio promovidas a primárias.** Antes, o trabalho de back-end e de UX/front era delegado só a Codex e AGY; as skills `backend-development`/`ui-ux-pro-max`/`frontend-design` eram fallback semi-órfão.

- **`STAGE_DELEGATION.BRAINSTORM_GERAL` (engine):** cada domínio agora expõe uma lente **primária** (skill determinista) + lentes de **refino/motor**. `backend-development` é a lente primária de back-end (roda sempre que `hasBackend`), com Codex `effort high` como `refine`. `ui-ux-pro-max` + `frontend-design` são as lentes primárias de design (rodam quando `hasFrontend`) alimentando o **Open Design** (motor, `role: design-engine`), com AGY como `refine`. O domínio `uiux` foi renomeado para `design` e cada domínio ganhou um array `lenses`.
- **Frontmatter corrigido:** `backend-development` ("estágio BACKEND" → BRAINSTORM_GERAL, agora "primária") e `requirements-clarity` ("estágio CLARITY" → BRAINSTORM_GERAL). `frontend-design`/`ui-ux-pro-max` marcadas como primárias atuando com o Open Design.

**Contrato de API máquina-legível como fonte da verdade.** O antigo `comunication_json.md` (prosa + JSON) foi **renomeado para `communication.md`** e deixou de ser a fonte: agora é a **visão legível derivada** de um contrato máquina-legível (`openapi.yaml` / `schema.graphql` / `service.proto` / `asyncapi.yaml`), selecionado por `state.apiStyle` detectado em ARCH.

- **Novo no engine:** `API_CONTRACT_FORMATS`, `DEFAULT_API_STYLE`, `resolveContractFormat()`, `contractArtifactPath()`, `contractValidationPlan()` (mock + validação para o handoff), `contractDiscoveryGlobs()` (descoberta de contrato existente em brownfield no EXPLORE) e `classifyContractChange()` (gate de breaking change no EXPAND/FINAL). `initState` ganha `apiStyle: 'rest'`.
- **`planArtifacts`/`buildArtifactList`:** modo PRD com back-end emite o artefato `api-contract` (fonte da verdade) antes do `communication` (visão derivada, com `derivedFrom`). Contagens: back-end-only → 4 artefatos; fullstack → 5. No modo Spec o contrato é dobrado no change set (sem artefato standalone).
- **Handoff:** novo role `api-contract` (com `validation: { spec, mock, validate }`); `communication-contract` marcado como visão derivada; ordem de ingestão atualizada.
- **Fluxos brownfield:** EXPLORE descobre contrato existente como baseline; a nova feature o estende; quebras passam pelo gate de breaking change versionado.

**Rename `comunication_json.md` → `communication.md`.** Corrigida a grafia e a extensão do artefato (era Markdown chamado "json"). O `kind`/campo do plano passou de `comunication` para `communication`; o template `comunication_json-template.md` virou `communication-template.md`. O role de handoff `communication-contract` (já grafado corretamente) é inalterado.

**Correção da suíte de testes.** Removido o shebang `#!/usr/bin/env node` de `scripts/od-onboard-agents.mjs`: o loader do vitest avaliava o `#!` como token inválido, impedindo a coleta de `test/onboard-agents.test.js`. O script é sempre invocado via `node <arquivo>`, então o shebang era desnecessário. A suíte agora coleta e passa.

**Docs sincronizados:** `SKILL.md` (isolamento, EXPLORE/ARCH/EXPAND/BRAINSTORM/FINAL, tabelas de delegação), `references/{skill-stack,agent-stack,stages,handoff-contract}.md`, templates `communication` e `prd` (§11), READMEs.

- **Versão:** `package.json`/`plugin.json` → **2.9.0**. Testes: 238 passam em 9 suites (contrato de API, novas contagens de artefato, estrutura de lentes primárias, rename e suíte onboard-agents restaurada).

## [2.8.7] — 2026-07-08

### Contrato Spec ↔ Open Design: os arquivos do OpenSpec referenciam o design system

No modo Spec, o change set (`openspec/changes/<nome>/`) e os arquivos do design system (`.pensador/<nome>/design-systems/<id>/`) vivem em árvores diferentes, sem um vínculo explícito. Novo contrato determinístico liga um ao outro.

- **Novo `openDesignSpecContract(featurePath, systemIds, uiPackageDir)` (engine):** função pura que entrega, por system escolhido, os caminhos concretos que os arquivos do OpenSpec DEVEM referenciar — a **origem verbatim** (`verbatimDir`/`tokens`/`designMd`/`components`, sob a raiz da feature) citada no `design.md` › *Decisions*, e o **alvo de runtime** (`materializeInto`/`materializedTokens`, em `packages/ui`) citado nos requisitos da capability `ui-design-system`. Também expõe `designDoc` e `capabilitySpec`.
- **Docs:** `references/openspec.md` ganha a seção **Contrato Spec ↔ Open Design** (tabela de campos + templates de `design.md` Decisions e do requisito `ui-design-system` que cita `tokens.css`); `SKILL.md` FINAL (modo Spec) e `references/open-design.md` (fluxo FINAL) passam a instruir o uso do contrato.
- **Versão:** `package.json`/`plugin.json` → **2.8.7**. Testes: +2 casos cobrindo `openDesignSpecContract` (paths de origem/alvo, múltiplos systems, `uiPackageDir` custom, totalidade).

## [2.8.6] — 2026-07-08

### Sem `design-system.md` redundante quando o Open Design é usado

Quando um system do Open Design é selecionado, seus arquivos verbatim já incluem um `DESIGN.md` — então gerar um `design-system.md` standalone era duplicação. Agora o `DESIGN.md` verbatim (em `design-systems/<id>/`) é o documento de design; o `design-system.md` só é escrito no **fallback inline** (Open Design indisponível/recusado).

- **`planArtifacts` (engine):** `designSystem` agora é `hasFrontend && !usesOpenDesign` (modo PRD). Com ≥1 system em `state.designSystems`, nenhum `design-system.md` é emitido — só o role `design-system-files` (verbatim, inclui `DESIGN.md`). No modo Spec o comportamento é inalterado (`designSystem: false`).
- **`openDesignDeliveryFor` (engine):** `standaloneArtifact` agora é `false` (o descritor cobre a entrega com Open Design em uso); `decisionsDoc`/`requirementsDoc` no modo PRD apontam para o `DESIGN.md` verbatim (`design-systems/<id>/DESIGN.md`).
- **Handoff:** o role `design-system` (o `design-system.md`) só aparece no fallback inline; overrides justificados passam a ser registrados na seção *Decisions* do `design.md` (Spec) ou como nota no resumo do `handoff.json` (PRD).
- **Docs sincronizados:** `SKILL.md` (FINAL passos 3/5, diagrama, tabela de delegação), `open-design.md`, `handoff-contract.md`, `feature-isolation.md` e ambos os READMEs.
- **Versão:** `package.json`/`plugin.json` → **2.8.6**. Testes: +2 casos cobrindo a supressão do `design-system.md` quando o Open Design é usado; `openDesignDeliveryFor` PRD atualizado.

## [2.8.5] — 2026-07-07

### Artefatos verbatim do Open Design agora ficam dentro de `.pensador/<slug>-vN/`

Correção de integração Pensador ↔ Open Design: os arquivos verbatim do system (`tokens.css`, `DESIGN.md`, `components.html`, `preview/`, …) eram gravados em `packages/ui/design-systems/<id>/` na **raiz do projeto**, fora de `.pensador/`. Isso violava o contrato de handoff (§2 "nenhum artefato na raiz do projeto; o produtor nunca escreve na raiz de outro estágio"), o isolamento por feature ("todo caminho deriva de `featurePath`") e a regra §3 ("`artifacts[].path` é relativo a `artifactRoot`"). Resultado observado: nada aterrissava em `.pensador/`.

- **Destino realocado para a pasta da feature:** os arquivos verbatim agora vão para `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`), mantendo a saída do Pensador autocontida. Novo helper puro `designSystemFilesRoot(featurePath)` no engine; `buildArtifactList` passa a raiz da feature para `openDesignFetchPlan()`.
- **`state.uiPackageDir` vira alvo de materialização:** deixa de ser o destino da cópia do Pensador e passa a ser o local (`packages/ui`/`src/styles`) onde o Executor materializa os arquivos na implementação. Cada entrada `design-system-files` do handoff carrega o novo campo `materializeInto`.
- **`od-fetch-system.mjs`:** novo parâmetro `--out-dir` (alias `--feature-dir`; `--ui-dir` mantido como alias legado) que enraíza a cópia sob a pasta da feature. `SKILL.md` FINAL passa a invocar com `--out-dir <featurePath>`.
- **Docs sincronizados:** `open-design.md`, `handoff-contract.md` (role `design-system-files` relativo ao `artifactRoot` + `materializeInto`), `feature-isolation.md` (layout + roles válidos), `openspec.md`, `SKILL.md` e ambos os READMEs.
- **Sincronização de versão:** `package.json` (2.8.3) e `plugin.json` (2.8.4) unificados em **2.8.5**. Testes: `artifacts.test.js` e `integrations.test.js` atualizados (+2 casos cobrindo `designSystemFilesRoot` e o enraizamento por `featurePath`).

## [2.8.3] — 2026-06-23

### Handoff carrega o `<id>` concreto do system (fecha o elo e2e)

O 2.8.2 documentou o diretório verbatim no contrato (prosa), mas o `handoff.json` **emitido** ainda listava só o `design-system.md` — o `<id>` concreto vivia só na prosa do `design-system.md`, forçando o consumidor (orquestrador) a parseá-la.

- **Novo artefato estruturado `design-system-files` em `buildArtifactList`:** quando `hasFrontend` **e** `state.designSystems` está preenchido (system escolhido no BRAINSTORM_GERAL), emite **uma entrada por `<id>` concreto** apontando para `packages/ui/design-systems/<id>/` (via `openDesignFetchPlan`, respeitando `state.uiPackageDir`). Vale nos dois modos (PRD e Spec) e é gated no estágio FINAL. Aditivo e sem `state.designSystems` não emite nada — as contagens de artefato existentes (2/3/4) seguem intactas.
- **`SKILL.md` FINAL** instrui registrar o(s) `<id>` e o dir verbatim no `handoff.json` (role `design-system-files`); **`references/handoff-contract.md`** ganha a linha do role. 207 testes verdes (+5 em `artifacts.test.js`).
- **Sincronização de versão:** `package.json` estava em 2.8.1 e `plugin.json` em 2.8.2 — ambos agora em 2.8.3.

## [2.8.2] — 2026-06-23

### Correções do review e2e Open Design (4 GAPs)

- **`preview/` em vez de `preview/app.html` (GAP 1 — bug real):** dos ~152 systems curados do Open Design, só 1 traz `preview/app.html`; a maioria traz `preview/colors.html`, `preview/spacing.html` e `preview/typography.html`. O `od-fetch-system.mjs` já copiava o diretório inteiro corretamente via `copyTree`; o bug estava nas referências documentais que apontavam para um arquivo inexistente. Corrigido em: `OPEN_DESIGN.systemArtifacts` no `pensador-engine.mjs`, tabela de artefatos verbatim em `references/open-design.md`, e testes em `test/integrations.test.js` (202 testes verdes).
- **Handoff declara o diretório verbatim por contrato (GAP 2):** `references/handoff-contract.md` role `design-system` expandido para incluir `packages/ui/design-systems/<id>/` (com `tokens.css`, `components.html` e `preview/`) — não apenas o `design-system.md`. Elimina acoplamento por convenção tácita que quebraria silenciosamente se o caminho mudar.
- **`od-fetch-system.mjs` agora é descobrível (GAP 3):** adicionado à tabela de referências da `SKILL.md` e à seção "Leitura relacionada" de `references/open-design.md`. Um mantenedor lendo a documentação canônica agora encontra o script.
- **Localização do `OD_API_TOKEN` documentada (GAP 4):** nota adicionada a `references/open-design.md` — o token é gerado em `~/.open-design/deploy/.env` pelo script instalador; necessário apenas pelo fallback REST (`GET /api/design-systems/<id>` retorna 401 sem ele); o caminho primário (clone em disco) não precisa do token.

## [2.8.1] — 2026-06-22

### Correção — o 2.8.0 não estava "ligado" ao caminho de execução

O 2.8.0 adicionou os helpers (`openDesignFetchPlan`/`openDesignBriefRouting`/`openDesignDeliveryFor`) e reescreveu `references/open-design.md`, mas **a `SKILL.md` — que é o que o LLM realmente executa — continuava mandando o comportamento antigo** ("gera `design-system.md` via Open Design a partir do brief"). Além disso, `openDesignFetchPlan()` só **planeja** caminhos (o engine não faz I/O), então **nada copiava os arquivos**. Resultado: uma run em 2.8.0 ainda produzia só prosa (confirmado no projeto OficinaAI — nenhum `tokens.css`/`components.html` persistido).

- **Novo `scripts/od-fetch-system.mjs` (o mecanismo de I/O que faltava):** copia os arquivos **verbatim** de um system (`tokens.css`, `components.html`, `components.manifest.json`, `USAGE.md`, `DESIGN.md`, `preview/`) para `<ui-dir>/design-systems/<id>/`. Resolve a fonte por ordem: (1) clone em disco (`~/.open-design/design-systems/<id>/`, robusto), (2) REST `GET /api/design-systems/<id>` com `Bearer` (best-effort, sem fabricar endpoint). `tokens.css` e `DESIGN.md` são obrigatórios (exit ≠ 0 se faltarem). Importa `OPEN_DESIGN.systemArtifacts` do engine (DRY).
- **`SKILL.md` agora WIRA o fluxo novo:** o estágio **FINAL** instrui rodar `od-fetch-system.mjs` para persistir os verbatim, derivar o `tokens.css` do projeto por composição rastreável, e tornar o `design-system.md` um **documento de decisões** que referencia os arquivos (modo PRD) ou dobrar no change set (modo Spec: decisões no `design.md` + capability `specs/ui-design-system/`). O **BRAINSTORM_GERAL** passa a escolher o system e a rotear o brief (`openDesignBriefRouting`). Linhas de planejamento de artefatos corrigidas (Open Design roda nos dois modos quando `hasFrontend`).
- **Verificado contra o clone real:** o script copiou o system `agentic` (tokens.css + components.html + preview/) com exit 0. Suíte: **202 testes** verdes.

## [2.8.0] — 2026-06-21

### Open Design consumido como pipeline de artefatos (não como prosa) + integração no modo Spec

Causa raiz endereçada: versões anteriores puxavam **só o `DESIGN.md`** do Open Design e o re-escreviam em prosa no `design-system.md`, descartando `tokens.css`, `components.html` e `preview/`. O agente de front-end nunca via os tokens reais → tema chapado, magic numbers, anti-padrões (emoji como ícone, `borderRadius` inventado, accent espalhado).

- **Artefatos verbatim (`OPEN_DESIGN.systemArtifacts` + `openDesignFetchPlan()`):** o Pensador agora baixa e **persiste verbatim** todos os arquivos do system na read-order oficial do `USAGE.md` (`USAGE.md → DESIGN.md → tokens.css → components.html → components.manifest.json → preview/app.html`) em `packages/ui/design-systems/<id>/`. `tokens.css` é a **fonte de verdade** (colar antes de qualquer CSS); inventar token é proibido pelo skills-protocol do Open Design.
- **`design-system.md` vira documento de decisões:** deixa de duplicar tokens; passa a registrar seleção do system, merge e overrides justificados, **apontando** para `tokens.css`/`components.html`.
- **Roteamento do brief (`openDesignBriefRouting()`):** as 8 dimensões do `AskUserQuestion` deixam de virar prosa e são roteadas para destinos estruturados do Open Design — `selection` (escolha/import do system), `input` (`od.inputs`: conteúdo/componentes), `parameter` (`od.parameters`: `accent_hue`/`section_spacing`/…), `constraint` (gate WCAG AA).
- **Integração com o modo Spec/OpenSpec (`openDesignDeliveryFor()`):** o Open Design agora **também roda no modo Spec** (antes era excluído). Os arquivos verbatim continuam indo para o repo; as **decisões** entram na seção *Decisions* do `design.md` do change; e os **requisitos** de UI viram a capability delta-spec `specs/ui-design-system/spec.md` (requisitos `SHALL` + cenários `#### Scenario:`), dando ao review um critério de aceite formal. `planArtifacts` mantém `designSystem: false` no modo Spec (sem arquivo standalone) — Open Design roda mesmo assim.
- **Acesso a arquivo verificado:** documentado que os arquivos brutos vêm via MCP `get_file` ou cópia do clone Docker — **não** fabricar endpoint REST sem confirmar o payload de `/api/design-systems/<id>`.
- **Docs/testes:** `references/open-design.md` reescrito (passos 4-7 + read order + roteamento do brief + seção **Modo Spec**); `references/openspec.md` atualizado (exceção do design-system no modo Spec). Suíte: **202 testes** verdes (7 novos cobrindo `systemArtifacts`, `briefRouting`, `fetchPlan`, `deliveryFor`).

## [2.7.2] — 2026-06-18

### Open Design via CLI real + instalador Docker (opcional, via AskUserQuestion)

- **Novo script instalador** `scripts/install-open-design.ps1` (Windows) e `scripts/install-open-design.sh` (macOS/Linux): automatiza o caminho Docker do QUICKSTART — verifica `git`/`docker`/`docker compose`, clona `nexu-io/open-design`, gera `OD_API_TOKEN` em `deploy/.env` (idempotente, preserva token existente), sobe `docker compose up -d`, aguarda o daemon em `http://localhost:7456` e conecta o MCP. Parâmetros: `-Agent`/`--agent`, `-Port`/`--port`, `-McpConfig`/`--mcp-config`, `-McpName`/`--mcp-name`, `-SkipMcp`/`--skip-mcp`.
- **Auto-wiring do MCP nos dois cenários** via novo helper `scripts/od-mcp-config.mjs`: com `od` no host usa o nativo `od mcp install <agent>`; no modo Docker (sem `od`) busca a spec canônica do daemon em `GET /api/mcp/install-info` e faz merge da entrada `mcpServers.<nome>` no `.mcp.json`, preservando o resto do arquivo (usa Node, sem `jq`/`python`). Ressalva documentada: o bridge stdio do `od mcp` precisa do `od` no host para subir; sem ele, o Pensador usa a API REST do daemon (`/api/design-systems`).
- **Fluxo do Pensador atualizado:** quando a demanda tem front-end e o Open Design não é detectado, o `AskUserQuestion` oferece **(A) instalar via Docker** (o Claude roda o script) ou **(B) `design-system.md` inline**. Após a instalação, o Pensador aciona o Open Design pelos **verbos reais**.
- **Correção de modelo:** o `od mcp install <agent>` **existe** e é o passo real de wiring do MCP (a entrada anterior do 2.7.1 dizia o contrário). O que de fato não existe é o instalador de uma linha `open-design.ai/install.sh` (404). Esclarecido também que o Open Design **não sintetiza** um DESIGN.md a partir de um brief: ele **cura/importa** systems (`od design-systems list/show/import-github/import-shadcn`) e o Pensador consolida o DESIGN.md escolhido em `design-system.md`. No modo Docker (sem `od` no host), os mesmos dados vêm da API do daemon (`/api/design-systems`).
- **Descritor `OPEN_DESIGN` (`pensador-engine.mjs`):** `installCommands` agora expõe `scriptWindows`/`scriptUnix`/`docker`/`local`/`mcp`; `commands` traz os verbos reais (`designSystemsList`, `designSystemShow`, `importGithub`, `importShadcn`, `mcpInstall`) e os equivalentes REST (`apiDesignSystems`, `apiDesignSystemById`). Removidos os verbos fictícios (`od skill list`, `od plugin apply`, `od get-file`, `od get-artifact`).
- **Docs/preflight/testes** atualizados em conjunto (`open-design.md`, `agent-stack.md`, `commands/pensador.md`, `preflight.mjs`, `README*`). Suíte: 195 testes verdes.

## [2.7.1] — 2026-06-18

### Correção — instalação/detecção do Open Design

- **Falso positivo de detecção corrigido (`preflight.mjs`):** o GNU coreutils instala um binário `od` (octal-dump) em quase todo sistema Unix-like, e `checkCli("od")` o aceitava como sucesso, reportando o Open Design como disponível quando não estava. O `checkOpenDesign()` agora filtra a assinatura "GNU coreutils" do `od --version`; a detecção confiável passa a ser a **entrada MCP registrada**, e só um `od` não-coreutils no PATH é honrado.
- **Comandos de instalação inexistentes removidos:** o `curl -fsSL https://open-design.ai/install.sh | sh -s <agent>` retornava **404** (endpoint fora do ar) e o `od mcp install` **não existe**. O Open Design é um app **local-first** (daemon + web/desktop) — agora os artefatos apontam para os métodos reais do [QUICKSTART](https://github.com/nexu-io/open-design/blob/main/QUICKSTART.md): **Docker** (`docker compose up -d`, app em http://localhost:7456) ou **pnpm** (`pnpm tools-dev run web`, Node 24 + pnpm 10.33).
- **Descritor `OPEN_DESIGN` (`pensador-engine.mjs`) atualizado:** `installCommands` agora expõe `docker`/`local`; os subcomandos fictícios `od skill list` / `od plugin apply` / `od get-file` / `od get-artifact` foram substituídos por `commands.daemonBuild` / `commands.toolsDev`, alinhados ao CLI real (`apps/daemon/dist/cli.js`).
- **Docs atualizadas:** `references/open-design.md`, `references/agent-stack.md`, `README.md` e `README.pt-BR.md` descrevem a detecção (com o aviso do falso positivo do coreutils) e a instalação local-first real.
- **Testes:** `test/integrations.test.js` agora valida os comandos reais e impede o retorno das strings fictícias. Suíte total: 195 testes verdes.

## [2.7.0] — 2026-06-18

### PRD abrangente (anti-truncamento)

- **`Strict_PRD_Schema` expandido de 10 para 17 seções obrigatórias**, cobrindo o produto inteiro na profundidade de sistemas modernos: adiciona **Escopo**, **Design System & UI/UX**, **Modelo de Dados & Domínio**, **Contratos de API & Integrações**, **Segurança/Privacidade & Conformidade (LGPD, papéis, multitenancy)**, **Observabilidade & Operação** e **Riscos & Mitigações**.
- Nova **diretriz de exaustividade (anti-truncamento)**: o PRD não tem teto de tamanho; todo gap (regra de negócio ou tecnologia) deve ser resolvido ou marcado exatamente como `"TBD"`. Proíbe placeholders rasos em Design System, Modelo de Dados e Contratos de API.
- `skills/prd/SKILL.md` e `skills/pensador/assets/prd-template.md` reescritos para as 17 seções, com IDs adicionais (`ENT-`, `EP-`) e referências cruzadas.

### Integração com o Open Design (sistema de design)

- Nova integração **opcional e condicional a front-end** com o **[Open Design](https://github.com/nexu-io/open-design)** (`od`, MCP + CLI) para fechar a lacuna de design (sem design system/tokens, a UI vira template genérico).
  - Quando `hasFrontend`, o **BRAINSTORM_GERAL** parseia um **brief de design** via `AskUserQuestion` (tom visual, marca/referências, paleta, tipografia, estados de componente, responsividade, acessibilidade, microcopy — `openDesignBriefPlan()`).
  - O **FINAL** gera o novo artefato `design-system.md` (DESIGN.md de 9 seções) via Open Design a partir do brief; modo PRD apenas, quando `hasFrontend`.
  - Detecção via preflight; indisponível quando há front-end: o Pensador oferece instalação via `AskUserQuestion` (igual ao Code Base Memory) — `curl -fsSL https://open-design.ai/install.sh | sh -s <agent>` + `od mcp install <agent>` — ou cai para um `design-system.md` inline. Nunca bloqueia e não altera o `status` do preflight.
  - Novo role de handoff `design-system` no contrato Pensador→Orchestrador.

### Engine (`pensador-engine.mjs`)

- Novos exports puros e testados:
  - `OPEN_DESIGN` (descritor: CLI `od`, comandos de instalação, schema DESIGN.md de 9 seções, arquivo `design-system.md`).
  - `designSystemArtifactPath()` — caminho do artefato sob `<featurePath>/`.
  - `openDesignBriefPlan()` — dimensões do brief de design a parsear.
- `planArtifacts()` / `buildArtifactList()`: no modo PRD planejam `design-system.md` quando `hasFrontend` (`plan.designSystem`); modo Spec inalterado.
- Typedefs `ArtifactPlan` e `Artifact` atualizados (kind `design-system`).

### Preflight (`preflight.mjs`)

- Novo bloco `integrations.openDesign` (opcional, `relevantWhen: hasFrontend`) com disponibilidade, origem da detecção, comandos de instalação e fallback. Continua saindo sempre com código 0; não afeta o `status`.

### Documentação

- Nova referência `skills/pensador/references/open-design.md`.
- `SKILL.md`, `stages.md`, `skill-stack.md`, `agent-stack.md`, `askuserquestion-protocol.md`, `openspec.md`, `ui-ux-pro-max/SKILL.md`, `frontend-design/SKILL.md`, `feature-isolation.md`, `handoff-contract.md`, `commands/pensador.md`, `README.md` e `README.pt-BR.md` atualizados para o Open Design, o artefato/role `design-system` e o PRD de 17 seções. As lentes `ui-ux-pro-max` e `frontend-design` deixaram de citar os estágios legados `UIUX`/`FRONTEND` e passaram a se descrever como lentes do `BRAINSTORM_GERAL`.

### Testes

- `test/integrations.test.js` ganhou cobertura do Open Design (descritor, `designSystemArtifactPath`, `openDesignBriefPlan`, planejamento gated por front-end). `test/artifacts.test.js` atualizado para o artefato `design-system`. Suíte total: 195 testes verdes.

## [2.6.0] — 2026-06-17

### Mudança de Estágios (STAGE_ORDER)

- **Novo estágio `EXPLORE`** inserido logo após `INIT`. `STAGE_ORDER` passou de 10 para **11 estágios**:
  `INIT → EXPLORE → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE`.
- `CHECKPOINT_VERSION` permanece `2` (o campo `artifactMode` ausente em checkpoints antigos resolve para `prd`).

### Novas Funcionalidades

#### Code Base Memory (obrigatório) — estágio EXPLORE
- Suporte ao **Code Base Memory** ([codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)) como exploração **obrigatória** do projeto, agora em um estágio dedicado `EXPLORE` (entre `INIT` e `PRD_BASE`).
  - Sequência `index_repository → get_architecture → get_graph_schema → search_graph → trace_path` (e `detect_changes` em fixes); grava o snapshot `<featurePath>/codebase-memory.md`.
  - O `ARCH` reaproveita o índice criado no `EXPLORE`, complementando com `Read`/`Glob`/`Grep`.
  - Indisponível: o Pensador pergunta via `AskUserQuestion` se deve instalar o servidor ou cair para `Read`/`Glob`/`Grep`. Não bloqueia o fluxo.

#### OpenSpec (opcional) — via comandos `openspec-*`
- Suporte opcional ao **OpenSpec** ([OpenSpec](https://github.com/Fission-AI/OpenSpec)).
  - Quando o preflight detecta o OpenSpec (CLI `openspec` no PATH ou diretório `openspec/`), o `INIT` pergunta via `AskUserQuestion` se o usuário quer gerar um **PRD** (padrão) ou uma **Spec** estruturada.
  - No modo Spec, a fase `PRD_BASE` passa a **acionar os comandos `openspec-*`** (`/openspec-new-change`, `/openspec-ff-change`, …) — o Pensador nunca escreve os arquivos manualmente. O change set (`proposal.md`, `design.md`, `tasks.md`, `specs/`) vive em `openspec/changes/<nome>/`.
  - O modo Spec entrega **apenas** o change set OpenSpec: `userhistory.md` e `comunication_json.md` não se aplicam.
  - Se os comandos `openspec-*` estiverem indisponíveis, o Pensador pergunta via `AskUserQuestion` se deve cair para PRD ou abortar — sem montar a estrutura manualmente. O prefixo legado `/opsx:*` está descontinuado.
  - O `FINAL` roda `/openspec-verify-change` e orienta o handoff com `/openspec-apply-change`, `/openspec-sync-specs` e `/openspec-archive-change`.

#### Engine (`pensador-engine.mjs`)
- `STAGE_ORDER` inclui `EXPLORE`; `Stage` typedef atualizado.
- Novos exports puros e testados:
  - `CODEBASE_MEMORY`, `codebaseMemorySnapshotPath()`, `codebaseMemoryExplorationPlan()`.
  - `ARTIFACT_MODES` / `DEFAULT_ARTIFACT_MODE`, `resolveArtifactMode()`, `withArtifactMode()`.
  - `OPENSPEC` (comandos `openspec-*`), `openspecChangeName()`, `openspecChangeDir()`.
  - `initState()` passa a incluir `artifactMode: 'prd'`.
  - `planArtifacts()` / `buildArtifactList()`: no modo Spec retornam apenas o change set OpenSpec (`proposal`/`design`/`tasks`/`specs`) sob `openspec/changes/<nome>/` (`managedBy: 'openspec'`); o modo PRD permanece idêntico.

#### Preflight (`preflight.mjs`)
- Novo bloco `integrations` no relatório: `codebaseMemory` (obrigatório) e `openspec` (opcional), com disponibilidade, origem da detecção e comportamento de fallback. A ausência do Code Base Memory degrada o status para `partial`; OpenSpec é puramente opcional. Continua saindo sempre com código 0.

### Documentação
- Novas referências `skills/pensador/references/codebase-memory.md` e `skills/pensador/references/openspec.md`.
- `SKILL.md`, `stages.md`, `feature-isolation.md`, `askuserquestion-protocol.md`, `commands/pensador.md`, `README.md` e `README.pt-BR.md` atualizados para o estágio `EXPLORE`, os 11 estágios e o modo Spec via comandos `openspec-*`.

### Testes
- Novo `test/integrations.test.js` (Code Base Memory, artifact mode, OpenSpec via `openspec-*`, spec-mode artifacts em `openspec/changes/`). Suíte total: 184 testes verdes.

## [2.5.0] — 2026-06-11

### Novas Funcionalidades

#### Modos de execução (`--modo`)
- Novo eixo de execução **ortogonal** às lentes de domínio: define qual motor realiza o trabalho pesado do fluxo (PRD base, expansão, síntese de análises, geração de artefatos).
  - `--modo claude` (padrão): o Claude Code executa o fluxo com os próprios tokens.
  - `--modo agy`: delega via `/cc-antigravity-plugin:antigravity` (padrão `--model claude-4.6-opus-thinking`).
  - `--modo kiro`: delega via `/cc-kiro-plugin:kiro` (padrão `--model claude-opus-4.8 --effort high`).
  - `--modo codex`: delega via `/codex:rescue` (padrão `--effort high`).
- **Invariante preservada:** em qualquer modo, todo diálogo com o usuário continua passando exclusivamente por `AskUserQuestion`. O motor externo nunca conversa com o usuário; só produz rascunhos/análises que o Pensador relê e consolida.
- Objetivo: baratear a geração de artefatos transferindo o custo para a quota da CLI externa, mantendo o Claude apenas como orquestrador.
- Sobrescritas `--model` (agy/kiro) e `--effort` (codex; `xhigh`/`extrahigh` → `high`); `--modo` desconhecido cai para `claude` com aviso.

#### Engine (`pensador-engine.mjs`)
- Novos exports puros e testados:
  - `EXECUTION_MODES` / `DEFAULT_EXECUTION_MODE` — registro dos modos.
  - `parseExecutionMode(rawArgs)` — extrai `--modo`/`--model`/`--effort` e devolve a `demanda`.
  - `resolveExecutionMode(mode, overrides)` — resolve o motor + parâmetro efetivo.
  - `buildDelegationInvocation(mode, payload)` — constrói o slash command de delegação com prompt JSON-quoted.

#### Preflight (`preflight.mjs`)
- Aceita `--modo <modo>` e adiciona o bloco `executionMode` ao relatório (disponibilidade do motor + fallback).
- Passa a checar o plugin do Kiro (`cc-kiro-plugin`) além de Codex e AGY. Continua saindo sempre com código 0.

#### Plugin
- `cc-kiro-plugin` adicionado como dependência cross-marketplace (junto a `cc-antigravity-plugin` e `openai-codex`).
- Versão do plugin elevada para `2.5.0`.

### Documentação
- Nova referência `skills/pensador/references/execution-modes.md`.
- `SKILL.md`, `stages.md`, `agent-stack.md`, `commands/pensador.md` e `README.md` atualizados para os modos de execução (parsing no INIT, delegação por estágio via `SlashCommand`).

### Testes
- Novo `test/execution-modes.test.js` (parse/resolve/buildDelegationInvocation). Suíte total: 161 testes verdes.

## [Unreleased]

- **Pasta de artefatos versionada por demanda** - os artefatos agora ficam em `.pensador/<slug-da-demanda>-vN/`, diretamente nessa pasta. Ex.: `/pensador desenvolva uma pagina de clientes` -> `.pensador/pagina-clientes-v1/`.

## [2.0.0] — 2026-06-05

### Breaking Changes

- **`STAGE_ORDER`** — alterado de 11 para 10 estágios. Os estágios autônomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` foram removidos; substituídos por `ARCH`, `COMPLEXITY` e `BRAINSTORM_GERAL`.
  - v1: `INIT → PRD_BASE → EXPAND → CLARITY → BACKEND → UIUX → FRONTEND → CODEX → AGY → FINAL → DONE`
  - v2: `INIT → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE`

- **`CHECKPOINT_VERSION`** — elevado de `1` para `2`. Checkpoints v1 (gravados em `pensador-output/.pensador-progress.json`) são incompatíveis com v2. O Pensador detecta a incompatibilidade no INIT e oferece iniciar um novo fluxo v2.

- **Pasta de artefatos** — no v2, os artefatos ficam em `.pensador/<slug-da-demanda>-vN/`. Saídas legadas da v1 não são movidas automaticamente.

- **`REQUIREMENT_STAGES`** — alterado de `['EXPAND','CLARITY','BACKEND','UIUX','FRONTEND','CODEX','AGY']` para `['EXPAND','BRAINSTORM_GERAL','CODEX','AGY']`.

### Novas Funcionalidades

#### Estágio ARCH (análise de arquitetura)
- Varre o projeto via `Read`/`Glob`/`Grep` antes de expandir requisitos.
- Detecta linguagem, estrutura, padrões arquiteturais, design system, entrypoints e integrações.
- Modo greenfield: entrevista de preferências quando não há base de código relevante.
- Suporte a monorepos: lista sub-projetos e confirma escopo.
- Grava `<featurePath>/architecture.md` com retrato da arquitetura, sinais de complexidade e lacunas técnicas.

#### Estágio COMPLEXITY (heurística de complexidade)
- Calcula score (0–4) com `detectComplexity(signals)` usando quatro sinais binários:
  - `domainCount > 1`, `hasBackend`, `hasBroadScopeKeywords`, `isGreenfield`
- Score 0–1 → sugere **Lite** (fluxo enxuto); score ≥ 2 → sugere **Completo** (fluxo integral).
- Desempate sempre resolve para Completo.
- Usuário sempre confirma ou altera o modo via `AskUserQuestion`.

#### Estágio BRAINSTORM_GERAL (brainstorm paralelo por domínio)
- Substitui os quatro estágios autônomos de brainstorm.
- Roteamento por domínio:
  - `requirements-clarity` — sempre (clareza de requisitos)
  - `codex:codex-rescue` `--effort high` — quando `hasBackend = true`
  - `cc-antigravity-plugin:antigravity-agent` `gemini-3.1-pro-high` — quando `hasFrontend = true`
- Contrato de arquivos em `shared-agents/`:
  - `context-pack.md` — gravado pelo orquestrador antes do dispatch
  - `<agent>.response.md` — resposta de cada participante
- Fallback por domínio: domínio falho não aborta os demais; pergunta de fallback via `AskUserQuestion`.

#### Isolamento por feature
- Cada execução cria (ou retoma) `.pensador/<slug-da-demanda>-vN/` com `shared-agents/` e artefatos finais diretamente na pasta.
- Versionamento local por demanda: primeira execução usa `-v1`; novas execuções com o mesmo slug usam `-v2`, `-v3`, ...
- `allocateFeatureDir(existingFeatureDirs, options)` — função pura no engine.
- `buildFeaturePath(featureDir, subdir)` — constrói caminhos derivados do `featurePath`.
- Retomada: no INIT, checkpoint v2 incompleto detectado → `AskUserQuestion` (retomar ou novo fluxo).

#### Melhorias de UX (AskUserQuestion)
- Opção recomendada sempre em primeiro lugar com sufixo "(Recomendado)".
- Previews para opções com artefatos concretos.
- Recap final antes do FINAL: resumo de todas as decisões do fluxo.
- Handoff por complexidade ao encerrar.
- PT-BR como idioma padrão dos artefatos.

### Mudanças no Engine (`pensador-engine.mjs`)

Novos exports públicos:
- `detectComplexity(signals)` — heurística determinística de complexidade
- `allocateFeatureDir(existingFeatureDirs, options)` — alocação de diretório por feature
- `buildFeaturePath(featureDir, subdir)` — construção de caminhos derivados

Outros:
- `initState()` agora inclui campo `featurePath: null`
- `buildArtifactList()` usa `state.featurePath` como basePath (fallback: `.pensador/atualizacao-v1/`)
- `deserializeState()` retorna `null` para checkpoints com `version !== 2`

### Testes

- Suíte expandida de 102 para 131 testes (100% verde).
- Novos arquivos:
  - `test/engine-complexity.test.js` — unitários + property-based (fast-check) para `detectComplexity`
  - `test/feature-isolation.test.js` — `allocateFeatureDir` e `buildFeaturePath`
- Atualizados: `test/smoke.test.js`, `test/consolidate.test.js`, `test/artifacts.test.js`, `test/docs-consistency.test.js`

### Guia de Migração

1. **Checkpoints v1** (`pensador-output/.pensador-progress.json`): não são convertidos automaticamente. O Pensador v2 detecta e oferece iniciar novo fluxo.
2. **Saídas legadas v1**: permanecem intactas; o v2 nunca grava artefatos fora de `.pensador/<slug-da-demanda>-vN/`.
3. **`.gitignore`**: adicionar `.pensador/` se ainda não estiver presente.
4. **Scripts customizados** que importavam `STAGE_ORDER` ou `REQUIREMENT_STAGES` precisam ser atualizados para os novos valores.

---

## [1.0.0] — 2025 (baseline)

- Fluxo de 8 estágios: PRD_BASE, EXPAND, CLARITY, BACKEND, UIUX, FRONTEND, CODEX, AGY, FINAL.
- Artefatos em pasta raiz legada.
- `CHECKPOINT_VERSION = 1`.
