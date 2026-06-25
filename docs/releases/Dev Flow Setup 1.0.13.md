# Dev Flow Setup 1.0.13

Release focado em novas ferramentas operacionais do Portal ICC, com busca automatizada de tarefas por arquivo, diretorio local e diretorio remoto.

## Novas implementacoes

- Nova ferramenta "Busca Tarefas ICC" dentro da aba Ferramentas.
- Pesquisa autenticada no Portal ICC reutilizando a mesma sessao das ferramentas Consulta CDR e Dashboard CDR.
- Varredura automatica das paginas de tarefas em `/portalicc/tarefas-list/page/:page`, com parada ao identificar pagina sem registros.
- Consulta automatica da etapa principal de cada tarefa em `/portalicc/etapas-form/tarefa/:id/1`.
- Filtros por Arquivo, Local e Remoto, aceitando buscas parciais sem diferenciar maiusculas, minusculas ou acentos.
- Match combinado entre campos: quando mais de um filtro e preenchido, todos precisam corresponder para a tarefa aparecer nos resultados.
- Tabela de resultados com ID, tarefa, status, SCreator, execucoes, descricao, servidor, usuario, arquivo, local, remoto, acao, descricao da etapa, ordem, ultima atualizacao e usuario responsavel.
- Indicadores de progresso final com paginas lidas, tarefas encontradas, detalhes analisados, detalhes com falha e resultados encontrados.

## Melhorias

- Parser dedicado para HTML de tarefas do Portal ICC, extraindo IDs pela tabela e links de etapas.
- Parser dedicado para formulario de etapa, extraindo dados de `input`, `select` e `textarea`.
- Tratamento de falhas pontuais ao abrir detalhes de tarefas, mantendo a busca em andamento quando uma tarefa isolada nao puder ser analisada.
- Concorrencia limitada na consulta dos detalhes das tarefas para reduzir carga simultanea sobre o Portal ICC.
- Suporte explicito ao campo Local para caminhos como `/dados/screator/datafiles/ATIVO_COP_NICE/`, separado do campo Remoto.

## Seguranca

- O campo Senha da etapa (`param3`) nao e retornado pela API nem exibido na interface.
- Sessoes expiradas do Portal ICC continuam encerrando a busca e solicitando novo login.

## Build

- Versao do release: `1.0.13`.
- Instalador esperado: `desktop/release/Dev Flow Setup 1.0.13.exe`.
