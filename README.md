# Nuvio Control Center v0.10 — Core Stable

Painel pessoal para administrar perfis, addons, catálogos, plugins, coleções, progresso e biblioteca do Nuvio.

## O que muda nesta versão

A interface da v0.9 foi preservada. A principal mudança é no motor interno.

- Diagnóstico separado em manifesto, addon e catálogo.
- Falha de um catálogo não transforma automaticamente o addon em falho.
- Catálogos com parâmetros obrigatórios não são testados com uma requisição inválida.
- `search-only` é tratado como categoria de busca, não como catálogo de Home.
- Chaves de catálogo seguem a identidade usada pelo Nuvio: addon + tipo + ID.
- Estado de catálogo pode considerar chave atual e chave legada.
- Catálogos identificados como fontes de coleção não poluem as listas normais de Home/Busca.
- Diagnóstico sem cache para detectar alterações recentes de manifesto.
- Troca de perfil limpa diagnósticos antigos.
- Diagnóstico em fluxo progressivo: manifesto/catálogos aparecem conforme cada addon responde.
- Estado de catálogo salvo só é confirmado depois de reler e comparar a resposta da Cloud.
- Ações em massa Home permitem ativar/desativar todos os catálogos de um addon.
- Fontes de coleção podem apontar para catálogos não declarados no manifesto usando `addonId`, `type` e `catalogId`.
- O detalhe do addon separa manifesto, catálogo, configuração Cloud, Metadata e Streams não testados.

## Princípio de segurança

O painel não assume que um endpoint não testável significa que um addon está quebrado. Um manifesto válido é evidência de que o addon foi encontrado; os testes de catálogo são evidência separada.

## Sessão e dados

- O token de acesso fica em memória no navegador e é enviado às rotas do servidor que acessam a Cloud API.
- O token de renovação é guardado em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção. Com “lembrar neste dispositivo”, o cookie dura até 30 dias; sem essa opção, ele é de sessão.
- Sessões salvas pelas versões anteriores são migradas na próxima abertura. Depois da renovação bem-sucedida, o navegador mantém apenas email e preferência de sessão no `localStorage`.
- O logout e a abertura de um snapshot removem a sessão do navegador e pedem ao servidor para apagar o cookie.
- Snapshots e credenciais Trakt continuam sendo dados locais do navegador; evite usar o painel em dispositivos compartilhados.

As rotas aplicam limites de tamanho e tempo às requisições externas. As respostas da API recebem `Cache-Control: no-store`, e o app envia cabeçalhos básicos contra MIME sniffing, enquadramento e permissões do navegador.

## Preparação para implantação pública

O rate limiting do Vercel é configurado no painel Firewall, fora deste repositório. Como regra inicial conservadora, monitore `/api/` por IP por 60 segundos com limite de 120 requisições, usando a ação `Log`. Revise o tráfego normal, em especial a prévia em lote de addons; só depois altere a ação para `Rate Limit`. A cota de regras depende do plano Vercel. Veja [a documentação de rate limiting do Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) antes de publicar a regra.

Configure `NUVIO_API_BASE` e `NUVIO_SUPABASE_ANON_KEY` como variáveis de ambiente do servidor quando usar uma Cloud API diferente dos padrões. Não exponha tokens de conta, refresh tokens nem credenciais Trakt em variáveis `NEXT_PUBLIC_*`, logs ou arquivos de backup publicados.

## Licença do projeto

O código deste projeto está sob a [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0), indicada em `LICENSE`. Ela permite copiar, modificar e redistribuir o código para fins não comerciais, mantendo a licença e o aviso exigido. Uso comercial requer autorização separada. É uma licença source-available, não uma licença open source aprovada pela OSI, pois restringe uso comercial.

Conforme informado pelo autor, os outros repositórios foram consultados apenas para entender a chamada de API e a documentação do Nuvio; não foi incorporado código deles. As dependências e quaisquer assets de terceiros continuam sujeitos às próprias licenças.

## Execução

```bash
npm install
npm run dev
```

Produção:

```bash
npm run build
npm start
```
