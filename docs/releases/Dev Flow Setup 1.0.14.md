# Dev Flow Setup 1.0.14

Release focado em melhorias de produtividade, documentacao URA, visoes operacionais do workspace e ampliacao da busca automatica do Painel PO.

## Novas implementacoes

- Novo modulo de Documentacao URA com upload, processamento, analise e organizacao dos fluxos.
- Analise de URA com apoio de IA para gerar insights, matriz de skills, plano de testes, runbook e pontos de atencao.
- Painel de detalhes do processamento URA com acompanhamento por etapas, erros, avisos e artefatos gerados.
- Novos widgets no Developer Workspace para Treemap de Portfolio e Meu Ritmo.
- Nova ferramenta de Horario Comercial para validar janelas operacionais e apoiar planejamentos.
- Suporte ao projeto `UPO` na busca automatica do Painel PO, mantendo `ICON` no mesmo recorte.

## Melhorias

- Melhorias nos paineis AM/PO e Developer Center para consolidar leitura de portfolio, riscos, status e ritmo de trabalho.
- Evolucao do fluxo de Documentacao URA no backend, com servicos dedicados para jobs, proxy, chunking e analise.
- RDM Copilot atualizado para usar o fluxo OpenAI ja presente no codigo.
- Ajustes visuais e de layout nos modulos principais para suportar os novos paineis e widgets.
- Build desktop continua preparando os assets do client antes do empacotamento Windows.

## Compatibilidade

- Funcionalidades existentes foram preservadas.
- Instaladores anteriores permanecem no diretorio de release.
- A busca automatica do Painel PO agora usa `project in (ICON, UPO)` para tickets ativos e concluidos recentes.

## Build

- Versao do release: `1.0.14`.
- Instalador esperado: `desktop/release/Dev Flow Setup 1.0.14.exe`.
