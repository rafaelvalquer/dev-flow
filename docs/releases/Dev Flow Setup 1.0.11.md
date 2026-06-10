# Dev Flow Setup 1.0.11

Release focado em melhorias operacionais do Dev Flow, novos recursos de analise e ajustes de estabilidade para o fluxo Jira/AM.

## Novas implementacoes

- Login com opcao de salvar senha neste computador, preenchendo automaticamente usuarios usados recentemente no mesmo ambiente.
- Dashboard AM com novo widget "Gargalos por status", exibindo um funnel com dias medios por status, volume de tickets e itens parados ha 7 dias ou mais.
- Migracao automatica do layout do Dashboard AM para incluir o novo widget sem perder a organizacao salva pelo usuario.
- Dashboard AM com suporte ao grafico funnel via ECharts, incluindo tooltip detalhado, exportacao de imagem e interacao para abrir o recorte de tickets.
- Melhorias nas analises e visualizacoes de CDR, incluindo dashboard, consulta paginada e salvamento de evidencias.
- Implementacao de visualizacao Sankey para apoiar analises de fluxo.
- Melhorias nos detalhes de cards, timeline operacional e timeline de tickets.
- Melhorias no versionamento e fluxos de URA.
- Ajustes no fluxo de TTS e recursos de benchmark.

## Correcoes

- Corrigido o download de anexos Jira com nomes contendo acentos, travessao e outros caracteres Unicode no Organizar Documentacao.
- Melhor tratamento do cabecalho `Content-Disposition` em downloads de anexos, mantendo o nome original UTF-8 e usando fallback compativel com HTTP.
- Ajustes visuais no bloco de opcoes da tela de login para acomodar as novas preferencias.

## Build

- Versão do desktop atualizada de `1.0.10` para `1.0.11`.
- Instalador esperado: `desktop/release/Dev Flow Setup 1.0.11.exe`.
