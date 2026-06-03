---
name: backend-development
description: Lente de back-end para o estágio BACKEND do Pensador. Levanta lacunas de modelo de dados, APIs/contratos, integrações, autenticação/autorização, consistência, escalabilidade, observabilidade e tratamento de erros, como perguntas para o usuário. Relevante quando a demanda tem componente de servidor/dados.
---

# backend-development — Lente de Back-End

Skill de brainstorm do Pensador (estágio **BACKEND**, relevante quando `hasBackend`). Aplica uma lente de **engenharia de back-end** sobre a demanda, o `PRD_Base` e o consolidado, retornando perguntas que expõem decisões técnicas em aberto. Alimenta **Arquitetura**, **Requisitos Não-Funcionais** e o `comunication_json.md`.

> Conteúdo upstream (mcp.directory id 1186) pode enriquecer esta skill. Baixe com:
> `curl -L -o skill.zip "https://mcp.directory/api/skills/download/1186" && unzip -o skill.zip -d skills/backend-development && rm skill.zip`
> Mesmo sem o download, o checklist abaixo torna o estágio BACKEND operacional.

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

Perguntas objetivas por lacuna técnica. Quando a resposta definir um contrato (endpoint/schema), registre o suficiente para o `comunication_json.md`. Use IDs `RF-XX` quando referenciar requisitos existentes.
