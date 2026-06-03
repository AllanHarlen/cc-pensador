# Skill_PRD_Base — Base de PRD

Esta skill é a **fonte da verdade** para a estrutura, entrevista de descoberta e padrões de qualidade de todo PRD produzido pelo Pensador. Ela define o `Strict_PRD_Schema` que deve ser aplicado no Estágio 1 (geração do `PRD_Base`) e no Estágio Final (geração do `prd.md`).

---

## Strict_PRD_Schema

O `Strict_PRD_Schema` define as seções obrigatórias que **todo** PRD produzido pelo Pensador deve conter, na ordem abaixo. Nenhuma seção pode ser omitida. Quando a informação para uma seção não estiver disponível no momento da geração, o valor deve ser exatamente `"TBD"`.

### Seções Obrigatórias

| # | Seção | Descrição |
|---|-------|-----------|
| 1 | **Visão Geral** | Resumo executivo da solução: o que é, para quem serve e qual valor entrega. |
| 2 | **Problema** | Descrição clara do problema ou necessidade que a solução endereça. |
| 3 | **Objetivos** | Metas mensuráveis que o produto deve atingir (ex.: KPIs, métricas de sucesso). |
| 4 | **Público-Alvo** | Perfis de usuário (personas) que utilizarão a solução. |
| 5 | **Requisitos Funcionais** | Lista numerada de funcionalidades que o sistema deve prover. |
| 6 | **Requisitos Não-Funcionais** | Qualidade do sistema: desempenho, segurança, escalabilidade, disponibilidade, etc. |
| 7 | **Casos de Uso** | Cenários de interação entre o usuário e o sistema, incluindo fluxos alternativos. |
| 8 | **Critérios de Aceite** | Condições verificáveis que determinam quando cada requisito está satisfeito. |
| 9 | **Arquitetura** | Visão de alto nível dos componentes, integrações e decisões técnicas fundamentais. |
| 10 | **Plano de Entrega** | Fases ou milestones de implementação com escopo e estimativas de prazo. |

#### Regra TBD

> Quando uma seção obrigatória não puder ser preenchida com base nas informações disponíveis no momento da geração (demanda inicial no Estágio 1, ou requisitos consolidados no Estágio Final), o valor dessa seção deve ser exatamente a string `"TBD"`.  
> Uma seção marcada `"TBD"` indica lacuna explícita — não ausência — e deve ser resolvida nos estágios subsequentes ou na revisão humana.

---

## Entrevista de Descoberta (Estágio 1)

A entrevista de descoberta orienta o preenchimento inicial do `PRD_Base`. Aplique-a no Estágio 1 para extrair informações da demanda e identificar quais seções ficam como `"TBD"`.

### Roteiro de Perguntas

Use estas perguntas como guia para inferir o conteúdo de cada seção a partir da demanda. Quando a demanda não responder a uma pergunta, a seção correspondente recebe `"TBD"`.

#### Visão Geral
- Em uma frase, o que esta solução faz?
- Qual é o principal valor que ela entrega ao usuário final?

#### Problema
- Qual dor ou necessidade concreta esta solução resolve?
- Qual é o impacto atual de não ter essa solução?

#### Objetivos
- Como o sucesso desta solução será medido? (ex.: métricas, KPIs)
- Há prazo ou meta quantitativa específica?

#### Público-Alvo
- Quem são os usuários principais desta solução?
- Há perfis secundários ou administradores envolvidos?

#### Requisitos Funcionais
- Quais funcionalidades são imprescindíveis para o MVP?
- Há integrações com sistemas externos necessárias?

#### Requisitos Não-Funcionais
- Há restrições de desempenho, segurança ou disponibilidade?
- A solução precisa escalar? Em que dimensão?

#### Casos de Uso
- Qual é o fluxo principal de uso da solução pelo usuário?
- Há fluxos alternativos ou de erro relevantes?

#### Critérios de Aceite
- Como saberemos que cada funcionalidade está "pronta"?
- Há testes de aceitação ou checklists já definidos?

#### Arquitetura
- Há decisões tecnológicas já tomadas (linguagem, framework, nuvem)?
- A solução é front-end, back-end ou fullstack?

#### Plano de Entrega
- Há marcos ou fases de entrega definidas?
- Qual é o prazo-alvo para o primeiro lançamento?

---

## Padrões de Qualidade do PRD

Estas regras aplicam-se tanto ao `PRD_Base` (Estágio 1) quanto ao `prd.md` final (Estágio Final).

### 1. Completude

- **Todas as 10 seções do `Strict_PRD_Schema` devem estar presentes** no documento, na ordem definida.
- Nenhuma seção pode ser removida, renomeada ou fundida com outra.
- Seções sem informação suficiente devem receber `"TBD"` — nunca ficar em branco ou ausentes.

### 2. Clareza

- Cada requisito funcional deve ser escrito em linguagem afirmativa e sem ambiguidade: "O sistema **deve** [ação] [objeto] [condição]".
- Evitar termos vagos sem definição prévia: "rápido", "fácil", "adequado".
- Cada caso de uso deve identificar: ator, pré-condição, sequência de passos e resultado esperado.
- Critérios de aceite devem ser verificáveis — testáveis por um humano ou por automação.

### 3. Testabilidade

- Todo requisito funcional deve ter ao menos um critério de aceite associado.
- Requisitos não-funcionais devem incluir limiares mensuráveis quando possível (ex.: "tempo de resposta < 500 ms em 95% das requisições").
- Casos de uso devem cobrir o fluxo principal e ao menos um fluxo alternativo ou de erro relevante.

### 4. Consistência

- Terminologia usada em uma seção deve ser usada da mesma forma nas demais (use o glossário da demanda ou da Requirement 2 quando disponível).
- IDs de requisitos (`RF-01`, `RNF-01`, `UC-01`, `CA-01`) devem ser únicos e referenciados de forma cruzada entre Requisitos Funcionais, Casos de Uso e Critérios de Aceite.

### 5. Rastreabilidade

- O `prd.md` final deve refletir as respostas registradas nos Estágios 2, 3 e 4.
- Requisitos derivados de lacunas identificadas pelo Codex ou pelo AGY devem ser incorporados nas seções pertinentes do `Strict_PRD_Schema`.

---

## Uso por Outros Componentes

| Componente | Como usa esta skill |
|------------|---------------------|
| `skills/pensador/SKILL.md` | Carrega esta skill para aplicar o `Strict_PRD_Schema` no Estágio 1 e no Estágio Final. |
| `scripts/pensador-engine.mjs` | Recebe as seções obrigatórias como `requiredSections` em `buildPrdBase(demanda, requiredSections)`. |
| `skills/pensador/assets/prd-template.md` | Template de saída que espelha as 10 seções do schema. |

---

## Resumo das Seções Obrigatórias (referência rápida)

```
1.  Visão Geral
2.  Problema
3.  Objetivos
4.  Público-Alvo
5.  Requisitos Funcionais
6.  Requisitos Não-Funcionais
7.  Casos de Uso
8.  Critérios de Aceite
9.  Arquitetura
10. Plano de Entrega
```

Todas obrigatórias. Ausência de informação → `"TBD"`.
