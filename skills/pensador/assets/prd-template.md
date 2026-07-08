# PRD — {{NOME_DO_PROJETO}}

> **Instrução para o LLM:** Este template implementa o `Strict_PRD_Schema` definido em `skills/prd/SKILL.md` (17 seções obrigatórias).
> Preencha cada seção com base nos requisitos consolidados de todos os estágios de trabalho (EXPAND → AGY).
> **Não trunque o PRD.** Detalhe o produto por inteiro (front-end, back-end, dados, integrações, segurança, arquitetura). Não há limite de extensão.
> Seções sem informação disponível devem receber exatamente `"TBD"` — nunca deixe a seção vazia ou ausente.
> Resolva todo gap (regra de negócio ou tecnologia); só use `"TBD"` quando a informação realmente não existir.
> Mantenha os IDs (`RF-01`, `RNF-01`, `UC-01`, `CA-01`, `ENT-01`, `EP-01`) únicos e com referências cruzadas consistentes.
> Remova este bloco de instrução antes de entregar o artefato ao usuário.

---

## 1. Visão Geral

> **Instrução:** Resumo executivo da solução — o que é, para quem serve e qual valor entrega. Inclua nome do produto, público principal e proposta de valor.

{{VISÃO_GERAL}}

---

## 2. Problema & Contexto

> **Instrução:** Dor/necessidade concreta, contexto de negócio e impacto de não ter a solução.

{{PROBLEMA_CONTEXTO}}

---

## 3. Objetivos & Métricas de Sucesso

> **Instrução:** Metas mensuráveis e KPIs. Prefira métricas concretas (ex.: "Reduzir em 30% o tempo de onboarding até Q3").

1. {{OBJETIVO_1}}
2. {{OBJETIVO_N}}

| Métrica / KPI | Baseline | Meta |
|---|---|---|
| {{METRICA_1}} | {{BASELINE}} | {{META}} |

---

## 4. Público-Alvo & Personas

> **Instrução:** Personas com nome, papel, necessidades e familiaridade técnica. Inclua perfis administrativos/secundários.

### Persona 1 — {{NOME_PERSONA_1}}

- **Papel:** {{PAPEL}}
- **Necessidades:** {{NECESSIDADES}}
- **Familiaridade técnica:** {{NIVEL_TECNICO}}

### Persona 2 — {{NOME_PERSONA_2}}

- **Papel:** {{PAPEL}}
- **Necessidades:** {{NECESSIDADES}}
- **Familiaridade técnica:** {{NIVEL_TECNICO}}

---

## 5. Escopo

> **Instrução:** Delimite claramente o que entra, o que fica fora, as premissas e as restrições.

- **Incluído:** {{ESCOPO_INCLUIDO}}
- **Fora de escopo:** {{FORA_DE_ESCOPO}}
- **Premissas:** {{PREMISSAS}}
- **Restrições:** {{RESTRICOES}}

---

## 6. Requisitos Funcionais

> **Instrução:** Lista de funcionalidades. Padrão: "O sistema DEVE [ação] [objeto] [condição]." Prefira muitos requisitos específicos a poucos amplos. IDs `RF-01`…

| ID | Requisito | Prioridade |
|----|-----------|-----------|
| RF-01 | O sistema DEVE {{REQUISITO_FUNCIONAL_1}}. | {{MoSCoW}} |
| RF-02 | O sistema DEVE {{REQUISITO_FUNCIONAL_2}}. | {{MoSCoW}} |
| RF-N  | O sistema DEVE {{REQUISITO_FUNCIONAL_N}}. | {{MoSCoW}} |

---

## 7. Requisitos Não-Funcionais

> **Instrução:** Qualidade do sistema. Inclua limiares mensuráveis (ex.: "tempo de resposta < 500 ms em 95% das requisições"). IDs `RNF-01`…

| ID | Categoria | Requisito |
|----|-----------|-----------|
| RNF-01 | Desempenho | {{REQUISITO_NF_DESEMPENHO}} |
| RNF-02 | Segurança  | {{REQUISITO_NF_SEGURANCA}} |
| RNF-03 | Escalabilidade | {{REQUISITO_NF_ESCALABILIDADE}} |
| RNF-04 | Disponibilidade | {{REQUISITO_NF_DISPONIBILIDADE}} |
| RNF-N  | {{CATEGORIA}} | {{REQUISITO_NF_N}} |

