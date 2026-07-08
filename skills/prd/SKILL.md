---
name: prd
description: Skill_PRD_Base — fonte da verdade do PRD do Pensador. Define o Strict_PRD_Schema (17 seções obrigatórias, abrangendo produto, UX/design system, dados, API, segurança/LGPD, observabilidade e arquitetura), a entrevista de descoberta e os padrões de qualidade (completude, profundidade, clareza, testabilidade, consistência, rastreabilidade). Aplicada no estágio PRD_BASE e no estágio FINAL para estruturar prd.md. O PRD nunca é truncado: todo gap (de regra de negócio ou de tecnologia) deve ser resolvido ou marcado explicitamente como "TBD".
---

# Skill_PRD_Base — Base de PRD

Esta skill é a **fonte da verdade** para a estrutura, entrevista de descoberta e padrões de qualidade de todo PRD produzido pelo Pensador. Ela define o `Strict_PRD_Schema` que deve ser aplicado no estágio **PRD_BASE** (geração do `PRD_Base`) e no estágio **FINAL** (geração do `prd.md`).

O objetivo do PRD é **detalhar o produto por inteiro** — front-end, back-end, dados, integrações, segurança e arquitetura — no nível de profundidade do desenvolvimento de sistemas modernos. **Não limite o PRD.** Cada gap, seja de regra de negócio ou de tecnologia, deve ser resolvido com base nos requisitos consolidados ou marcado explicitamente como `"TBD"`.

---

## Diretriz de exaustividade (anti-truncamento)

> **O PRD não tem teto de tamanho.** Ele deve ser tão extenso quanto o produto exigir. Nunca encurte, resuma ou omita seções/itens por brevidade.

Regras inegociáveis:

- **Cobertura completa:** toda funcionalidade, fluxo, entidade, contrato, integração, estado de UI e regra de negócio mencionados ou implicados pela demanda devem aparecer no PRD.
- **Resolver gaps, não cortar:** quando um gap for identificado (em EXPAND, BRAINSTORM_GERAL, CODEX ou AGY), incorpore a resolução na seção pertinente. Se a informação realmente não existir, marque `"TBD"` — nunca apague o tópico.
- **Sem placeholders rasos:** seções como Design System, Modelo de Dados e Contratos de API não podem ficar com uma frase genérica. Detalhe tokens, entidades, endpoints e payloads.
- **Granularidade de requisitos:** prefira muitos requisitos específicos e testáveis a poucos requisitos amplos. Cada RF deve ter ao menos um critério de aceite.
- **Rastreabilidade:** mantenha IDs (`RF-`, `RNF-`, `UC-`, `CA-`, `ENT-`, `EP-`) únicos e cruzados entre seções.

---

## Strict_PRD_Schema

O `Strict_PRD_Schema` define as seções obrigatórias que **todo** PRD produzido pelo Pensador deve conter, na ordem abaixo. Nenhuma seção pode ser omitida, renomeada ou fundida. Quando a informação para uma seção não estiver disponível no momento da geração, o valor deve ser exatamente `"TBD"`.

### Seções Obrigatórias

