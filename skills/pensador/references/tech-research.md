# Pesquisa Tecnica (track tecnico do estagio RESEARCH)

O estagio `RESEARCH` tem **dois tracks**, e eles respondem perguntas diferentes:

| Track | Pergunta | Descritor | Snapshot | Referencia |
|---|---|---|---|---|
| `business` | O que essa **categoria de produto** entrega? | `WEB_RESEARCH` | `market-research.md` | `references/web-research.md` |
| `technical` | Como essa **stack** e construida **hoje**? | `TECH_RESEARCH` | `tech-research.md` | este documento |

Ambos rodam no mesmo estagio, gravam snapshots proprios e alimentam o **Prompt System** compartilhado.

---

## Por que o track tecnico nao pode ser respondido de memoria

O conhecimento de um LLM sobre um ecossistema em movimento esta congelado no corte de treinamento — e o modo de falha e **silencioso**. Pedindo "tela de login com React + TypeScript e back-end em C#", um modelo pode produzir com total confianca um PRD ancorado em padroes que a documentacao oficial ja substituiu:

- componentes de classe onde o ecossistema ja padronizou outra abordagem;
- busca de dados no padrao de duas versoes atras;
- JWT feito a mao onde o framework ja entrega uma stack de identidade suportada;
- estrutura de pastas de um major anterior;
- pacote de teste que deixou de ser o default do ecossistema.

O PRD entao vira a **especificacao de construir o aplicativo de ontem** — e todo estagio seguinte (Orquestrador, Executor) implementa fielmente a decisao vencida.

Dai a regra do track: para toda tecnologia sensivel a versao, a **versao estavel atual** e a **abordagem recomendada atual** sao **pesquisadas, nunca lembradas**.

> **Nota de design.** `TECH_STACK_REGISTRY` **nao guarda numero de versao**. Fixar "React 19" ou ".NET 10" no registro recriaria exatamente a obsolescencia que este track existe para eliminar. O registro guarda so **onde a verdade mora** (`docsUrl`) e **se precisa ser checada** (`versionSensitive`).

---

## Passo a passo

### 1. Detectar a stack

`detectTechStack(texto)` casa o texto contra `TECH_STACK_REGISTRY`. O texto e a **demanda concatenada com o snapshot do EXPLORE** — assim, em brownfield, a stack vem do codigo existente e nao precisa ser perguntada de novo.

O casamento e por **fronteira de palavra sensivel a nao-alfanumericos** (`matchesKeyword`), nao por substring. Isso e o que torna `c#`, `.net` e `go` detectaveis sem os falsos positivos que um `includes()` produziria:

| Texto | `includes()` | `matchesKeyword()` |
|---|---|---|
| "vou fazer **algo** diferente" | detecta `go` ✗ | nao detecta ✓ |
| "busca no **google**" | detecta `go` ✗ | nao detecta ✓ |
| "back-end com **C#**" | detecta ✓ | detecta ✓ |
| "**asp.net** core" | detecta ✓ | detecta ✓ |

`\b` nao serve aqui: `c#`, `.net` e `c++` comecam/terminam em caractere nao-palavra, entao `\bc#\b` nunca dispara. A fronteira e expressa como lookaround sobre a classe alfanumerica.

O retorno traz `ids`, `byCategory`, `frontend`, `backend`, `versionSensitive` e `detected`. A ordem do registro e preservada, entao uma entrada especifica (Next.js, React Native) e reportada antes da mais ampla que a contem (React).

Tecnologia **fora do registro** nao e descartada: `resolveTechEntry()` devolve uma entrada generica de categoria `unknown` (com `versionSensitive: true`, porque assumir versao antiga de framework desconhecido e o erro mais caro), e ela entra no plano com os angulos genericos.

### 2. Fechar as lacunas da stack antes de pesquisar

`inferStackGaps(detected, demanda)` encontra o que esta **subespecificado** e devolve a pergunta pronta com candidatos concretos. Isso evita o pior desperdicio: pesquisar com confianca a coisa errada.

