# services\stt-python\app.py
import os
import uuid
import json
import subprocess
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from faster_whisper import WhisperModel
import edge_tts
from typing import Union
from pydantic import BaseModel, field_validator


from dotenv import load_dotenv
load_dotenv()

import shutil

FFPROBE = os.getenv("FFPROBE_PATH") or shutil.which("ffprobe") or shutil.which("ffprobe.exe")
FFMPEG  = os.getenv("FFMPEG_PATH")  or shutil.which("ffmpeg")  or shutil.which("ffmpeg.exe")

if not FFPROBE or not os.path.exists(FFPROBE):
    raise RuntimeError(f"ffprobe não encontrado. FFPROBE_PATH={os.getenv('FFPROBE_PATH')}")
if not FFMPEG or not os.path.exists(FFMPEG):
    raise RuntimeError(f"ffmpeg não encontrado. FFMPEG_PATH={os.getenv('FFMPEG_PATH')}")


# garante que processos filhos do --reload enxerguem o bin
ffbin = os.path.dirname(FFPROBE)
os.environ["PATH"] = ffbin + os.pathsep + os.environ.get("PATH", "")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.getenv("STT_UPLOAD_DIR") or os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Padrão alvo: WAV / μ-law / 8000 Hz / mono (≈64 kbps)
TARGET_SR = 8000
TARGET_CH = 1
TARGET_CODEC = "pcm_mulaw"  # G.711 μ-law

model = WhisperModel("small", device="cpu", compute_type="int8")
app = FastAPI(title="Whisper Local STT API")


def save_upload(file: UploadFile) -> str:
    ext = os.path.splitext(file.filename)[1].lower() or ".bin"
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        f.write(file.file.read())
    return path


def run_ffprobe(path: str) -> dict:
    cmd = [
        FFPROBE,
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,codec_tag_string,sample_rate,channels,bit_rate",
        "-show_entries", "format=duration,format_name",
        "-of", "json",
        path,
    ]

    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise HTTPException(status_code=400, detail=f"ffprobe falhou: {p.stderr[:300]}")
    data = json.loads(p.stdout or "{}")
    streams = data.get("streams") or []
    if not streams:
        raise HTTPException(status_code=400, detail="Arquivo não possui stream de áudio.")
    return {"stream": streams[0], "format": data.get("format") or {}}


def audio_attributes(path: str) -> dict:
    ffp = run_ffprobe(path)
    s = ffp["stream"]
    fmt = ffp["format"]

    codec_name = (s.get("codec_name") or "").lower()
    codec_tag = (s.get("codec_tag_string") or "").lower()
    sr = int(s.get("sample_rate") or 0)
    ch = int(s.get("channels") or 0)

    br_raw = s.get("bit_rate")
    br = int(br_raw) if (br_raw and str(br_raw).isdigit()) else 0

    # Se bit_rate vier ausente/0, estimar (μ-law é 8 bits por amostra)
    if br == 0 and sr > 0 and ch > 0:
        br = sr * 8 * ch  # bps

    is_ulaw = codec_name in ("pcm_mulaw", "mulaw") or codec_tag in ("ulaw", "mulaw")
    codec_label = "U-law" if is_ulaw else (codec_name or "unknown")
    mono_label = "mono" if ch == 1 else ("stereo" if ch == 2 else f"{ch}ch")

    kbps = round(br / 1000) if br else 0

    return {
        "codec": codec_label,
        "sample_rate_hz": sr,
        "bit_rate_kbps": kbps,
        "channels": ch,
        "channel_layout": mono_label,
        "format_name": fmt.get("format_name"),
        "duration_sec": float(fmt.get("duration") or 0),
        "summary": f"{codec_label}, {sr}hz, {kbps}kbps, {mono_label}",
        "matches_target": bool(
            is_ulaw and sr == TARGET_SR and ch == TARGET_CH and (kbps == 64 or br == 64000)
        ),
        "target": f"U-law, {TARGET_SR}hz, 64kbps, mono",
    }