| # | Seção | Descrição |
|---|-------|-----------|
| 1 | **Visão Geral** | Resumo executivo: o que é, para quem serve e qual valor entrega. |
| 2 | **Problema & Contexto** | Dor/necessidade concreta, contexto de negócio e impacto de não resolver. |
| 3 | **Objetivos & Métricas de Sucesso** | Metas mensuráveis, KPIs e metas quantitativas. |
| 4 | **Público-Alvo & Personas** | Perfis de usuário, papéis, necessidades e familiaridade técnica. |
| 5 | **Escopo** | Incluído, fora de escopo, premissas e restrições. |
| 6 | **Requisitos Funcionais** | Funcionalidades que o sistema deve prover (IDs `RF-`). |
| 7 | **Requisitos Não-Funcionais** | Desempenho, segurança, escalabilidade, disponibilidade (IDs `RNF-`). |
| 8 | **Design System & UI/UX** | Identidade visual, design tokens, tipografia, componentes, estados, responsividade, acessibilidade e microcopy. Referencia `design-system.md` (Open Design). |
| 9 | **Casos de Uso & Fluxos** | Cenários de interação, fluxos principais, alternativos e de erro (IDs `UC-`). |
| 10 | **Modelo de Dados & Domínio** | Entidades, atributos, relacionamentos, regras de domínio e ciclo de vida (IDs `ENT-`). |
| 11 | **Contratos de API & Integrações** | Endpoints, payloads de request/response, erros e integrações externas. |
| 12 | **Segurança, Privacidade & Conformidade** | AuthN/AuthZ, papéis, multitenancy, LGPD/consentimento, dados sensíveis. |
| 13 | **Observabilidade & Operação** | Logs, métricas, tracing, alertas, backup, deploy/CI-CD e ambientes. |
| 14 | **Critérios de Aceite** | Condições verificáveis por requisito (IDs `CA-`, cruzados com `RF-`). |
| 15 | **Arquitetura** | Componentes, stack, decisões técnicas e diagrama. |
| 16 | **Riscos & Mitigações** | Riscos técnicos/produto/negócio, probabilidade, impacto e mitigação. |
| 17 | **Plano de Entrega** | Fases/milestones com escopo (por `RF-`) e estimativas (IDs `EP-`). |

#### Regra TBD

> Quando uma seção obrigatória não puder ser preenchida com base nas informações disponíveis no momento da geração (demanda inicial no estágio PRD_BASE, ou requisitos consolidados no estágio FINAL), o valor dessa seção deve ser exatamente a string `"TBD"`.
> Uma seção marcada `"TBD"` indica lacuna explícita — não ausência — e deve ser resolvida nos estágios subsequentes ou na revisão humana.

---

## Entrevista de Descoberta (estágio PRD_BASE)

A entrevista de descoberta orienta o preenchimento inicial do `PRD_Base`. Aplique-a no estágio PRD_BASE para extrair informações da demanda e identificar quais seções ficam como `"TBD"`. Quando a demanda não responder a uma pergunta, a seção correspondente recebe `"TBD"`.

#### Visão Geral
- Em uma frase, o que esta solução faz? Qual o principal valor ao usuário final?

#### Problema & Contexto
- Qual dor concreta resolve? Qual o contexto de negócio e o impacto de não ter a solução?

#### Objetivos & Métricas de Sucesso
- Como o sucesso será medido (métricas/KPIs)? Há meta quantitativa ou prazo?

#### Público-Alvo & Personas
- Quem são os usuários principais? Há perfis secundários, administradores ou papéis distintos?

#### Escopo
- O que está incluído no MVP? O que fica explicitamente fora? Quais premissas e restrições?

#### Requisitos Funcionais
- Quais funcionalidades são imprescindíveis? Há fluxos de trabalho (workflows/steps) e estados?

#### Requisitos Não-Funcionais
- Restrições de desempenho, segurança, disponibilidade? A solução precisa escalar? Em que dimensão?

#### Design System & UI/UX
- Há identidade visual/marca ou referências (ex.: "tipo Linear/Vercel")? Tom visual desejado?
- Existem tokens (cores, tipografia, espaçamento) e padrões de componente/estados definidos?
- Requisitos de responsividade, acessibilidade (alvo WCAG) e microcopy?

#### Casos de Uso & Fluxos
- Qual o fluxo principal? Há fluxos alternativos, de erro e workflows multi-etapa?

#### Modelo de Dados & Domínio
- Quais entidades e relacionamentos existem? Há regras de domínio e ciclo de vida (estados)?

#### Contratos de API & Integrações
- Quais endpoints/contratos? Há integrações externas (gateways, e-mail, storage, etc.)?

#### Segurança, Privacidade & Conformidade
- Como é autenticação/autorização? Há papéis e multitenancy? Há dados pessoais/LGPD e consentimento?

#### Observabilidade & Operação
- Como será monitorado (logs/métricas/alertas)? Como é o deploy/CI-CD e os ambientes?

#### Critérios de Aceite
- Como saberemos que cada funcionalidade está "pronta"? Há checklists de aceite?

#### Arquitetura
- Há decisões tecnológicas já tomadas (linguagem, framework, nuvem)? É front-end, back-end, fullstack ou monorepo?

