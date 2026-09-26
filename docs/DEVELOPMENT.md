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

Abra `http://localhost:3000`. Os valores abaixo são opcionais ao usar a API padrão do Nuvio. Para apontar a outra instância, configure em `.env.local`:

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

1. Importe o repositório na Vercel e confirme que o framework detectado é Next.js.
2. Use Node.js `>=20.9.0`, conforme `package.json`. Mantenha os comandos de instalação, build e diretório de saída nos padrões Next.js detectados pela plataforma.
3. Para usar `https://api.nuvio.tv`, não é necessário configurar variáveis. Para outra Cloud API, defina `NUVIO_API_BASE` e, se aplicável, `NUVIO_SUPABASE_ANON_KEY` nas configurações de ambiente do projeto. Não use prefixo `NEXT_PUBLIC_` para credenciais.
4. Implante e verifique o resultado do build. A aplicação não depende de arquivos gravados ou estado mantido na memória do processo servidor entre requisições.

### Uso de uma implantação pública

O código não oferece autenticação própria, cotas por usuário ou rate limiting implementado nas rotas de consulta externa. As rotas de diagnóstico, prévia de addon e importação validam os destinos externos para reduzir SSRF, mas visitantes ainda podem iniciar consultas e consumir recursos da implantação. Antes de divulgar uma instância Vercel, configure limites de requisição no Firewall da Vercel e monitore o uso. As regras disponíveis e seus limites variam por plano; consulte a [documentação do Firewall](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting). Para servir várias pessoas com controles próprios, autenticação e medidas contra abuso precisam ser planejadas como trabalho funcional separado.

Uma chave Supabase `anon` não é uma chave administrativa ou segredo de serviço. Nunca substitua-a por uma chave `service_role` nem publique tokens de usuários. Não registre corpos de requisição ou cabeçalhos de autenticação nos logs.

## Organização dos testes

Os testes ficam próximos às regras que cobrem em `lib/*test.ts` e junto a handlers em arquivos `route.test.ts`. Ao modificar contrato de API, regras de sincronização ou proteção de URL externa, atualize os testes correspondentes e rode `npm test`; para validar implantação, rode `npm run build`.

## Convenções de manutenção

- Prefira alterações pequenas e componentes ou funções com responsabilidade clara.
- Normalize dados externos na fronteira de entrada; mantenha tipos de domínio em `lib/nuvio.ts`.
- Reutilize o cliente Nuvio servidor e os utilitários de requisição limitada.
- Preserve a leitura de confirmação após gravações importantes no Cloud.
- Mantenha estados de tela e diagnóstico associados ao perfil correto.
- Não registre credenciais nem conteúdo sensível de contas.
