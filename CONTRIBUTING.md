# Contribuindo

O Nuvio Control Center é uma aplicação web para administrar perfis e dados de uma conta Nuvio. Mudanças devem preservar os dados remotos e deixar explícito o comportamento que será gravado.

## Antes de alterar

1. Leia [a arquitetura](docs/ARCHITECTURE.md), [os contratos da API](docs/API.md) e [o guia de desenvolvimento](docs/DEVELOPMENT.md).
2. Localize o estado atual no código: a aplicação principal está em `app/page.tsx`; regras compartilhadas ficam em `lib/`; handlers ficam em `app/api/`.
3. Confirme se a mudança afeta estado local, dados persistidos no navegador ou dados da conta Nuvio.

## Ao implementar

- Valide todos os dados recebidos de navegador e serviços externos.
- Em operações de gravação, preserve a confirmação por releitura quando existente e não descarte rascunhos diante de divergências.
- Mantenha dados e diagnósticos isolados por perfil.
- Para consultas a URL externa, use a proteção de `safe-external-fetch`.
- Atualize documentação e CHANGELOG quando mudar comportamento ou contratos.
- Nunca inclua tokens, senhas, dados reais de conta ou arquivos `.env.local` em commits.

## Revisão antes de abrir uma contribuição

Confira o diff. Para mudanças funcionais, execute `npm test` e `npm run build`; registre o que foi alterado e qualquer verificação que não pôde ser executada. Para alterações apenas de documentação, confirme os links e os comandos citados.

## Versões e commits

As versões e notas de alteração ficam em `CHANGELOG.md`, com a mais recente primeiro. Registre mudanças funcionais e de documentação relevantes com linguagem direta: explique o que mudou e o impacto para quem usa ou mantém o projeto. Use um assunto de commit curto que descreva o resultado.
