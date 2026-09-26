# Nuvio Control Center

**Versão: v0.12.0**

Aplicação web para consultar e administrar perfis de uma conta Nuvio. Ela reúne gerenciamento de addons, plugins, catálogos e coleções, importação e exportação de backups, diagnóstico de addons, biblioteca e integração opcional com o Trakt.

O projeto usa Next.js App Router, React e TypeScript. A interface roda no navegador; rotas do servidor encaminham operações autenticadas para a Cloud do Nuvio e fazem consultas externas limitadas. O Nuvio Cloud continua sendo a fonte dos dados sincronizados. O Control Center não mantém banco de dados próprio.

## Começar

Requisitos: Node.js `>=20.9.0` e npm.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. Para gerar e iniciar uma versão de produção local:

```bash
npm run build
npm start
```

Por padrão, o app usa a Cloud API pública do Nuvio e não exige variáveis de ambiente. Para apontar a uma instância diferente, copie `.env.example` para `.env.local` e configure os valores necessários. Veja [Desenvolvimento e publicação](docs/DEVELOPMENT.md).

## Publicar na Vercel

1. Importe o repositório como um projeto Next.js.
2. Use Node.js `>=20.9.0`; deixe a Vercel detectar os comandos e a saída padrão do Next.js.
3. Para a Cloud API padrão, nenhuma variável é necessária. Para outra instância, defina `NUVIO_API_BASE` e, se aplicável, `NUVIO_SUPABASE_ANON_KEY` nas configurações de ambiente da Vercel.
4. Faça o deploy e confira o build e as rotas de API nos logs da implantação.

**Antes de compartilhar uma implantação pública:** o projeto não tem autenticação própria nem limites de uso por usuário nas rotas de diagnóstico e importação que consultam URLs externas. A validação de destino protege contra acesso a redes privadas, mas não impede que visitantes usem essas rotas ou consumam recursos da implantação. Configure limites de requisição no Firewall da Vercel e monitore o uso; para uma instância multiusuário, projete e implemente uma camada de autenticação e controles de abuso antes de abri-la ao público. Uma implantação pública do código não equivale a um serviço público pronto para uso irrestrito.

## Segurança e dados

- O login é feito diretamente com a Cloud do Nuvio por uma rota do servidor. O token de acesso fica em memória no navegador; o token de renovação fica em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- Com “lembrar neste dispositivo”, o cookie de renovação pode durar até 30 dias; sem essa opção, é um cookie de sessão. O `localStorage` guarda email e preferência de sessão para restaurar a experiência.
- Snapshots e fingerprints ficam no armazenamento local do navegador. Eles não são enviados para um banco do projeto nem sincronizados entre dispositivos.
- As credenciais do Trakt são mantidas no estado da página e enviadas ao servidor para a operação solicitada. Evite usar a integração em dispositivos compartilhados.
- Rotas de URL externa validam DNS e endereços, restringem redirecionamentos e limitam tempo e tamanho de resposta. Isso reduz SSRF, mas não substitui autenticação, rate limiting ou monitoramento de custos.
- Não coloque tokens de conta, refresh tokens ou credenciais Trakt em variáveis `NEXT_PUBLIC_*`, commits, logs ou backups compartilhados.

## O que o diagnóstico verifica

O diagnóstico automático consulta o manifesto e lista os catálogos declarados pelo addon. Ele não consulta cada catálogo automaticamente. A pessoa pode iniciar testes manuais de catálogos na tela de detalhes. Um manifesto válido confirma que o addon respondeu; falhas de catálogo, timeout e erros HTTP são resultados daquela tentativa e não garantem indisponibilidade permanente. Metadata e Streams são identificados como recursos declarados, mas não são testados.

## Licença e dependências

O código está sob a [PolyForm Noncommercial License 1.0.0](LICENSE). Ela permite uso, modificação e redistribuição não comerciais nos termos da licença; uso comercial requer autorização separada. É uma licença source-available com restrição comercial, não uma licença open source aprovada pela OSI. Dependências e assets de terceiros podem ter termos próprios.

## Estrutura do projeto

| Caminho | Responsabilidade |
| --- | --- |
| `app/page.tsx` | Estado e fluxos da aplicação. |
| `app/api/` | Rotas de servidor para Nuvio, addons, importação e Trakt. |
| `components/` | Componentes compartilhados de interface. |
| `lib/nuvio.ts` | Tipos, normalização e regras de domínio. |
| `lib/nuvio-client.ts` | Cliente servidor para a Cloud do Nuvio. |
| `lib/safe-external-fetch.ts` | Validação e consulta limitada de URLs externas. |
| `lib/sync-safety.ts` | Verificação de alterações sincronizadas. |
| `lib/local-snapshots.ts` | Snapshots locais no navegador. |
| `docs/` | Guias de arquitetura, API, desenvolvimento e contribuição. |

## Comandos

| Comando | Uso |
| --- | --- |
| `npm run dev` | Servidor local de desenvolvimento. |
| `npm run build` | Build de produção. |
| `npm start` | Inicia o build de produção local. |
| `npm test` | Executa os testes Vitest. |
| `npm run test:watch` | Executa Vitest em modo de observação. |

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md): componentes, dados e fluxos.
- [Referência da API](docs/API.md): rotas e contratos principais.
- [Desenvolvimento e publicação](docs/DEVELOPMENT.md): configuração local, Vercel e verificações.
- [Como contribuir](CONTRIBUTING.md): escopo e processo para mudanças.
- [Histórico de alterações](CHANGELOG.md): mudanças por versão.
