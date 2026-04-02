# Dev Flow - Setup e Operação

## Backend

```bash
cd server
npm install
npm run dev
```

Variáveis principais:

```env
PORT=3001
MONGO_URI=mongodb://127.0.0.1:27017/devflow_dev
SESSION_SECRET=troque-este-segredo
JIRA_BASE=https://clarobr-jsw-tecnologia.atlassian.net
JIRA_EMAIL=seu-email
JIRA_API_TOKEN=seu-token
STT_PY_BASE=http://127.0.0.1:8000
NICE_PUP_BASE=http://127.0.0.1:8010
NICE_PUP_TOKEN=
GEMINI_API_KEY=
REQUEST_TIMEOUT_MS=15000
HEALTHCHECK_TIMEOUT_MS=3000
AUTOMATION_JOB_ENABLED=true
AUTOMATION_JOB_INTERVAL_MS=60000
```

## Frontend

```bash
cd client
npm install
npm run dev
```

Build:

```bash
cd client
npm run build
```

## Serviços auxiliares

### STT Python

```bash
cd services/stt-python
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

### NICE Puppeteer

```bash
cd services/cc-puppeteer
npm install
npm run dev
```

## Health e observabilidade

- `GET /health`
- `GET /health/dependencies`
- `GET /api/db/health`
- `GET /api/stt/health`
- `GET /api/nice/health`
- `GET /api/automation/status`

O backend responde com `X-Request-Id`, logs estruturados por request e payload padronizado de erro.
