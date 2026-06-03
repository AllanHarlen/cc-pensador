# PRD — {{NOME_DO_PROJETO}}

> **Instrução para o LLM:** Este template implementa o `Strict_PRD_Schema` definido em `skills/prd/SKILL.md`.
> Preencha cada seção com base nos requisitos consolidados de todos os estágios de trabalho (EXPAND → AGY).
> Seções sem informação disponível devem receber exatamente `"TBD"` — nunca deixe a seção vazia ou ausente.
> Mantenha os IDs de requisitos (`RF-01`, `RNF-01`, `UC-01`, `CA-01`) únicos e com referências cruzadas consistentes.
> Remova este bloco de instrução antes de entregar o artefato ao usuário.

---

## 1. Visão Geral

> **Instrução:** Resumo executivo da solução — o que é, para quem serve e qual valor entrega.
> Use no máximo 3–5 parágrafos curtos. Inclua o nome do produto, o público principal e a proposta de valor.

{{VISÃO_GERAL}}

---

## 2. Problema

> **Instrução:** Descrição clara do problema ou necessidade que a solução endereça.
> Responda: qual é a dor concreta? Qual o impacto de não ter essa solução?

{{PROBLEMA}}

---

## 3. Objetivos

> **Instrução:** Metas mensuráveis que o produto deve atingir.
> Use lista numerada. Prefira métricas e KPIs concretos (ex.: "Reduzir em 30% o tempo de onboarding até Q3").

1. {{OBJETIVO_1}}
2. {{OBJETIVO_2}}
3. {{OBJETIVO_N}}

---

## 4. Público-Alvo

> **Instrução:** Perfis de usuário (personas) que utilizarão a solução.
> Descreva cada persona com: nome, papel, principais necessidades e nível de familiaridade técnica.

### Persona 1 — {{NOME_PERSONA_1}}

- **Papel:** {{PAPEL}}
- **Necessidades:** {{NECESSIDADES}}
- **Familiaridade técnica:** {{NIVEL_TECNICO}}

### Persona 2 — {{NOME_PERSONA_2}}

- **Papel:** {{PAPEL}}
- **Necessidades:** {{NECESSIDADES}}
- **Familiaridade técnica:** {{NIVEL_TECNICO}}

---

## 5. Requisitos Funcionais

> **Instrução:** Lista numerada de funcionalidades que o sistema deve prover.
> Cada item segue o padrão: "O sistema DEVE [ação] [objeto] [condição]."
> Use IDs únicos do tipo RF-01, RF-02, … para permitir rastreabilidade com Casos de Uso e Critérios de Aceite.

| ID | Requisito |
|----|-----------|
| RF-01 | O sistema DEVE {{REQUISITO_FUNCIONAL_1}}. |
| RF-02 | O sistema DEVE {{REQUISITO_FUNCIONAL_2}}. |
| RF-N  | O sistema DEVE {{REQUISITO_FUNCIONAL_N}}. |

---

## 6. Requisitos Não-Funcionais

> **Instrução:** Qualidade do sistema — desempenho, segurança, escalabilidade, disponibilidade, etc.
> Inclua limiares mensuráveis sempre que possível (ex.: "tempo de resposta < 500 ms em 95% das requisições").
> Use IDs do tipo RNF-01, RNF-02, …

| ID | Categoria | Requisito |
|----|-----------|-----------|
| RNF-01 | Desempenho | {{REQUISITO_NF_DESEMPENHO}} |
| RNF-02 | Segurança  | {{REQUISITO_NF_SEGURANCA}} |
| RNF-03 | Escalabilidade | {{REQUISITO_NF_ESCALABILIDADE}} |
| RNF-N  | {{CATEGORIA}} | {{REQUISITO_NF_N}} |

---

## 7. Casos de Uso

> **Instrução:** Cenários de interação entre o usuário e o sistema.
> Para cada caso de uso, identifique: ator, pré-condição, sequência de passos e resultado esperado.
> Inclua ao menos um fluxo alternativo ou de erro relevante por caso de uso principal.
> Use IDs do tipo UC-01, UC-02, …

