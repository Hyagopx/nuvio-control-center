# Nuvio Control Center v0.11.3 — Corrigir URLs Raiz dos Addons

- A montagem de URLs de manifesto e catálogo agora altera diretamente o caminho da URL, evitando `//manifest.json` para addons instalados na raiz do domínio.
- Parâmetros de consulta da URL do addon são preservados ao construir os endpoints.

# Nuvio Control Center v0.11.2 — Correção DNS do Diagnóstico

- O resolvedor de DNS fixado agora atende aos dois formatos de callback do Node: endereço único e lista solicitada pelo `autoSelectFamily`.
- Isso corrige `Invalid IP address: undefined` em ambientes Node 20+ sem remover a validação de DNS público nem a proteção contra SSRF.

# Nuvio Control Center v0.11.1 — Build Fix: URLs do Diagnóstico

- O filtro dos endereços de addon agora estreita explicitamente o tipo para `string`, corrigindo o erro TypeScript no build da Vercel.

# Nuvio Control Center v0.11 — Diagnóstico por Perfil

## Diagnóstico independente por perfil

- Os resultados do diagnóstico agora ficam separados pelo índice de cada perfil.
- Voltar a um perfil mantém os resultados já obtidos, sem repetir as consultas.
- A primeira entrada em um perfil diagnostica apenas addons sem resultado; addons adicionados depois também são detectados.
- O botão de atualização continua refazendo o diagnóstico dos addons do perfil atual.
- Progresso e estado de carregamento também são separados por perfil.
- Respostas de uma sessão encerrada são descartadas para não misturar diagnósticos de contas diferentes.
- Navegadores ou conexões que não conseguem consumir o fluxo progressivo podem concluir o diagnóstico pela resposta JSON.
- Falhas de manifesto agora mostram o motivo técnico retornado pela consulta, facilitando identificar erros específicos de rede ou resposta.

# Nuvio Control Center v0.10 — Core Stable

## Revisão do Core

- O cliente de Cloud foi centralizado para as rotas de inventário e gravação.
- Alterações de catálogos só são confirmadas depois de nova leitura e comparação dos itens, estados, ordem e títulos.
- "Salvar todas" relê o perfil e compara addons, plugins, coleções e catálogos antes de limpar as alterações pendentes; divergências mantêm o rascunho local.
- A tela de catálogos ganhou ações para ativar/desativar todos os catálogos Home de um addon, preservando ordem e títulos.
- Fontes de catálogo em coleções agora aceitam `addonId`, `type` e `catalogId` digitados manualmente, além de sugestões do manifesto; isso permite fontes que o manifesto não declara.
- O detalhe do addon separa estado do manifesto, resumo Home/Busca e configurações Cloud; Metadata e Streams aparecem explicitamente como não testados.
- Diagnóstico envia resultados progressivamente, com até cinco addons concorrentes e quatro catálogos concorrentes por addon.

## Limites de classificação

- Catálogos de coleção são separados quando o manifesto traz uma indicação explícita. Não inferimos que um catálogo é interno ou exclusivo de coleção sem evidência no manifesto ou em metadados do Nuvio.
- Metadata e Streams seguem como "não testados"; a interface não simula validações que não executa.

## Motor e sincronização

- Mantida a interface da v0.9; a atualização é focada no núcleo.
- O diagnóstico deixou de tratar qualquer falha de catálogo como falha do addon.
- Manifesto, addon e catálogo agora são avaliados separadamente.
- Catálogos com parâmetros obrigatórios não são falsamente marcados como quebrados por um teste sem parâmetros.
- Catálogos `search-only` não são testados como endpoints comuns.
- O diagnóstico testa até 20 catálogos por addon, com timeout individual e cache HTTP desabilitado.
- Addon com manifesto funcional pode ficar em **Atenção** sem ser declarado como falho quando há falhas parciais de catálogo.
- Trocar de perfil limpa o diagnóstico anterior para impedir que o estado de um perfil seja exibido em outro.

## Catálogos seguindo o Nuvio

A implementação foi alinhada ao comportamento observado no código oficial do Nuvio:

- chave estável por `addonId / type / catalogId`;
- `search` obrigatório significa catálogo exclusivo de busca;
- catálogos não `search-only` compõem a lista da Home;
- suporte a `search` é separado de `search-only`;
- suporte a chave de desativação e chave legada;
- catálogo de coleção é separado da lista normal de Home/Busca quando o manifesto o identifica como tal.

## Segurança

- Nenhuma API key ou token é incluída no diagnóstico.
- Diagnóstico usa apenas URLs de addons fornecidas pelo inventário.
- O salvamento continua usando backup local antes da alteração e uma nova leitura da conta depois do salvamento.

## Limitação conhecida

A Cloud API usada pelo Control Center não oferece um campo separado para ativar/desativar cada catálogo de busca. Portanto, `Usar na busca` continua sendo uma preferência local do painel. O estado oficial de Home é sincronizado com a conta.
