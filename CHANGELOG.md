# Changelog

## [2.15.0] — 2026-08-25

### Superfície de comando unificada e legível

Os três plugins do pipeline (`/pensador` → `/orquestrador` → `/executor`) passam a compartilhar a mesma gramática de subcomandos e o mesmo vocabulário de flags, em inglês. O `commands/pensador.md` foi reorganizado para começar pela interface — Sinopse, Subcomandos reservados e Flags — com a narrativa dos doze estágios comprimida numa tabela que aponta para `references/stages.md`.

- **`--modo` → `--mode`.** O nome antigo continua aceito em silêncio, com efeito idêntico e sem aviso de depreciação. O alias vale tanto em `parseExecutionMode()` quanto no `preflight.mjs`.
- **Novos subcomandos:** `help`, `preflight`, `status`, `resume [slug]` e `config`. `status` e `resume` expõem como comando a lógica de checkpoint que só existia como pergunta dentro do INIT; `config` é read-only (o Pensador não persiste configuração — quem grava a stack do projeto é `/orquestrador project-config`).
- `argument-hint` passa a declarar a superfície completa.
- O handoff aponta para `/cc-orchestrador-subagents:orquestrador` (o alias em português foi renomeado de `/orchestrador`); `handoff-contract.md` acompanha nas três cópias byte-idênticas.

> **Nota de implementação.** `--mode` é prefixo estrito de `--model`, então a alternância `mode|modo` poderia engolir o flag de modelo. O separador obrigatório (`=` ou espaço) é o que impede isso: `--mode` seguido de `l` falha e o texto cai no extrator de `--model`. `test/execution-modes.test.js` cobre as duas ordens de aparição, já que o extrator de modo roda antes do de modelo.

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