---

## 8. Design System & UI/UX

> **Instrução:** A camada de design — sem ela a UI vira template genérico. Detalhe tokens, tipografia, componentes e estados. Quando houver front-end, esta seção referencia o artefato `design-system.md` (gerado via Open Design). Não resuma com uma frase genérica.

### Identidade visual e tom

- **Tom visual / referências:** {{TOM_VISUAL}}
- **Marca / identidade:** {{MARCA}}

### Design tokens

| Token | Valor | Uso |
|---|---|---|
| Cor de marca (primary) | {{COR_PRIMARIA}} | {{USO}} |
| Neutros | {{NEUTROS}} | {{USO}} |
| Semânticas (sucesso/erro/aviso/info) | {{SEMANTICAS}} | {{USO}} |
| Tipografia (família/escala/pesos) | {{TIPOGRAFIA}} | {{USO}} |
| Espaçamento / raio / sombra | {{ESPACAMENTO_RAIO_SOMBRA}} | {{USO}} |

### Componentes e estados

> Para cada componente-chave, defina os estados: default, hover, focus, active, disabled, loading, vazio, erro, sucesso.

{{COMPONENTES_E_ESTADOS}}

### Responsividade, acessibilidade e microcopy

- **Breakpoints / grid / densidade:** {{RESPONSIVIDADE}}
- **Acessibilidade (alvo WCAG, contraste, foco, leitor de tela):** {{ACESSIBILIDADE}}
- **Microcopy (voz/tom, mensagens de estado):** {{MICROCOPY}}
- **Artefato de design:** `design-system.md` {{REFERENCIA_DESIGN_SYSTEM}}

---

## 9. Casos de Uso & Fluxos

> **Instrução:** Cenários de interação. Inclua ao menos um fluxo alternativo/erro por caso principal e descreva workflows multi-etapa. IDs `UC-01`…

### UC-01 — {{NOME_DO_CASO_DE_USO}}

- **Ator:** {{ATOR}}
- **Pré-condição:** {{PRE_CONDICAO}}
- **Fluxo principal:**
  1. {{PASSO_1}}
  2. {{PASSO_N}}
- **Fluxo alternativo / erro:** {{FLUXO_ALTERNATIVO}}
- **Resultado esperado:** {{RESULTADO}}

### UC-02 — {{NOME_DO_CASO_DE_USO}}

- **Ator:** {{ATOR}}
- **Pré-condição:** {{PRE_CONDICAO}}
- **Fluxo principal:**
  1. {{PASSO_1}}
  2. {{PASSO_N}}
- **Fluxo alternativo / erro:** {{FLUXO_ALTERNATIVO}}
- **Resultado esperado:** {{RESULTADO}}

---

## 10. Modelo de Dados & Domínio

> **Instrução:** Entidades, atributos, relacionamentos, regras de domínio e ciclo de vida (estados). IDs `ENT-01`…

| ID | Entidade | Atributos principais | Relacionamentos |
|----|----------|----------------------|-----------------|
| ENT-01 | {{ENTIDADE_1}} | {{ATRIBUTOS}} | {{RELACIONAMENTOS}} |
| ENT-N  | {{ENTIDADE_N}} | {{ATRIBUTOS}} | {{RELACIONAMENTOS}} |

- **Regras de domínio:** {{REGRAS_DOMINIO}}
- **Ciclo de vida / estados:** {{CICLO_DE_VIDA}}

---

## 11. Contratos de API & Integrações

> **Instrução:** A **fonte da verdade** dos contratos é o artefato máquina-legível (`openapi.yaml` / `schema.graphql` / `service.proto` / `asyncapi.yaml`, conforme `state.apiStyle`), gerado no diretório da feature quando há back-end. Esta seção **referencia** esse contrato e o `communication.md` (visão legível) — não os duplica. Liste aqui a visão geral (estilo de API, arquivo fonte) e as integrações externas; os endpoints detalhados vivem no contrato máquina-legível.

### Contrato (fonte da verdade)

- **Estilo de API:** {{ESTILO_API}} (REST/OpenAPI · GraphQL · gRPC · AsyncAPI)
- **Arquivo fonte:** `{{ARQUIVO_CONTRATO}}` (máquina-legível)
- **Visão legível:** `communication.md`

