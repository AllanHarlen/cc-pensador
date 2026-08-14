# Comunicação de Back-End — {{NOME_DO_PROJETO}}

> **Instrução para o LLM:** Este documento é a **visão legível para humanos** do contrato de comunicação.
> A **fonte da verdade** (Spec-Driven Development) é o **contrato máquina-legível** gerado no mesmo diretório:
> `openapi.yaml` (REST), `schema.graphql` (GraphQL), `service.proto` (gRPC) ou `asyncapi.yaml` (eventos/filas),
> conforme o estilo de API detectado em ARCH (`state.apiStyle`). Este `communication.md` é **derivado** dele —
> nunca a origem. Se os dois divergirem, o contrato máquina-legível prevalece; regenere esta visão a partir dele.
> Gere-o **sempre que o projeto tem back-end** (`classifyProject(requisitosConsolidados).hasBackend === true`) — seja
> fullstack (contrato front↔back) ou back-end-only (contrato de API para consumidores externos).
> O contrato máquina-legível é o que habilita mock server (Prism/etc.), testes de contrato (Schemathesis/Pact) e codegen;
> este `.md` serve à leitura humana e ao alinhamento de nomenclatura com o `prd.md` (IDs RF-XX, glossário).
> Use os requisitos funcionais do `prd.md` como fonte de verdade para os recursos e operações.
> Em projeto brownfield, **estenda** o contrato existente (descoberto no EXPLORE) — mudanças que quebram o contrato
> devem ter sido aprovadas no gate de breaking change (EXPAND/FINAL) e versionadas.
> Remova este bloco de instrução antes de entregar o artefato ao usuário.

---

## Contrato máquina-legível (fonte da verdade)

> **Instrução:** Aponte o arquivo de contrato gerado neste diretório e o ferramental de validação/mock.

- **Arquivo fonte:** `{{ARQUIVO_CONTRATO}}` (ex.: `openapi.yaml`)
- **Spec:** {{SPEC}} (OpenAPI 3.1 / GraphQL SDL / Protobuf / AsyncAPI 3)
- **Mock server (fluxo paralelo front/back):** `{{COMANDO_MOCK}}` (ex.: `prism mock openapi.yaml`)
- **Validação de contrato (CI):** `{{COMANDO_VALIDACAO}}` (ex.: `schemathesis run openapi.yaml`)

---

## Visão Geral da API

> **Instrução:** Descreva brevemente a API — base URL, estilo (REST, GraphQL, etc.),
> autenticação adotada e formato padrão de resposta.

- **Base URL:** `{{BASE_URL}}`
- **Estilo:** REST / JSON
- **Autenticação:** {{TIPO_AUTENTICACAO}} (ex.: Bearer JWT, API Key, sessão)
- **Content-Type padrão:** `application/json`
- **Versão:** `{{VERSAO_API}}`

---

## Endpoints

> **Instrução:** Documente cada endpoint com método HTTP, caminho, descrição,
> schema de request body (quando aplicável), schema de response de sucesso e
> códigos de erro possíveis. Referencie o(s) RF correspondente(s).

---

### `{{METODO}} {{CAMINHO_1}}`

> **RF relacionado:** RF-01  
> **Descrição:** {{DESCRICAO_DO_ENDPOINT}}

#### Request

```json
{
  "campo1": "string",
  "campo2": 0,
  "campoN": true
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `campo1` | string | sim | {{DESCRICAO_CAMPO1}} |
| `campo2` | number | não | {{DESCRICAO_CAMPO2}} |
| `campoN` | boolean | sim | {{DESCRICAO_CAMPON}} |

#### Response — Sucesso (`{{HTTP_STATUS_SUCESSO}}`)

```json
{
  "id": "uuid",
  "campo1": "string",
  "campo2": 0,
  "criadoEm": "2024-01-01T00:00:00Z"
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | Identificador único do recurso |
| `campo1` | string | {{DESCRICAO_CAMPO1}} |
| `campo2` | number | {{DESCRICAO_CAMPO2}} |
| `criadoEm` | string (ISO 8601) | Data e hora de criação |

#### Códigos de Erro

| Código HTTP | Código interno | Mensagem | Condição |
|-------------|----------------|----------|----------|
| 400 | `VALIDATION_ERROR` | `"{{MENSAGEM_ERRO}}"` | {{CONDICAO_ERRO}} |
| 401 | `UNAUTHORIZED` | `"Não autenticado."` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | `"Acesso negado."` | Usuário sem permissão |
| 404 | `NOT_FOUND` | `"Recurso não encontrado."` | ID inexistente |
| 500 | `INTERNAL_ERROR` | `"Erro interno do servidor."` | Falha inesperada |

---

### `{{METODO}} {{CAMINHO_2}}`

> **RF relacionado:** RF-02  
> **Descrição:** {{DESCRICAO_DO_ENDPOINT}}

#### Request

```json
{
  "campo1": "string"
}
```

#### Response — Sucesso (`{{HTTP_STATUS_SUCESSO}}`)

```json
{
  "items": [
    {
      "id": "uuid",
      "campo1": "string"
    }
  ],
  "total": 0,
  "pagina": 1,
  "tamanhoPagina": 20
}
```

#### Códigos de Erro

| Código HTTP | Código interno | Mensagem | Condição |
|-------------|----------------|----------|----------|
| 400 | `VALIDATION_ERROR` | `"{{MENSAGEM_ERRO}}"` | {{CONDICAO_ERRO}} |
| 401 | `UNAUTHORIZED` | `"Não autenticado."` | Token ausente ou inválido |

---

## Schemas Compartilhados

> **Instrução:** Documente tipos/schemas JSON reutilizados em múltiplos endpoints.

### `{{NOME_SCHEMA_1}}`

```json
{
  "id": "uuid",
  "campo1": "string",
  "campo2": 0,
  "campoN": true
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | {{DESCRICAO}} |
| `campo1` | string | {{DESCRICAO}} |
| `campo2` | number | {{DESCRICAO}} |
| `campoN` | boolean | {{DESCRICAO}} |

---

## Catálogo de Códigos de Erro

> **Instrução:** Consolide todos os códigos de erro internos usados pela API para referência rápida.

| Código interno | Categoria | Descrição |
|----------------|-----------|-----------|
| `VALIDATION_ERROR` | Validação | Dados de entrada inválidos ou faltantes |
| `UNAUTHORIZED` | Autenticação | Credenciais ausentes ou inválidas |
| `FORBIDDEN` | Autorização | Usuário autenticado sem permissão para a operação |
| `NOT_FOUND` | Recurso | Entidade referenciada não encontrada |
| `CONFLICT` | Negócio | Operação conflita com estado atual (ex.: duplicata) |
| `RATE_LIMIT_EXCEEDED` | Infraestrutura | Limite de requisições excedido |
| `INTERNAL_ERROR` | Servidor | Erro interno inesperado |
| `{{CODIGO_N}}` | {{CATEGORIA}} | {{DESCRICAO}} |

---

*Gerado pelo Pensador — Estágio Final. Aplicável a projetos com back-end (fullstack ou back-end-only).*
