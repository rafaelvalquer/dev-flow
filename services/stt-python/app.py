#services\stt-python\app.py
import os
import uuid
from fastapi import FastAPI, UploadFile, File
from faster_whisper import WhisperModel

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Modelos: "tiny", "base", "small", "medium", "large-v3"
# Para Windows CPU: recomendo "base" ou "small"
# compute_type="int8" melhora performance em CPU
model = WhisperModel("small", device="cpu", compute_type="int8")

app = FastAPI(title="Whisper Local STT API")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/transcribe")
def transcribe_audio(file: UploadFile = File(...)):
    # Salva o arquivo recebido
    ext = os.path.splitext(file.filename)[1].lower() or ".bin"
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)

    with open(path, "wb") as f:
        f.write(file.file.read())

    # Transcreve
    segments, info = model.transcribe(path, vad_filter=True)

    text_parts = []
    for seg in segments:
        text_parts.append(seg.text)

    text = "".join(text_parts).strip()

    return {
        "language": info.language,
        "duration": info.duration,
        "text": text,
        "file_saved_as": filename
    }