### Endpoints (resumo — detalhe no contrato máquina-legível)

| Método | Rota | Request | Response | Erros |
|---|---|---|---|---|
| {{METODO}} | {{ROTA}} | {{REQUEST}} | {{RESPONSE}} | {{ERROS}} |

### Integrações externas

| Sistema | Finalidade | Protocolo | Observações |
|---------|-----------|-----------|-------------|
| {{SISTEMA_1}} | {{FINALIDADE}} | {{PROTOCOLO}} | {{OBS}} |

---

## 12. Segurança, Privacidade & Conformidade

> **Instrução:** AuthN/AuthZ, papéis, multitenancy, dados pessoais e conformidade (ex.: LGPD/consentimento).

- **Autenticação:** {{AUTENTICACAO}}
- **Autorização / Papéis:** {{PAPEIS}}
- **Multitenancy:** {{MULTITENANCY}}
- **Dados sensíveis / pessoais:** {{DADOS_SENSIVEIS}}
- **Conformidade (LGPD/consentimento/retenção):** {{CONFORMIDADE}}

---

## 13. Observabilidade & Operação

> **Instrução:** Logs, métricas, tracing, alertas, backup, ambientes e deploy/CI-CD.

- **Logs / Métricas / Tracing:** {{OBSERVABILIDADE}}
- **Alertas:** {{ALERTAS}}
- **Backup / retenção:** {{BACKUP}}
- **Ambientes e deploy/CI-CD:** {{DEPLOY_CICD}}

---

## 14. Critérios de Aceite

> **Instrução:** Condições verificáveis por requisito. Referencie o `RF-XX` correspondente. IDs `CA-01`…

| ID | RF | Critério |
|----|----|----------|
| CA-01 | RF-01 | DADO {{CONTEXTO}}, QUANDO {{ACAO}}, ENTÃO {{RESULTADO_ESPERADO}}. |
| CA-02 | RF-02 | DADO {{CONTEXTO}}, QUANDO {{ACAO}}, ENTÃO {{RESULTADO_ESPERADO}}. |
| CA-N  | RF-N  | DADO {{CONTEXTO}}, QUANDO {{ACAO}}, ENTÃO {{RESULTADO_ESPERADO}}. |

---

## 15. Arquitetura

> **Instrução:** Componentes, integrações e decisões técnicas. Se for Projeto_Fullstack, descreva a separação front-end/back-end e os contratos (detalhados em `communication.md`).

### Stack Tecnológica

- **Front-end:** {{FRONTEND_STACK}}
- **Back-end:** {{BACKEND_STACK}}
- **Banco de dados:** {{DATABASE}}
- **Infraestrutura:** {{INFRA}}

### Diagrama de Componentes

```
{{DIAGRAMA_OU_DESCRICAO_DE_COMPONENTES}}
```

### Decisões Técnicas Fundamentais

1. {{DECISAO_1}}
2. {{DECISAO_N}}

---

## 16. Riscos & Mitigações

> **Instrução:** Riscos técnicos, de produto e de negócio, com probabilidade, impacto e mitigação.

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| {{RISCO_1}} | {{PROB}} | {{IMPACTO}} | {{MITIGACAO}} |
| {{RISCO_N}} | {{PROB}} | {{IMPACTO}} | {{MITIGACAO}} |

---

## 17. Plano de Entrega

> **Instrução:** Fases/milestones com objetivo, escopo (por `RF-`) e estimativa. IDs `EP-01`…

### EP-01 — Fase 1 (MVP)

- **Objetivo:** {{OBJETIVO_FASE_1}}
- **Escopo:** RF-01, RF-02, {{RF_N}}
- **Prazo estimado:** {{PRAZO_FASE_1}}

### EP-02 — {{NOME_FASE_2}}

- **Objetivo:** {{OBJETIVO_FASE_2}}
- **Escopo:** RF-03, {{RF_N}}
- **Prazo estimado:** {{PRAZO_FASE_2}}

### EP-N — {{NOME_FASE_N}}

- **Objetivo:** {{OBJETIVO_FASE_N}}
- **Escopo:** {{RF_N}}
- **Prazo estimado:** {{PRAZO_FASE_N}}

---

*Gerado pelo Pensador — Estágio Final. Baseado no `Strict_PRD_Schema` (17 seções) definido em `skills/prd/SKILL.md`.*
