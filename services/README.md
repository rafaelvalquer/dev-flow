# Dev Flow Services

Serviços auxiliares usados pelo backend principal.

## `stt-python`

- Transcrição de áudio
- Conversão para formato alvo
- TTS e TTS ULAW

Health:

- `GET http://127.0.0.1:8000/health`

## `cc-puppeteer`

- Sessões automatizadas auxiliares
- Login, estado, screenshot e encerramento de sessão para alvos suportados

Health:

- `GET http://127.0.0.1:8010/health`
