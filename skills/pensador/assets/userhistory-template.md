# Jornada do Usuário — {{NOME_DO_PROJETO}}

> **Instrução para o LLM:** Este template documenta a jornada do usuário em passos sequenciais
> cobrindo o fluxo principal definido no `prd.md`.
> Cada passo representa **uma interação** do usuário com o sistema no fluxo principal.
> O campo `order` deve formar uma sequência contígua e estritamente crescente começando em 1 (1, 2, …, N).
> Use os Casos de Uso (UC-XX) e Requisitos Funcionais (RF-XX) do `prd.md` como fonte de verdade.
> Inclua os fluxos alternativos e de erro relevantes **após** o fluxo principal, em seções separadas.
> Remova este bloco de instrução antes de entregar o artefato ao usuário.

---

## Persona

> **Instrução:** Identifique a persona principal que percorre esta jornada (copie do `prd.md`).

- **Persona:** {{NOME_PERSONA}}
- **Objetivo:** {{OBJETIVO_DA_PERSONA_NESTA_JORNADA}}

---

## Fluxo Principal

> **Instrução:** Liste cada interação do usuário como um passo ordenado.
> Para cada passo, preencha: `order` (número sequencial a partir de 1), `interaction` (o que o usuário faz),
> `system_response` (o que o sistema retorna/exibe) e o RF/UC relacionado.
> Não pule números — a sequência deve ser contígua: 1, 2, 3, …, N.

| # | Interação do Usuário | Resposta do Sistema | RF/UC |
|---|----------------------|---------------------|-------|
| 1 | {{INTERACAO_USUARIO_1}} | {{RESPOSTA_SISTEMA_1}} | {{RF_UC_1}} |
| 2 | {{INTERACAO_USUARIO_2}} | {{RESPOSTA_SISTEMA_2}} | {{RF_UC_2}} |
| 3 | {{INTERACAO_USUARIO_3}} | {{RESPOSTA_SISTEMA_3}} | {{RF_UC_3}} |
| N | {{INTERACAO_USUARIO_N}} | {{RESPOSTA_SISTEMA_N}} | {{RF_UC_N}} |

### Detalhamento dos Passos

> **Instrução:** Para passos complexos, expanda o detalhamento abaixo.
> Mantenha o mesmo `order` da tabela acima.

#### Passo 1 — {{TITULO_PASSO_1}}

- **Contexto:** {{CONTEXTO_OU_PRE_CONDICAO}}
- **Ação do usuário:** {{DESCRICAO_DETALHADA_ACAO}}
- **Resposta do sistema:** {{DESCRICAO_DETALHADA_RESPOSTA}}
- **Dados envolvidos:** {{CAMPOS_OU_DADOS_RELEVANTES}}

#### Passo 2 — {{TITULO_PASSO_2}}

- **Contexto:** {{CONTEXTO_OU_PRE_CONDICAO}}
- **Ação do usuário:** {{DESCRICAO_DETALHADA_ACAO}}
- **Resposta do sistema:** {{DESCRICAO_DETALHADA_RESPOSTA}}
- **Dados envolvidos:** {{CAMPOS_OU_DADOS_RELEVANTES}}

#### Passo N — {{TITULO_PASSO_N}}

- **Contexto:** {{CONTEXTO_OU_PRE_CONDICAO}}
- **Ação do usuário:** {{DESCRICAO_DETALHADA_ACAO}}
- **Resposta do sistema:** {{DESCRICAO_DETALHADA_RESPOSTA}}
- **Dados envolvidos:** {{CAMPOS_OU_DADOS_RELEVANTES}}

---

## Fluxos Alternativos

> **Instrução:** Documente ramificações do fluxo principal.
> Indique em qual passo do fluxo principal o desvio ocorre, a condição que o dispara
> e como o fluxo retorna ao principal (ou termina de forma diferente).

### FA-1 — {{NOME_FLUXO_ALTERNATIVO_1}}

- **Desvio no Passo:** {{NUMERO_PASSO_DE_DESVIO}}
- **Condição:** {{CONDICAO_DO_DESVIO}}
- **Sequência:**
  1. {{PASSO_FA_1}}
  2. {{PASSO_FA_2}}
- **Retorno ao fluxo principal:** {{RETORNO_OU_FIM_ALTERNATIVO}}

### FA-N — {{NOME_FLUXO_ALTERNATIVO_N}}

- **Desvio no Passo:** {{NUMERO_PASSO_DE_DESVIO}}
- **Condição:** {{CONDICAO_DO_DESVIO}}
- **Sequência:**
  1. {{PASSO_FA_1}}
- **Retorno ao fluxo principal:** {{RETORNO_OU_FIM_ALTERNATIVO}}

---

## Fluxos de Erro

> **Instrução:** Documente cenários de falha que interrompem ou desviam a jornada.
> Indique: passo de origem, tipo de erro, mensagem exibida ao usuário e ação de recuperação.

### FE-1 — {{NOME_FLUXO_ERRO_1}}

- **Origem no Passo:** {{NUMERO_PASSO_DE_ORIGEM}}
- **Condição de erro:** {{CONDICAO_ERRO}}
- **Mensagem ao usuário:** `"{{MENSAGEM_ERRO}}"`
- **Ação de recuperação:** {{ACAO_DE_RECUPERACAO}}

---

*Gerado pelo Pensador — Estágio Final. Fonte: `prd.md` — Casos de Uso e fluxo principal.*
