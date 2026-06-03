---
name: requirements-clarity
description: Lente de clareza e completude de requisitos para o estágio CLARITY do Pensador. Identifica ambiguidades, termos vagos, requisitos implícitos, escopo dentro/fora e critérios de aceite verificáveis, retornando perguntas objetivas para o usuário. Sempre relevante.
---

# requirements-clarity — Clareza de Requisitos

Skill de brainstorm do Pensador (estágio **CLARITY**, sempre relevante). Aplica uma lente de **clareza e completude** sobre a demanda, o `PRD_Base` e os requisitos consolidados, e retorna **perguntas objetivas** para o usuário fechar ambiguidades antes do aprofundamento técnico.

> Conteúdo upstream (mcp.directory id 2157) pode enriquecer esta skill. Baixe com:
> `curl -L -o skill.zip "https://mcp.directory/api/skills/download/2157" && unzip -o skill.zip -d skills/requirements-clarity && rm skill.zip`
> Mesmo sem o download, o checklist abaixo torna o estágio CLARITY operacional.

## Como usar (chamada pelo Pensador)

Recebe: demanda + `PRD_Base` + consolidado parcial. Devolve: lista de lacunas como perguntas (`origin = 'requirements-clarity'`), roteadas via `AskUserQuestion`.

## Checklist de clareza

1. **Termos vagos** — "rápido", "fácil", "intuitivo", "seguro", "escalável" sem definição mensurável. → Pergunte o limiar concreto.
2. **Ambiguidade** — requisitos que admitem mais de uma interpretação. → Pergunte qual.
3. **Requisitos implícitos** — o que a demanda pressupõe mas não declara (login implica recuperação de senha? logout? sessão?).
4. **Escopo** — o que está **dentro** e **fora** do MVP. → Confirme exclusões.
5. **Atores e permissões** — quem usa, com quais papéis e níveis de acesso.
6. **Dados** — quais dados entram/saem, obrigatórios vs. opcionais, validações.
7. **Estados e transições** — estados do recurso e o que dispara cada transição.
8. **Critérios de aceite** — para cada requisito funcional, existe um critério **verificável** (DADO/QUANDO/ENTÃO)? Se não, formule a pergunta que permite criá-lo.
9. **Dependências e premissas** — integrações, pré-requisitos, suposições que, se falsas, mudam o escopo.
10. **Conflitos** — requisitos que se contradizem entre si ou com RNFs.

## Saída esperada

Para cada item relevante, **uma pergunta clara e respondível** que, respondida, remove a ambiguidade. Evite perguntas retóricas ou de sim/não quando uma escolha entre opções concretas for mais útil.

Alimenta no PRD: **Requisitos Funcionais**, **Critérios de Aceite**, **Casos de Uso**, **Público-Alvo**.