| Lacuna | Quando dispara | Candidatos |
|---|---|---|
| `backend-framework-missing` | Ha linguagem de servidor mas nenhum framework | `SERVER_LANGUAGE_FRAMEWORKS[<lang>]` |
| `auth-approach-missing` | A demanda fala de login/autenticacao mas nenhuma tech de auth foi escolhida | conforme o back-end detectado |
| `database-missing` | Ha back-end mas nenhum banco definido | `postgres`, `sqlserver`, `mysql`, `mongodb` |

Exemplo real, com a demanda `"tela de login com autenticacao e cadastro de usuario, front-end React e TypeScript, back-end com C#"`:

```text
* backend-framework-missing → dotnet
  "A demanda cita C# no back-end, mas nao o framework. Qual sera usado?
   (candidatos do ecossistema: ASP.NET Core (.NET))"

* auth-approach-missing → aspnet-identity | oidc | jwt
  "A demanda envolve login/autenticacao, mas nao define a abordagem. Usar qual?
   A escolha muda o que a pesquisa tecnica precisa confirmar
   (armazenamento de token, refresh, hashing, lockout)."

* database-missing → postgres | sqlserver | mysql | mongodb
  "Ha back-end mas nenhum banco de dados definido. Qual sera usado?"
```

Cada lacuna vira `AskUserQuestion` com `origin = 'web-research'`. **Nao adivinhe**: "C# no back-end" nao diz ASP.NET Core, e "tela de login" nao diz a abordagem de auth.

Uma linguagem de servidor conta como o lado back-end da fronteira mesmo sem framework — se nao contasse, `backend` viria vazio e os angulos de integracao front↔back (os mais valiosos numa feature de login) nunca disparariam.

### 3. Decidir relevancia, profundidade e diferimento

`techResearchRelevance({ stackDetected, isGreenfield, isInternalOnly, touchesArchitecture, techCount })` devolve `{ relevant, depth, deferToArch, reason }`.

- `relevant: false` — demanda sem impacto de arquitetura/implementacao.
- **`deferToArch: true`** — o caso importante: quando nenhuma stack pode ser detectada (nem na demanda, nem no codigo), **nao ha o que pesquisar ainda**. A stack so e resolvida no `ARCH` (analise do projeto ou entrevista greenfield). O track e marcado `DEFERRED` e o **ARCH executa o top-up** com a stack resolvida, reaproveitando as mesmas funcoes de plano. Isso mantem o fluxo honesto, em vez de pesquisar uma stack que o usuario nao escolheu.
- `depth`: `completo` quando greenfield ou `techCount >= 3`; `lite` caso contrario.

### 4. Executar o plano de consultas

`techResearchQueryPlan({ stack, demanda, depth })` monta o plano em **tres fases**, para que o orcamento nunca seja consumido pela primeira tecnologia da lista:

**Fase 1 — `version-currency` (obrigatoria, protegida).** Uma consulta por tecnologia sensivel a versao, usando `TECH_VERSION_ANGLE`. Vem **primeiro** de proposito: toda resposta posterior ("estrutura recomendada", "abordagem de auth recomendada") so tem sentido em relacao ao major atual. Esta e a fase que neutraliza o corte de treinamento.

**Context7 (`checks.optional.mcp.context7` do preflight), quando disponivel, e a fonte preferida desta fase** — documentacao oficial versionada em vez de resultado de busca generico, coerente com a inversao de tiers de fonte da secao seguinte. Ordem obrigatoria, sem atalho: **resolver o identificador da biblioteca (nome livre -> identificador do Context7) antes de pedir a documentacao**, mesmo quando o identificador "ja e conhecido" de uma consulta anterior na mesma feature — nome de pacote e identificador do servidor nao sao a mesma coisa, e pedir documentacao de um identificador inventado devolve conteudo errado ou vazio. Quando a stack detectada fixa versao (manifest do projeto, em brownfield), passe essa versao na consulta. Sem Context7 disponivel, a fase segue via `WebSearch`/`WebFetch` normalmente — a ausencia nunca bloqueia o RESEARCH.

