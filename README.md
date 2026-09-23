# Nuvio Control Center

**Versão documentada: v0.11.4 — Reorganização e Documentação do Repositório**

Painel pessoal, executado no navegador, para consultar e administrar perfis e dados da conta Nuvio. O projeto também importa/exporta backups, diagnostica addons e integra a biblioteca com o Trakt.

O repositório atual é uma aplicação web feita com **Next.js App Router, React e TypeScript**, com rotas de servidor para falar com a Cloud do Nuvio e serviços externos. Não é um aplicativo React Native, Electron ou uma aplicação da plataforma anterior.

## Começar

Requisitos: Node.js `>=20.9.0` e npm.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. Para gerar a versão de produção local:

```bash
npm run build
npm start
```

As variáveis de ambiente são opcionais; os padrões apontam para a API pública do Nuvio. Consulte [`.env.example`](.env.example) e [o guia de desenvolvimento](docs/DEVELOPMENT.md).

## Mapa rápido

| Caminho | Responsabilidade |
| --- | --- |
| `app/page.tsx` | Estado e fluxos da aplicação: sessão, perfis, backups, gravações e composição das telas. |
| `app/api/` | Endpoints de servidor para Nuvio, addons, importação de JSON e Trakt. |
| `components/screens/ProfileDataScreens.tsx` | Telas de progresso/histórico e biblioteca/Trakt. |
| `lib/nuvio.ts` | Tipos, normalização de dados, identidade de addons e regras de catálogos. |
| `lib/nuvio-client.ts` | Cliente autenticado compartilhado para a Cloud do Nuvio. |
| `lib/safe-external-fetch.ts` | Consulta segura de URLs de addons/coleções, com proteção contra SSRF. |
| `lib/sync-safety.ts` | Detecção de conflitos e confirmação de gravações por releitura. |
| `lib/local-snapshots.ts` | Armazenamento local e controle de espaço dos backups. |
| `app/style.css` | Estilos e comportamento responsivo. |
| `docs/` | Arquitetura, referência de API, desenvolvimento e contribuição. |

Veja [a arquitetura](docs/ARCHITECTURE.md) para o mapa completo e [a referência da API](docs/API.md) para os endpoints.

## Scripts

| Comando | Uso |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento Next.js. |
| `npm run build` | Build de produção e verificação TypeScript executados pela Vercel. |
| `npm start` | Inicia o build de produção. |
| `npm test` | Executa a suíte Vitest. |
| `npm run test:watch` | Executa Vitest em modo de observação. |

## Dados e privacidade

- O painel não possui banco de dados próprio. Dados da conta são lidos e gravados na Cloud do Nuvio.
- O access token fica no estado da aplicação durante a sessão. Se “Manter sessão” estiver ativado, o refresh token é guardado no `localStorage` do navegador.
- Backups locais e fingerprints de manifesto ficam no `localStorage` do navegador; um snapshot local não é sincronizado automaticamente entre aparelhos.
- Credenciais do Trakt são mantidas no estado da tela e enviadas à rota de servidor apenas para a operação solicitada.
- A validação de URLs externas bloqueia IPs privados/reservados, restringe portas, valida DNS e limita redirecionamentos, tempo e tamanho de resposta.
- A interface é voltada ao uso pessoal. As rotas de diagnóstico/importação que recebem URLs públicas não são uma camada de autenticação da aplicação; não trate um deploy público como serviço multiusuário protegido.

## Escopo e limites

- Um manifesto válido confirma que o addon respondeu. Testes de catálogo são avaliados separadamente.
- Catálogos que exigem parâmetros ou busca não são declarados falhos por uma requisição sem esses parâmetros.
- Metadata e Streams podem aparecer como declarados, mas não são testados pelo diagnóstico atual.
- A Cloud do Nuvio não expõe controle separado para ativar cada catálogo de busca; essa área é informativa no painel.
- Diagnósticos são dados observados no momento da consulta. Erros HTTP 503 e timeouts podem refletir a disponibilidade/regras do host do addon.

## Contribuir ou manter

Leia [`CONTRIBUTING.md`](CONTRIBUTING.md) antes de alterar fluxos de sincronização, autenticação ou consulta externa. Mudanças funcionais e de comportamento devem ser registradas no [CHANGELOG](CHANGELOG.md) com um nome de versão que possa ser usado na mensagem de commit.
