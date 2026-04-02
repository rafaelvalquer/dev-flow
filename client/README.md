# Dev Flow Client

Frontend React/Vite da plataforma operacional Claro Dev Flow.

## Como rodar

```bash
cd client
npm install
npm run dev
```

Para gerar o build:

```bash
cd client
npm run build
```

## Variáveis úteis

O client consome principalmente a API do backend Express. Quando necessário, configure:

```env
VITE_JIRA_BROWSE_BASE=https://clarobr-jsw-tecnologia.atlassian.net
```

## Observações de arquitetura

- `src/App.jsx` organiza os módulos principais: GMUD, RDM, Painel PO e Ferramentas
- o frontend depende fortemente das rotas `/api/*` do servidor
- módulos pesados como calendário, gantt e dashboards merecem lazy load em uma próxima etapa

## Fluxo recomendado de desenvolvimento

1. Suba o backend em `server`
2. Suba os serviços auxiliares em `services`
3. Inicie o frontend em `client`
