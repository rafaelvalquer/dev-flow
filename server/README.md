server/
index.js # start (listen)
app.js # express app + middlewares + rotas + static do Vite

config/
env.js # dotenv (carrega .env uma vez)

db/
mongo.js # conexão Mongo (Atlas ou local)

middlewares/
upload.js # multer (memória)

routes/
stt.routes.js # /api/stt/_
jira.routes.js # /api/jira/_
db.routes.js # /api/db/\* (CRUD simples para users/tickets/history)

models/
User.js
Ticket.js
TicketHistory.js

utils/
sendUpstream.js
jiraAuth.js

lib/
rdmCopilotGemini.js
