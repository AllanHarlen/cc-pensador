# Protocolo AskUserQuestion v2

`AskUserQuestion` e o unico canal de dialogo do Pensador com o usuario.

---

## Principio central

Toda pergunta usa `AskUserQuestion`, sem excecoes:

| Origem | Exemplos |
|---|---|
| Pensador | Demanda ausente, escolha PRD vs Spec (OpenSpec), fallback do Code Base Memory, EXPAND, COMPLEXITY, confirmacao de back-end, sobrescrita, recap final |
| ARCH | Entrevista greenfield, duvidas de arquitetura |
| BRAINSTORM_GERAL | Perguntas de `requirements-clarity`, Codex, AGY ou fallback por dominio |
| CODEX | Lacunas tecnicas finais ou fallback |
| AGY | Lacunas de produto finais ou fallback |
| Retomada | Checkpoint v2 ou checkpoint v1 incompativel |

O Pensador nao deve fazer perguntas soltas no chat fora da ferramenta.

---

## Idioma e estilo

- PT-BR e o padrao.
- Seja direto e especifique o impacto da decisao.
- Inclua selo de autoria quando a pergunta vier de uma lente ou agente.
- Quando houver recomendacao defensavel, inclua uma opcao recomendada.
- Quando a escolha afetar artefatos, inclua preview do resultado.

Exemplo de selo:

```text
[Codex | backend | BRAINSTORM_GERAL]
```

---

## Opcoes recomendadas

Use opcao recomendada quando:

- A heuristica de complexidade indicar Lite ou Completo com confianca.
- A arquitetura apontar claramente para existencia ou ausencia de back-end.
- Um fallback tiver alternativa pragmatica.
- A pergunta tiver uma resposta padrao segura.

Formato recomendado:

```text
Opcao A (recomendada): seguir com modo Completo.
Impacto: aprofunda backend e frontend, gera mais perguntas, reduz risco de PRD incompleto.

Opcao B: seguir com modo Lite.
Impacto: menos perguntas, entrega mais rapida, algumas lacunas podem ficar como TBD.
```

---

## Previews

Inclua previews quando a decisao mudar o que sera produzido.

Exemplos:

- COMPLEXITY: mostrar diferenca entre Lite e Completo.
- Confirmacao de back-end: mostrar se `comunication_json.md` sera gerado.
- Sobrescrita: mostrar caminho do arquivo existente.
- Handoff: mostrar artefatos finais e proximos passos.

---

## Agrupamento

Pode agrupar perguntas em uma chamada quando:

- Pertencem ao mesmo estagio.
- Tem a mesma origem ou o mesmo dominio consolidado.
- Sao relacionadas e respondiveis em bloco.
- O texto permite registrar cada resposta separadamente.

Nao agrupe:

- Fallbacks.
- Perguntas de estagios diferentes.
- Decisoes que tenham efeitos diferentes em artefatos.
- Perguntas de autoria muito distinta sem preservar os selos.

---

## Profundidade por dominio

O modo escolhido em COMPLEXITY controla profundidade:

| Modo | Perguntas |
|---|---|
| Lite | 1 a 3 perguntas essenciais por dominio relevante; lacunas menores como `"TBD"` |
| Completo | Aprofundar dominios de maior risco; permitir mais perguntas quando houver backend, frontend amplo, integracoes ou greenfield |

Mesmo em Completo, priorize perguntas que mudam escopo, arquitetura, contrato, UX ou criterios de aceite.

---

## Recap final

No FINAL, use `AskUserQuestion` para confirmar qualquer decisao pendente que afete artefatos. Depois, apresente no chat o recap final sem nova pergunta quando nao houver decisao a tomar.

O recap deve conter:

- Caminhos dos artefatos em `<featurePath>/` (ex.: `.pensador/<slug-da-demanda>-vN/`).
- Decisoes principais.
- Perguntas diferidas e onde ficaram como `"TBD"`.
- Dominios cobertos no BRAINSTORM_GERAL.
- Handoff recomendado.

---

## Handoff

O handoff e a orientacao final para quem vai implementar ou revisar o PRD. Ele deve indicar:

- Atualizacao isolada: `<featurePath>`.
- Artefatos finais.
- `architecture.md`.
- `shared-agents/agent.response.md`.
- Decisoes que precisam validacao humana antes de implementar.

Se houver back-end confirmado, mencionar `comunication_json.md`. Se nao houver, registrar que o artefato nao se aplica.

---

## Retomada e checkpoint

Perguntas de retomada tambem usam `AskUserQuestion`.

Checkpoint v2 valido:

- Opcao recomendada: retomar quando o checkpoint esta consistente.
- Alternativa: iniciar nova atualizacao com `allocateFeatureDir()`.

Checkpoint v1 detectado:

- Informe que `pensador-output/.pensador-progress.json` e incompativel com `CHECKPOINT_VERSION = 2`.
- Recomende iniciar novo fluxo v2.
- Nao tente converter automaticamente.

---

## Fallback

Fallbacks devem ser individuais, com opcoes claras:

- Retentar.
- Seguir sem o dominio/agente.
- Registrar lacunas como `"TBD"`.

Em BRAINSTORM_GERAL, o fallback e por dominio. Em CODEX e AGY, o fallback pertence ao gate do estagio.

---

## Rastreabilidade

Cada pergunta deve registrar:

- `id`.
- `stage`.
- `origin`.
- `domain` quando aplicavel.
- `authors` quando houver deduplicacao de multiplas origens.
- `answer` ou `deferred`.
- `resolvesGap`.

Isso preserva auditoria e permite recap final confiavel.