#### Riscos & Mitigações
- Quais riscos técnicos, de produto ou de negócio? Como mitigá-los?

#### Plano de Entrega
- Há marcos/fases definidos? Qual o prazo-alvo do primeiro lançamento?

---

## Padrões de Qualidade do PRD

Estas regras aplicam-se tanto ao `PRD_Base` (estágio PRD_BASE) quanto ao `prd.md` final (estágio FINAL).

### 1. Completude e Profundidade

- **Todas as 17 seções do `Strict_PRD_Schema` devem estar presentes**, na ordem definida.
- Nenhuma seção pode ser removida, renomeada ou fundida com outra.
- Seções sem informação suficiente recebem `"TBD"` — nunca ficam em branco.
- O PRD detalha o produto inteiro (front-end, back-end, dados, integrações, segurança, arquitetura). Não há limite de extensão; não encurte por brevidade.

### 2. Clareza

- Cada requisito funcional é afirmativo e sem ambiguidade: "O sistema **deve** [ação] [objeto] [condição]".
- Evite termos vagos sem definição: "rápido", "fácil", "adequado".
- Cada caso de uso identifica ator, pré-condição, sequência de passos e resultado esperado.
- Critérios de aceite são verificáveis por humano ou automação.

### 3. Testabilidade

- Todo requisito funcional tem ao menos um critério de aceite associado.
- Requisitos não-funcionais incluem limiares mensuráveis quando possível (ex.: "resposta < 500 ms em 95% das requisições").
- Casos de uso cobrem fluxo principal e ao menos um fluxo alternativo ou de erro relevante.

### 4. Consistência

- Terminologia usada de forma uniforme entre seções (use o glossário da demanda).
- IDs (`RF-`, `RNF-`, `UC-`, `CA-`, `ENT-`, `EP-`) únicos e cruzados entre Requisitos, Casos de Uso, Critérios de Aceite, Modelo de Dados e Plano de Entrega.

### 5. Rastreabilidade

- O `prd.md` final reflete as respostas registradas nos estágios de trabalho (EXPAND, BRAINSTORM_GERAL, CODEX e AGY).
- Requisitos derivados de lacunas identificadas pelo Codex ou pelo AGY são incorporados nas seções pertinentes do `Strict_PRD_Schema`.
- A seção **Design System & UI/UX** referencia os arquivos verbatim do Open Design em `design-systems/<id>/` (o `DESIGN.md` é o documento de design) ou, no fallback sem Open Design, o `design-system.md` inline; a seção **Contratos de API & Integrações** referencia o contrato máquina-legível (fonte da verdade) e o `communication.md` (visão derivada) quando há back-end.

---

## Uso por Outros Componentes

| Componente | Como usa esta skill |
|------------|---------------------|
| `skills/pensador/SKILL.md` | Carrega esta skill para aplicar o `Strict_PRD_Schema` no estágio PRD_BASE e no estágio FINAL. |
| `scripts/pensador-engine.mjs` | Recebe as seções obrigatórias como `requiredSections` em `buildPrdBase(demanda, requiredSections)`. |
| `skills/pensador/assets/prd-template.md` | Template de saída que espelha as 17 seções do schema. |
| `skills/pensador/references/open-design.md` | Detalha a seção **Design System & UI/UX** e a geração de `design-system.md`. |

---

## Resumo das Seções Obrigatórias (referência rápida)

```
1.  Visão Geral
2.  Problema & Contexto
3.  Objetivos & Métricas de Sucesso
4.  Público-Alvo & Personas
5.  Escopo
6.  Requisitos Funcionais
7.  Requisitos Não-Funcionais
8.  Design System & UI/UX
9.  Casos de Uso & Fluxos
10. Modelo de Dados & Domínio
11. Contratos de API & Integrações
12. Segurança, Privacidade & Conformidade
13. Observabilidade & Operação
14. Critérios de Aceite
15. Arquitetura
16. Riscos & Mitigações
17. Plano de Entrega
```

Todas obrigatórias. Ausência de informação → `"TBD"`. Nunca trunque o PRD.