def run_ffmpeg_filter(path: str, filter_name: str) -> str:
    cmd = [FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af", filter_name, "-f", "null", "-"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return (p.stderr or "") + "\n" + (p.stdout or "")


def parse_volume_metrics(path: str) -> dict:
    output = run_ffmpeg_filter(path, "volumedetect")
    mean_volume = None
    max_volume = None
    for line in output.splitlines():
        if "mean_volume:" in line:
            try:
                mean_volume = float(line.split("mean_volume:", 1)[1].split("dB", 1)[0].strip())
            except Exception:
                pass
        if "max_volume:" in line:
            try:
                max_volume = float(line.split("max_volume:", 1)[1].split("dB", 1)[0].strip())
            except Exception:
                pass
    return {"mean_db": mean_volume, "peak_db": max_volume}


def parse_silence_metrics(path: str) -> dict:
    output = run_ffmpeg_filter(path, "silencedetect=noise=-40dB:d=0.2")
    duration = audio_attributes(path)["duration_sec"]
    starts = []
    ends = []
    for line in output.splitlines():
        if "silence_start:" in line:
            try:
                starts.append(float(line.split("silence_start:", 1)[1].strip()))
            except Exception:
                pass
        if "silence_end:" in line:
            try:
                ends.append(float(line.split("silence_end:", 1)[1].split("|", 1)[0].strip()))
            except Exception:
                pass

    initial = 0.0
    final = 0.0
    if starts and starts[0] <= 0.05 and ends:
      initial = max(0.0, ends[0] - starts[0])
    if starts and duration:
      last_start = starts[-1]
      last_end = ends[-1] if len(ends) >= len(starts) else duration
      if last_end >= duration - 0.1:
        final = max(0.0, duration - last_start)
    return {"initial_sec": initial, "final_sec": final}


def analyze_audio_file(path: str, original_name: str) -> dict:
    metadata = audio_attributes(path)
    volume = parse_volume_metrics(path)
    silence = parse_silence_metrics(path)
    format_name = (metadata.get("format_name") or "").lower()
    codec = (metadata.get("codec") or "").lower()
    issues = []

    if "wav" not in format_name:
        issues.append({"code": "not_wav", "label": "Arquivo não está em WAV."})
    if codec != "u-law":
        issues.append({"code": "codec", "label": "Codec diferente de μ-law."})
    if metadata.get("sample_rate_hz") != TARGET_SR:
        issues.append({"code": "sample_rate", "label": "Sample rate diferente de 8000 Hz."})
    if metadata.get("channels") != TARGET_CH:
        issues.append({"code": "channels", "label": "Áudio não está em mono."})
    kbps = metadata.get("bit_rate_kbps") or 0
    if kbps and not (56 <= kbps <= 72):
        issues.append({"code": "bitrate", "label": "Bitrate fora do esperado (~64 kbps)."})
    if (silence.get("initial_sec") or 0) >= 0.5:
        issues.append({"code": "initial_silence", "label": "Silêncio inicial acima de 0.5s."})
    if (silence.get("final_sec") or 0) >= 0.5:
        issues.append({"code": "final_silence", "label": "Silêncio final acima de 0.5s."})
    if volume.get("mean_db") is not None and volume["mean_db"] < -30:
        issues.append({"code": "low_volume", "label": "Volume médio baixo."})
    if volume.get("peak_db") is not None and volume["peak_db"] > -1:
        issues.append({"code": "peak_volume", "label": "Pico de volume muito alto."})
    if volume.get("mean_db") is not None and volume["mean_db"] > -12:
        issues.append({"code": "high_volume", "label": "Volume médio alto."})

    return {
        "file": {"name": original_name, "size_bytes": os.path.getsize(path)},
        "metadata": metadata,
        "volume": volume,
        "silence": silence,
        "matches_target": metadata["matches_target"] and not issues,
        "issues": issues,
        "recommendations": ["Converter para WAV μ-law 8k mono."] if issues else [],
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze_audio(file: UploadFile = File(...)):
    path = save_upload(file)
    return analyze_audio_file(path, file.filename)


@app.post("/transcribe")
def transcribe_audio(file: UploadFile = File(...)):
    path = save_upload(file)
    audio = audio_attributes(path)

    segments, info = model.transcribe(path, vad_filter=True)
    text = "".join(seg.text for seg in segments).strip()

    return {
        "language": info.language,
        "duration": info.duration,
        "text": text,
        "file_saved_as": os.path.basename(path),
        "audio": {
            "codec": audio["codec"],
            "sample_rate_hz": audio["sample_rate_hz"],
            "bit_rate_kbps": audio["bit_rate_kbps"],
            "channel_layout": audio["channel_layout"],
            "summary": audio["summary"],  # ex: "U-law, 8000hz, 64kbps, mono"
            "matches_target": audio["matches_target"],
            "target": audio["target"],
        },
    }


@app.post("/convert")
def convert_audio(file: UploadFile = File(...)):
    in_path = save_upload(file)

    out_name = f"{uuid.uuid4().hex}.wav"
    out_path = os.path.join(UPLOAD_DIR, out_name)

    cmd = [
        FFMPEG,
        "-y",
        "-i", in_path,
        "-ac", str(TARGET_CH),
        "-ar", str(TARGET_SR),
        "-c:a", TARGET_CODEC,
        out_path,
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise HTTPException(status_code=400, detail=f"ffmpeg falhou: {p.stderr[-500:]}")

    conv = audio_attributes(out_path)

    return FileResponse(
        out_path,
        media_type="audio/wav",
        filename=out_name,
        headers={
            "X-Audio-Summary": conv["summary"],
            "X-Audio-Matches-Target": str(conv["matches_target"]).lower(),
        },
    )


# TTS
# Reusa seus TARGET_* e FFMPEG já definidos no app.py
# TARGET_SR = 8000
# TARGET_CH = 1
# TARGET_CODEC = "pcm_mulaw"
# FFMPEG = "C:\\ffmpeg\\bin\\ffmpeg.exe" (ou vindo do .env)

class TTSRequest(BaseModel):
    text: str
    voice: str = "pt-BR-AntonioNeural"
    rate: Union[str, int, float] = "+0%"
    volume: Union[str, int, float] = "+0%"

    @field_validator("rate", "volume", mode="before")
    @classmethod
    def normalize_pct(cls, v):
        # Se vier número, interpreta como percentual
        # ex: 10 -> "+10%", -5 -> "-5%"
        if isinstance(v, (int, float)):
            sign = "+" if v >= 0 else ""
            return f"{sign}{v}%"
        # Se vier string sem %, adiciona
        if isinstance(v, str):
            s = v.strip()
            if s == "":
                return "+0%"
            if s.lstrip("+-").replace(".", "", 1).isdigit() and not s.endswith("%"):
                return f"{s}%"
            return s
        return "+0%"

@app.post("/tts")
async def tts(req: TTSRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Campo 'text' vazio.")

    out_mp3 = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.mp3")
    communicate = edge_tts.Communicate(text, voice=req.voice, rate=req.rate, volume=req.volume)
    await communicate.save(out_mp3)

    return FileResponse(out_mp3, media_type="audio/mpeg", filename=os.path.basename(out_mp3))

@app.post("/tts_ulaw")
async def tts_ulaw(req: TTSRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Campo 'text' vazio.")

    tmp_mp3 = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.mp3")
    out_wav = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.wav")

    communicate = edge_tts.Communicate(text, voice=req.voice, rate=req.rate, volume=req.volume)
    await communicate.save(tmp_mp3)

    cmd = [
        FFMPEG, "-y",
        "-i", tmp_mp3,
        "-ac", str(TARGET_CH),
        "-ar", str(TARGET_SR),
        "-c:a", TARGET_CODEC,
        out_wav,
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise HTTPException(status_code=400, detail=f"ffmpeg falhou: {p.stderr[-500:]}")

    return FileResponse(out_wav, media_type="audio/wav", filename=os.path.basename(out_wav))
