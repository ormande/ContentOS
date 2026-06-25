# Instagram Insights no ContentOS

## Arquitetura

O ContentOS usa a Meta Graph API pelo backend, nunca direto no navegador.
Em produção, as rotas ficam em Vercel Serverless Functions dentro de `api/instagram/`.
No desenvolvimento local, o `server.mjs` continua servindo o app.

Fluxo:

1. O usuário clica em `Conectar Instagram`.
2. O servidor abre o OAuth da Meta com as permissões necessárias.
3. O callback troca o `code` por token.
4. O servidor identifica a conta Instagram Business ou Creator conectada.
5. O sync busca mídias e insights.
6. Os snapshots são salvos no Supabase.
7. A aba Dashboard lê os dados já normalizados.

## Variáveis

Preencha no `.env`:

```env
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=http://127.0.0.1:4179/api/instagram/callback
META_AUTH_MODE=facebook
META_GRAPH_API_VERSION=v25.0
SUPABASE_SERVICE_ROLE_KEY=
```

Na Vercel, preencha as mesmas variáveis em Project Settings > Environment Variables.
O `META_REDIRECT_URI` deve usar a URL HTTPS da Vercel:

```env
META_REDIRECT_URI=https://seu-projeto.vercel.app/api/instagram/callback
```

## Tabelas

O `supabase/schema.sql` já prepara:

- `instagram_accounts`
- `instagram_media`
- `instagram_insight_snapshots`
- `instagram_sync_runs`

## Permissões Meta

Fluxo padrão atual com Facebook Login e Página conectada ao Instagram:

- `instagram_basic`
- `instagram_manage_insights`
- `pages_show_list`
- `pages_read_engagement`

Esse fluxo usa `META_APP_ID` e `META_APP_SECRET`. As variáveis `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET` só são necessárias se o projeto voltar para o login direto do Instagram.
## Dashboard

A aba Dashboard tem duas visões:

- Geral: métricas agregadas e distribuição por formato.
- Por conteúdo: lista filtrável por Reels, Posts, Stories, Carrosséis, Vídeos e Outros.

## Próximas etapas técnicas

1. Fazer deploy na Vercel com as variáveis preenchidas.
2. Rodar o `supabase/schema.sql` atualizado.
3. Clicar em `Conectar Instagram` na aba Dashboard.
4. Validar se a conta aparece em `instagram_accounts`.
5. Clicar em `Atualizar insights`.
6. Cruzar `instagram_media.permalink` com `publications.url` para vincular posts aos vídeos do ContentOS.
