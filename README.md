# Nuvio Control Center v0.11.1 — Build Fix: URLs do Diagnóstico

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