**Fase 2 — `stack-patterns` em round-robin.** Primeiro angulo de cada tecnologia, depois o segundo de cada, e assim por diante. Um laco ingenuo por tecnologia gastava o orcamento inteiro em React e deixava o back-end C# praticamente sem consulta.

**Fase 3 — cross-cutting (vagas reservadas).** `integration-contract`, `auth-flow` e `project-conventions` dependem da **combinacao** front/back, e nenhuma consulta por tecnologia os revela. As vagas sao reservadas antes do truncamento — antes eram justamente os primeiros a serem cortados, o que era o inverso do correto: a fronteira front↔back e onde os erros de integracao se concentram.

O truncamento, portanto, **so consome a fase 2**.

Angulos por categoria em `TECH_CATEGORY_ANGLES` (mantidos na **categoria**, nao em cada uma das ~70 entradas do registro: adicionar tecnologia e uma linha, e ela ja herda as perguntas certas).

Exemplo do plano real para `react + typescript + csharp + dotnet + aspnet-identity + sqlserver`, profundidade `completo`:

```text
t1  [version-currency]      react latest stable version release notes breaking changes
t2  [version-currency]      typescript latest stable version release notes breaking changes
t3  [version-currency]      c# latest stable version release notes breaking changes
t4  [version-currency]      asp.net core (.net) latest stable version ...
t5  [version-currency]      asp.net core identity latest stable version ...
t6  [stack-patterns]        react official project structure recommended patterns
t7  [stack-patterns]        typescript style guide coding conventions official
t8  [stack-patterns]        c# style guide coding conventions official
t9  [stack-patterns]        asp.net core (.net) project structure architecture layers ...
t10 [stack-patterns]        asp.net core identity secure implementation token storage refresh ...
t11 [stack-patterns]        sql server schema indexing best practices
t12 [stack-patterns]        react data fetching state management recommended approach docs
t13 [stack-patterns]        typescript project structure best practices modern
t14 [integration-contract]  react asp.net core (.net) integracao api contrato tipos boas praticas
t15 [auth-flow]             react asp.net core (.net) autenticacao login token refresh ... seguranca
t16 [project-conventions]   react convencoes de projeto lint formatacao estrutura de pastas
```

### 5. Qualidade de fonte (diferente do track de negocio)

`TECH_RESEARCH.sourceTiers`, melhor primeiro:

1. `official-docs` — a documentacao do proprio framework/linguagem.
2. `release-notes` — changelogs, RFCs, ADRs, guias de migracao.
3. `reputable-guide` — referencias de engenharia e style guides reconhecidos.
4. `community` — blogs, Stack Overflow, foruns.

A inversao em relacao ao track de negocio e proposital: para uma afirmacao de **mercado**, a pagina do fornecedor e enviesada; para uma afirmacao sobre **framework**, o fornecedor **e** a autoridade. `requiresOfficialSource: true` — um padrao so pode ser registrado como `current` com respaldo da documentacao oficial.

### 6. Cobrir as 10 dimensoes

`TECH_RESEARCH_DIMENSIONS` e a checklist explicita, para a pesquisa nao parar em "qual e a versao atual":

`stackVersions` · `projectStructure` · `architecturePatterns` · `designPatterns` · `conventions` · `securityPatterns` · `testingStrategy` · `performancePatterns` · `antiPatterns` · `officialReferences`

### 7. Classificar a adocao de cada padrao

`classifyPatternAdoption({ discouraged, replacedBy, experimental, inOfficialDocs, sourceAgeMonths })` — o gate que mantem pratica vencida fora do PRD. Precedencia, sinal mais forte primeiro:

| Resultado | Quando | Pode virar decisao do PRD? |
|---|---|---|
| `deprecated` | a doc oficial desencoraja, ou existe substituto documentado (`replacedBy`) | Nao — vai para `technicalAntiPatterns` |
| `experimental` | marcado como experimental/preview/RFC | Sim, se escolhido **consciente** e registrado como risco |
| `current` | respaldado pela doc oficial **e** evidencia recente (≤ `PATTERN_STALENESS_MONTHS`, 24 meses) | Sim |
| `legacy` | qualquer outro caso | Só com justificativa explicita |

