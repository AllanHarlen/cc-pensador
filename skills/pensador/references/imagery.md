# Imagery e iconografia — contrato do Pensador

O Pensador e o unico proprietario das decisoes e dos artefatos visuais. O Orquestrador apenas materializa o pacote aprovado; ele nao pergunta, sugere nem gera imagens.

## Inventario

No brief, colete `imageryStrategy` e `iconography`. Derive assets de requisitos explicitos, hero e paginas publicas, catalogos, institucional, autenticacao/onboarding, estados empty/error/success e dados de demonstracao/seeds.

Classifique cada item como:

- `required`: necessario para requisito ou criterio de aceite;
- `recommended`: enriquecimento semantico/visual.

Tome uma unica decisao por execucao: `full-package`, `required-only` ou `external-assets`. Nao pergunte imagem por imagem.

## Geracao AGY

- Uma imagem por chamada, sequencialmente; nunca combine geracao de imagem com `--parallel`.
- Inclua sistema resolvido, setor, marca, paleta, proporcao, superficie, rota e slot no prompt.
- Valide arquivo, extensao, dimensoes, tamanho, SHA-256 e duplicidade.
- Em `resume`, reutilize o arquivo quando o hash ainda for valido.
- Quota/autenticacao preserva estado e produz comando de retomada.
- Asset `required` ausente bloqueia o estagio DESIGN.

O manifesto vive em `resolved/assets/manifest.json` e segue `assets/assets-manifest.schema.json`. Todo item obrigatorio carrega requisito, rota, slot, destino `materializeInto`, `alt`, `seedBindings`, aprovacao, hash e provenance AGY.

## Iconografia

Icones funcionais sao vetoriais e pertencem a uma biblioteca compativel com o stack ou ao pacote Open Design. Registre pacote, versao, nomes e usos em `design-contract.json`. Nao gere icones funcionais como bitmap e nao use emoji como substituto. Navegacao, acoes recorrentes, status e cards de dashboard precisam de iconografia consistente.

## Handoff

O pacote `resolved/` e autoritativo. `original/` preserva o Open Design sem alteracao. O Orquestrador copia cada asset para `materializeInto`, aplica `seedBindings` e comprova no navegador que imagens aparecem nos estados normais e possuem `alt`.
