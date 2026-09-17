# Imagery e iconografia — contrato do Pensador

O Pensador e o unico proprietario das decisoes e dos artefatos visuais. O Orquestrador apenas materializa o pacote aprovado; ele nao pergunta, sugere nem gera imagens.

## Inventario

No brief, colete `imageryStrategy` e `iconography`. Derive assets de requisitos explicitos, hero e paginas publicas, catalogos, institucional, autenticacao/onboarding, estados empty/error/success e dados de demonstracao/seeds.

Execute `detectProductSurfaces(state)` (RESEARCH, passo 2a) antes do inventario, e so entao `inferVisualImageryPlan(state)` — a politica vem da SUPERFICIE detectada, nao de palavras soltas na demanda: toda superficie `catalog` (vitrine/catalogo de pecas, equipamentos, produtos, servicos) ou `conversion` (site/pagina/area publica, landing page, homepage) e `required` (minimo 3 assets vinculados — de qualquer `purpose`, nao so `seed-demo`); um requisito com mandato explicito de imagem por item ("upload de foto do produto") tambem forca `required`, independente de superficie. Sem nenhuma superficie `conversion`/`catalog`/mandato explicito, a politica e `not-applicable`. A decisao viaja em `project-baseline.json.visualImageryPlan` com motivos e IDs das tasks/requisitos detectados.

Classifique cada item como:

- `required`: necessario para requisito ou criterio de aceite;
- `recommended`: enriquecimento semantico/visual.

Separe duas decisões que não são equivalentes:

- **Marca/identidade:** `full-package`, `required-only` ou `external-assets`. `external-assets` pode significar que logo e fotos institucionais serão fornecidos depois.
- **Seed/demo:** quando requisitos, critérios de aceite ou dados de demonstração renderizam catálogo, vitrine, cards ou qualquer slot de imagem, sempre materialize um conjunto mínimo real e visível de 3 a 6 imagens. Essa obrigação continua existindo mesmo quando a estratégia de marca é `external-assets`; sem ela, o próprio fluxo demo não é verificável.

Não pergunte imagem por imagem. Registre a decisão de seed separadamente e marque esses assets como `required`, com `purpose: "seed-demo"` e `seedBindings` apontando para os itens demonstrativos que os consumirão. Assets estáticos de marca/conteúdo podem manter `seedBindings: []`; o `purpose` impede que essa ausência legítima seja confundida com um seed quebrado.

## Geracao AGY

- Uma imagem por chamada, sequencialmente; nunca combine geracao de imagem com `--parallel`.
- Cada chamada precisa emitir `AGY_IMAGE_RESULT` com exatamente um arquivo, destino, bytes e SHA-256. Exit 0 sem esse recibo e falha.
- Para seed/demo obrigatório, execute 3 a 6 chamadas reais com `--generate-image`; não aceite manifesto vazio, placeholder, URL remota instável ou `imagemUrl: null` como materialização.
- Inclua sistema resolvido, setor, marca, paleta, proporcao, superficie, rota e slot no prompt.
- Valide arquivo, extensao, dimensoes, tamanho, SHA-256 e duplicidade.
- Em `resume`, reutilize o arquivo quando o hash ainda for valido.
- Quota/autenticacao preserva estado e produz comando de retomada.
- Asset `required` ausente bloqueia o estagio DESIGN.

O manifesto vive em `resolved/assets/manifest.json` e segue `assets/assets-manifest.schema.json`. Todo item obrigatorio carrega requisito, rota, slot, destino `materializeInto`, `alt`, `seedBindings`, aprovacao, hash e provenance AGY.

## Iconografia

Icones funcionais sao vetoriais e pertencem a uma biblioteca compativel com o stack ou ao pacote Open Design. Registre pacote, versao, nomes e usos em `design-contract.json`. Nao gere icones funcionais como bitmap e nao use emoji como substituto. Navegacao, acoes recorrentes, status e cards de dashboard precisam de iconografia consistente.

## Handoff

O pacote `resolved/` é autoritativo. `original/` preserva o Open Design sem alteração. O Orquestrador copia cada asset para `materializeInto`, recebe cada `seedBindings` no relatório de materialização e o aplica na task responsável pelo seed; depois comprova no navegador que as imagens aparecem nos estados normais e possuem `alt`. O handoff deve sinalizar `seedImageryRequired` e `visualImageryPlan` no `project-baseline.json`. Em `status: DONE`, o validador bloqueia — nao apenas alerta — quando a politica obrigatoria nao tiver o minimo de assets reais vinculados.
