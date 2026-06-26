# ContentOS - arquitetura inicial

O ContentOS nasce como um sistema de seções, não como kanban.

## Seções

- Ideias: captura rápida, origem, ângulo editorial, prioridade e tags.
- Peças: unidade central de produção, ligada a ideias, materiais, textos e publicações.
- Textos: legendas para Instagram, TikTok e YouTube Shorts, com SEO e regras por plataforma.
- Arquivos: versões de vídeo, brutos, editados, legendados, thumbnails e materiais.
- Publicações: histórico do que saiu, onde saiu, quando saiu e com qual peça.
- Biblioteca: formatos, estruturas e referências reutilizáveis.
- IA auxiliar: camada futura para sugestão, revisão e organização.

## Regras de texto

- Instagram: até 5 hashtags.
- TikTok: hashtags livres.
- YouTube Shorts: até 100 caracteres.

## Princípio da IA

A IA não é o centro do sistema. Ela deve entrar como serviço auxiliar, com pontos de entrada pequenos:

- sugerir próximos passos de uma peça;
- revisar SEO e hashtags;
- adaptar uma legenda por plataforma;
- encontrar peças incompletas.

No código, essa fronteira começa em `src/ai/assistantGateway.js`.
Nesta primeira tela, `src/app.js` também carrega uma versão embutida dessa fronteira para permitir abrir o app direto pelo arquivo `index.html`.

## Dados locais

Nesta primeira versão, os dados ficam no navegador via `localStorage`.
Isso deixa a navegação instantânea e mantém o protótipo simples.
Depois, a mesma estrutura pode migrar para banco local, servidor ou nuvem.