`PATTERN_STALENESS_MONTHS` existe porque um tutorial de 2019 pode continuar **correto** sem ser a **pratica recomendada hoje** — e a segunda coisa e a que o PRD precisa.

### 8. Gravar

- Snapshot `<featurePath>/tech-research.md` (`techResearchSnapshotPath()`): stack com versao pesquisada, estrutura de projeto, padroes de arquitetura/design com `adoption`, convencoes, baseline de seguranca, estrategia de teste, **anti-padroes** e as URLs oficiais de cada decisao. Arquivo de **trabalho**, fora de `buildArtifactList`.
- Estado via `withTechResearch(state, research)`: `techStack` + `techResearch` (`status` `DONE` | `PARTIAL` | `DEFERRED` | `SKIPPED`, `versions`, `patterns`, `conventions`, `antiPatterns`, `sources`, `notes`). Persistido no checkpoint v2.

---

## Onde o resultado e consumido

`TECH_RESEARCH.consumers`:

| Consumidor | Uso |
|---|---|
| `prd-base` | PRD §7 (RNF), §10 (modelo de dados), §11 (contratos de API), §12 (seguranca), §15 (arquitetura e decisoes tecnicas) |
| `arch` | `architecture.md` registra o baseline pesquisado; e executa o **top-up** quando o track ficou `DEFERRED` |
| `brainstorm-backend` | Lente primaria `backend-development` + Codex `refine` |
| `brainstorm-frontend` | `ui-ux-pro-max` / `frontend-design` + AGY `refine` |
| `codex` | A varredura tecnica raciocina sobre as convencoes pesquisadas, nao sobre as lembradas |
| `handoff` | Orquestrador/Executor implementam seguindo essas convencoes |

As secoes tecnicas do Prompt System (`PROMPT_SYSTEM_SECTION_GROUPS.technical`) sao: `techStack`, `architectureBaseline`, `designPatterns`, `codingConventions`, `securityBaseline`, `testingBaseline`, `technicalAntiPatterns`. Um consumidor injeta so o grupo de que precisa — o brief do Open Design nao tem uso para convencoes de ORM, e a lente de back-end nao tem uso para precificacao de concorrente.

---

## Gate

`tech-research.md` gravado (`DONE`, `PARTIAL` com lacunas marcadas, `DEFERRED` com o top-up agendado no ARCH, ou `SKIPPED` com motivo) **e** as perguntas de lacuna de stack (`inferStackGaps`) respondidas ou diferidas.

---

## Anti-padroes

- **Responder a stack de memoria.** E o erro que este track existe para eliminar. Versao atual e abordagem recomendada sao **pesquisadas**.
- **Fixar versao no registro.** `TECH_STACK_REGISTRY` guarda `docsUrl` e `versionSensitive`, nunca `"19.0"`.
- **Pesquisar antes de fechar as lacunas.** "C# no back-end" nao e ASP.NET Core por decreto do Pensador.
- **Registrar padrao como `current` sem fonte oficial.** `requiresOfficialSource` e obrigatorio.
- **Levar `deprecated` para o PRD.** Vai para anti-padroes, com o substituto documentado.
- **Gastar o orcamento na primeira tecnologia.** O plano e round-robin com fases protegidas por construcao.
- **Cortar os angulos cross-cutting.** Sao vaga reservada: a fronteira front↔back e onde os erros se concentram.
- **Duplicar a pergunta de stack no ARCH.** Se o RESEARCH ja resolveu, o ARCH reaproveita; se ficou `DEFERRED`, o ARCH resolve **e** roda o top-up.

---

## Referencias relacionadas

- `references/web-research.md` — o track de negocio/mercado do mesmo estagio.
- `references/stages.md` — comportamento e gate de cada estagio.
- `references/codebase-memory.md` — o `EXPLORE`, que alimenta a deteccao de stack em brownfield.
- `skills/backend-development/SKILL.md` — lente primaria que consome o baseline tecnico.
- `skills/prd/SKILL.md` — `Strict_PRD_Schema`; o track tecnico alimenta as secoes 7, 10, 11, 12 e 15.
