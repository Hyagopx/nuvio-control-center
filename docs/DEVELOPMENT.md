# Desenvolvimento e publicação

## Requisitos

- Node.js `>=20.9.0` (ver `package.json`).
- npm.
- Conta Nuvio para usar os fluxos autenticados da aplicação.

## Executar localmente

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Abra `http://localhost:3000`. Configure em `.env.local`:

| Variável | Uso |
| --- | --- |
| `NUVIO_API_BASE` | URL base da API Nuvio; o exemplo usa `https://api.nuvio.tv`. |
| `NUVIO_SUPABASE_ANON_KEY` | Chave pública opcional usada pelo cliente Nuvio quando configurada. |

Não coloque senhas pessoais, tokens de conta ou chaves privadas em `.env.example`, no Git ou em código cliente.

## Comandos

| Comando | Uso |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento. |
| `npm run build` | Build otimizado de produção e verificação de tipos do Next. |
| `npm run start` | Inicia o build de produção local. |
| `npm test` | Executa testes Vitest. |
| `npm run test:watch` | Executa Vitest em modo de observação. |

## Publicação na Vercel

O repositório usa Next.js e pode ser importado como projeto Next.js na Vercel. Configure as variáveis necessárias no projeto e use a versão de Node indicada em `package.json`. A implantação de produção executa o build; corrija erros de TypeScript antes de publicar. Não dependa de dados mantidos apenas em memória do processo servidor.

## Organização dos testes

Os testes ficam próximos às regras que cobrem em `lib/*test.ts` e junto a handlers em arquivos `route.test.ts`. Ao modificar contrato de API, regras de sincronização ou proteção de URL externa, atualize os testes correspondentes e rode `npm test`; para validar implantação, rode `npm run build`.

## Convenções de manutenção

- Prefira alterações pequenas e componentes ou funções com responsabilidade clara.
- Normalize dados externos na fronteira de entrada; mantenha tipos de domínio em `lib/nuvio.ts`.
- Reutilize o cliente Nuvio servidor e os utilitários de requisição limitada.
- Preserve a leitura de confirmação após gravações importantes no Cloud.
- Mantenha estados de tela e diagnóstico associados ao perfil correto.
- Não registre credenciais nem conteúdo sensível de contas.
