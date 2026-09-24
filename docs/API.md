# Rotas da API

As rotas são handlers do Next.js em `app/api`. Os exemplos abaixo descrevem a finalidade e os campos centrais; confira o handler antes de alterar um contrato.

| Rota | Método | Finalidade e entrada principal |
| --- | --- | --- |
| `/api/nuvio/sign-in` | POST | Autentica com `email` e `password`; retorna tokens de sessão. |
| `/api/nuvio/refresh` | POST | Renova sessão com `refresh_token`. |
| `/api/nuvio/inventory` | POST | Busca dados da conta Nuvio usando `token`: perfis, addons, plugins, coleções, progresso e configurações. |
| `/api/nuvio/profile-data` | POST | Lê `token`, `profileId`, `kind` (`library` ou `history`) e `page`; retorna página de dados (até 100 itens). |
| `/api/nuvio/mutate` | POST | Grava alterações usando `token`, `profileId`, `kind` e os dados da operação. `kind: "profile-delete"` exclui um perfil secundário; alterações de catálogo são verificadas por nova leitura. |
| `/api/nuvio/diagnose` | POST | Diagnostica URLs de addons. Por padrão pode transmitir eventos SSE; `stream: false` solicita JSON. |
| `/api/nuvio/addon-preview` | POST | Obtém uma prévia dos manifestos informados em `urls`. |
| `/api/nuvio/resolve-watch` | POST | Tenta resolver metadados de reprodução a partir de `addons` e `items`. |
| `/api/import-url` | POST | Importa JSON de uma `url` remota validada. |
| `/api/trakt/collection` | POST | Lê coleção Trakt com `clientId` e `accessToken`. |
| `/api/trakt/sync-collection` | POST | Envia itens à coleção Trakt com `clientId`, `accessToken` e `items`. |

## Regras para mudanças de contrato

- Atualize o chamador em `app/` ou `components/` junto com o handler.
- Não retorne tokens em logs ou mensagens de erro.
- Valide o corpo, limites de tamanho e tipos no servidor; trate respostas externas como dados não confiáveis.
- Para URL fornecida pelo usuário, use `lib/safe-external-fetch.ts` e mantenha validações de protocolo, DNS/IP, redirecionamentos, timeout e tamanho.
- Preserve o fallback JSON da rota de diagnóstico além do modo SSE.
