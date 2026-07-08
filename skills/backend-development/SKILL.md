---
name: backend-development
description: Lente primária de back-end do estágio BRAINSTORM_GERAL do Pensador. Levanta lacunas de modelo de dados, APIs/contratos, integrações, autenticação/autorização, consistência, escalabilidade, observabilidade e tratamento de erros, como perguntas para o usuário. Relevante quando a demanda tem componente de servidor/dados. Alimenta o contrato máquina-legível (openapi.yaml/schema.graphql/asyncapi.yaml) e o communication.md.
---

# backend-development — Lente Primária de Back-End

Skill de brainstorm do Pensador (lente **primária de back-end** do estágio **BRAINSTORM_GERAL**, relevante quando `hasBackend`). Aplica uma lente de **engenharia de back-end** sobre a demanda, o `PRD_Base` e o consolidado, retornando perguntas que expõem decisões técnicas em aberto. Alimenta **Arquitetura**, **Requisitos Não-Funcionais**, o **contrato máquina-legível** (fonte da verdade: `openapi.yaml` / `schema.graphql` / `service.proto` / `asyncapi.yaml`) e o `communication.md` (visão legível derivada).

> **Papel no v2.6.** Esta skill é a lente **primária** do domínio de back-end no `BRAINSTORM_GERAL`: roda sempre que `hasBackend`, produzindo um checklist determinístico. O Codex (`codex:codex-rescue`, `effort high`) roda **em cima dela** como lente de refinamento (`role: refine`), aprofundando riscos técnicos. Mapeamento em `STAGE_DELEGATION.BRAINSTORM_GERAL.domains.backend.lenses`.

> Conteúdo upstream (mcp.directory id 1186) pode enriquecer esta skill. Baixe com:
> `curl -L -o skill.zip "https://mcp.directory/api/skills/download/1186" && unzip -o skill.zip -d skills/backend-development && rm skill.zip`
> Mesmo sem o download, o checklist abaixo torna a lente de back-end operacional.

## Relevância

Rode quando houver sinais de back-end (API, servidor, banco de dados, integrações, persistência, filas). Se a demanda for puramente cliente/estática, produza zero perguntas e o estágio auto-avança.

## Checklist de back-end

1. **Modelo de dados** — entidades, relacionamentos, chaves, cardinalidade, dados sensíveis.
2. **Persistência** — tipo de banco (relacional/NoSQL), estratégia de migração, retenção, backup.
3. **APIs/contratos** — recursos e operações, estilo (REST/GraphQL/gRPC), versionamento, paginação, filtros.
4. **Autenticação & autorização** — quem autentica, mecanismo (JWT/sessão/OAuth), papéis e escopos por endpoint.
5. **Validação & erros** — validação de entrada, códigos/erros padronizados, mensagens.
6. **Consistência** — transações, idempotência, concorrência, condições de corrida.
7. **Integrações externas** — quais serviços, protocolos, limites, fallback quando indisponíveis.
8. **Escalabilidade & desempenho** — carga esperada, limiares (latência/throughput), cache, filas/assíncrono.
9. **Segurança** — superfície de ataque, segredos, rate limiting, LGPD/dados pessoais.
10. **Observabilidade** — logs, métricas, tracing, auditoria.

## Saída esperada

Perguntas objetivas por lacuna técnica. Quando a resposta definir um contrato (endpoint/schema/evento), registre o suficiente para o **contrato máquina-legível** — a fonte da verdade sob SDD: `openapi.yaml` (REST), `schema.graphql` (GraphQL), `service.proto` (gRPC) ou `asyncapi.yaml` (eventos/filas/webhooks), conforme o estilo de API detectado em ARCH (`state.apiStyle`). O `communication.md` é a visão legível derivada desse contrato — não a fonte. Use IDs `RF-XX` quando referenciar requisitos existentes.

### Contrato existente e breaking changes

Em projeto brownfield, o EXPLORE/ARCH já descobriu o contrato de API existente (`contractDiscoveryGlobs()`). Sua lente deve verificar se a demanda **estende** o contrato de forma aditiva ou o **quebra** (remove/renomeia operação, muda tipo ou obrigatoriedade). Quando houver quebra, levante-a como pergunta explícita — o Pensador aciona o gate de breaking change (`classifyContractChange()`) no EXPAND/FINAL, tratando a quebra como decisão arquitetural deliberada, não ajuste rápido.
