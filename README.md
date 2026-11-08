# MDias Gravador

Sistema para os doutores da rede de clínicas gravarem anúncios no padrão MDias: login, roteiro por unidade, câmera com guia de enquadramento e teleprompter, gravação por blocos. O gestor de tráfego cadastra unidades, doutores e roteiros (inclusive gerados com IA).

- `index.html`, `app/` — app web (site estático, publicado na Vercel)
- `supabase/functions/` — funções do servidor (`admin-usuarios`, `gerar-roteiros`)
- `prototipo/` — primeira versão (arquivo único, dados salvos só no aparelho)

Servidor: Supabase (projeto `mdias-gravador`, região São Paulo). O segredo `ANTHROPIC_API_KEY` fica nas Edge Functions.