### UC-01 — {{NOME_DO_CASO_DE_USO}}

- **Ator:** {{ATOR}}
- **Pré-condição:** {{PRE_CONDICAO}}
- **Fluxo principal:**
  1. {{PASSO_1}}
  2. {{PASSO_2}}
  3. {{PASSO_N}}
- **Fluxo alternativo / erro:**
  - {{FLUXO_ALTERNATIVO}}
- **Resultado esperado:** {{RESULTADO}}

### UC-02 — {{NOME_DO_CASO_DE_USO}}

- **Ator:** {{ATOR}}
- **Pré-condição:** {{PRE_CONDICAO}}
- **Fluxo principal:**
  1. {{PASSO_1}}
  2. {{PASSO_N}}
- **Fluxo alternativo / erro:**
  - {{FLUXO_ALTERNATIVO}}
- **Resultado esperado:** {{RESULTADO}}

---

## 8. Critérios de Aceite

> **Instrução:** Condições verificáveis que determinam quando cada requisito está satisfeito.
> Cada critério deve ser testável por um humano ou por automação.
> Referencie o ID do Requisito Funcional correspondente (RF-XX).
> Use IDs do tipo CA-01, CA-02, …

| ID | RF | Critério |
|----|----|----------|
| CA-01 | RF-01 | DADO {{CONTEXTO}}, QUANDO {{ACAO}}, ENTÃO {{RESULTADO_ESPERADO}}. |
| CA-02 | RF-02 | DADO {{CONTEXTO}}, QUANDO {{ACAO}}, ENTÃO {{RESULTADO_ESPERADO}}. |
| CA-N  | RF-N  | DADO {{CONTEXTO}}, QUANDO {{ACAO}}, ENTÃO {{RESULTADO_ESPERADO}}. |

---

## 9. Arquitetura

> **Instrução:** Visão de alto nível dos componentes, integrações e decisões técnicas fundamentais.
> Inclua: stack tecnológica escolhida, diagrama de componentes (texto ou Mermaid), principais integrações externas e decisões de design relevantes.
> Se for um Projeto_Fullstack, descreva a separação front-end/back-end e os contratos de comunicação (detalhados em `comunication_json.md`).

### Stack Tecnológica

- **Front-end:** {{FRONTEND_STACK}}
- **Back-end:** {{BACKEND_STACK}}
- **Banco de dados:** {{DATABASE}}
- **Infraestrutura:** {{INFRA}}

### Diagrama de Componentes

```
{{DIAGRAMA_OU_DESCRICAO_DE_COMPONENTES}}
```

### Integrações Externas

| Sistema | Finalidade | Protocolo |
|---------|-----------|-----------|
| {{SISTEMA_1}} | {{FINALIDADE}} | {{PROTOCOLO}} |

### Decisões Técnicas Fundamentais

1. {{DECISAO_1}}
2. {{DECISAO_N}}

---

## 10. Plano de Entrega

> **Instrução:** Fases ou milestones de implementação com escopo e estimativas de prazo.
> Organize em fases (Fase 1 = MVP mínimo, Fase 2 = incrementos, etc.).
> Inclua: objetivo da fase, funcionalidades incluídas (por ID RF) e estimativa de prazo.

### Fase 1 — MVP

- **Objetivo:** {{OBJETIVO_FASE_1}}
- **Escopo:** RF-01, RF-02, {{RF_N}}
- **Prazo estimado:** {{PRAZO_FASE_1}}

### Fase 2 — {{NOME_FASE_2}}

- **Objetivo:** {{OBJETIVO_FASE_2}}
- **Escopo:** RF-03, {{RF_N}}
- **Prazo estimado:** {{PRAZO_FASE_2}}

### Fase N — {{NOME_FASE_N}}

- **Objetivo:** {{OBJETIVO_FASE_N}}
- **Escopo:** {{RF_N}}
- **Prazo estimado:** {{PRAZO_FASE_N}}

---

*Gerado pelo Pensador — Estágio Final. Baseado no `Strict_PRD_Schema` definido em `skills/prd/SKILL.md`.*
