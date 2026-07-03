# services\stt-python\app.py
import json
import logging
import os
import shutil
import subprocess
import time
import uuid
import ssl
from typing import Union

from starlette.background import BackgroundTask


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or str(value).strip() == "":
        return default

    return str(value).strip().lower() in ("1", "true", "yes", "on")


TTS_SSL_VERIFY = env_bool("TTS_SSL_VERIFY", False)
TTS_SSL_RELAX_STRICT = env_bool("TTS_SSL_RELAX_STRICT", True)

_original_create_default_context = ssl.create_default_context


def create_tts_ssl_context(*args, **kwargs):
    if not TTS_SSL_VERIFY:
        return ssl._create_unverified_context()

    ctx = _original_create_default_context(*args, **kwargs)

    if TTS_SSL_RELAX_STRICT and hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT

    return ctx


ssl.create_default_context = create_tts_ssl_context

if not TTS_SSL_VERIFY:
    ssl._create_default_https_context = ssl._create_unverified_context

import edge_tts
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from faster_whisper import WhisperModel
from pydantic import BaseModel, field_validator
from ura_docs import app as ura_docs_app

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.getenv("STT_UPLOAD_DIR") or os.path.join(BASE_DIR, "uploads")

def parse_positive_float_env(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name) or default)
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


def parse_positive_int_env(name: str, default: int) -> int:
    try:
        value = int(float(os.getenv(name) or default))
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


STT_UPLOAD_MAX_AGE_HOURS = parse_positive_float_env(
    "STT_UPLOAD_MAX_AGE_HOURS",
    24.0,
)
STT_UPLOAD_CLEANUP_INTERVAL_SECONDS = parse_positive_int_env(
    "STT_UPLOAD_CLEANUP_INTERVAL_SECONDS",
    300,
)

TEMP_AUDIO_EXTENSIONS = {
    ".mp3",
    ".wav",
    ".webm",
    ".ogg",
    ".m4a",
    ".mp4",
    ".mpeg",
    ".mpga",
    ".bin",
    ".tmp",
}

last_upload_cleanup_at = 0.0

FFPROBE = (
    os.getenv("FFPROBE_PATH")
    or shutil.which("ffprobe")
    or shutil.which("ffprobe.exe")
)
FFMPEG = os.getenv("FFMPEG_PATH") or shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")

if FFPROBE:
    ffbin = os.path.dirname(FFPROBE)
    os.environ["PATH"] = ffbin + os.pathsep + os.environ.get("PATH", "")

# Target: WAV / mu-law / 8000 Hz / mono (~64 kbps)
TARGET_SR = 8000
TARGET_CH = 1
TARGET_CODEC = "pcm_mulaw"  # G.711 mu-law

DEFAULT_WHISPER_MODEL_DIR = os.path.join(BASE_DIR, "models", "faster-whisper-small")
HF_WHISPER_SNAPSHOTS_DIR = os.path.join(
    os.path.expanduser("~"),
    ".cache",
    "huggingface",
    "hub",
    "models--Systran--faster-whisper-small",
    "snapshots",
)


def newest_dir(path: str) -> str:
    if not os.path.isdir(path):
        return ""

    candidates = []
    for name in os.listdir(path):
        full_path = os.path.join(path, name)
        if os.path.isdir(full_path):
            candidates.append((os.path.getmtime(full_path), full_path))

    candidates.sort(reverse=True)
    return candidates[0][1] if candidates else ""


def resolve_whisper_model_path() -> str:
    explicit = os.getenv("WHISPER_MODEL_PATH")
    if explicit:
        return explicit
    if os.path.isdir(DEFAULT_WHISPER_MODEL_DIR):
        return DEFAULT_WHISPER_MODEL_DIR
    return newest_dir(HF_WHISPER_SNAPSHOTS_DIR) or DEFAULT_WHISPER_MODEL_DIR


WHISPER_MODEL_PATH = resolve_whisper_model_path()

model = None
model_load_error = None

app = FastAPI(title="Whisper Local STT API")
for route in ura_docs_app.router.routes:
    if getattr(route, "path", "") != "/health":
        app.router.routes.append(route)
logger = logging.getLogger("stt-python")


def ensure_audio_runtime():
    if not FFPROBE or not os.path.exists(FFPROBE):
        raise HTTPException(
            status_code=503,
            detail=f"ffprobe not found. FFPROBE_PATH={os.getenv('FFPROBE_PATH')}",
        )
    if not FFMPEG or not os.path.exists(FFMPEG):
        raise HTTPException(
            status_code=503,
            detail=f"ffmpeg not found. FFMPEG_PATH={os.getenv('FFMPEG_PATH')}",
        )


def ensure_upload_dir_writable():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    probe_path = os.path.join(UPLOAD_DIR, f"write-test-{uuid.uuid4().hex}.tmp")
    with open(probe_path, "w", encoding="utf-8") as f:
        f.write("ok")
    try:
        os.remove(probe_path)
    except OSError:
        pass

def is_inside_upload_dir(path: str) -> bool:
    try:
        upload_root = os.path.abspath(UPLOAD_DIR)
        target = os.path.abspath(path)
        return os.path.commonpath([upload_root, target]) == upload_root
    except Exception:
        return False


def is_temp_audio_file(path: str) -> bool:
    if not path or not is_inside_upload_dir(path):
        return False

    ext = os.path.splitext(path)[1].lower()
    return ext in TEMP_AUDIO_EXTENSIONS


def safe_remove_file(path: str) -> bool:
    if not path or not is_temp_audio_file(path):
        return False

    try:
        if os.path.isfile(path):
            os.remove(path)
            return True
    except OSError as err:
        logger.warning("Nao foi possivel remover arquivo temporario %s: %s", path, err)

    return False


def cleanup_old_files(max_age_hours: float | None = None, force: bool = False) -> dict:
    global last_upload_cleanup_at

    now = time.time()
    interval = STT_UPLOAD_CLEANUP_INTERVAL_SECONDS

    if not force and last_upload_cleanup_at and now - last_upload_cleanup_at < interval:
        return {
            "ok": True,
            "skipped": True,
            "reason": "interval",
            "removed": 0,
            "bytes_removed": 0,
            "upload_dir": UPLOAD_DIR,
        }

    last_upload_cleanup_at = now
    max_age = max_age_hours or STT_UPLOAD_MAX_AGE_HOURS
    cutoff = now - (max_age * 3600)

    removed = 0
    bytes_removed = 0
    errors = []

    if not os.path.isdir(UPLOAD_DIR):
        return {
            "ok": True,
            "skipped": False,
            "removed": removed,
            "bytes_removed": bytes_removed,
            "upload_dir": UPLOAD_DIR,
            "max_age_hours": max_age,
        }

    try:
        with os.scandir(UPLOAD_DIR) as entries:
            for entry in entries:
                try:
                    if not entry.is_file():
                        continue

                    path = entry.path
                    if not is_temp_audio_file(path):
                        continue

                    stat = entry.stat()
                    if stat.st_mtime > cutoff:
                        continue

                    os.remove(path)
                    removed += 1
                    bytes_removed += stat.st_size
                except OSError as err:
                    errors.append(str(err))
    except OSError as err:
        errors.append(str(err))

    result = {
        "ok": not errors,
        "skipped": False,
        "removed": removed,
        "bytes_removed": bytes_removed,
        "upload_dir": UPLOAD_DIR,
        "max_age_hours": max_age,
        "errors": errors[:5],
    }

    if removed:
        logger.info(
            "Limpeza de uploads temporarios: %s arquivo(s), %s byte(s).",
            removed,
            bytes_removed,
        )

    if errors:
        logger.warning("Limpeza de uploads temporarios com erro: %s", errors[:5])

    return result


def cleanup_response_files(*paths: str) -> None:
    for path in paths:
        safe_remove_file(path)

    cleanup_old_files(force=False)


@app.on_event("startup")
def startup_cleanup_uploads():
    cleanup_old_files(force=True)

def get_model():
    global model, model_load_error
    if model is not None:
        return model

    if not os.path.isdir(WHISPER_MODEL_PATH):
        model_load_error = f"Whisper model not found at {WHISPER_MODEL_PATH}"
        raise RuntimeError(model_load_error)

    try:
        model = WhisperModel(WHISPER_MODEL_PATH, device="cpu", compute_type="int8")
        model_load_error = None
        return model
    except Exception as err:
        model_load_error = str(err)
        raise


def health_check():
    checks = {
        "edge_tts": {
            "ok": bool(edge_tts),
            "version": getattr(edge_tts, "__version__", None),
        },
         "tts_ssl": {
            "ok": True,
            "verify": TTS_SSL_VERIFY,
            "relax_strict": TTS_SSL_RELAX_STRICT,
        },
        "ffmpeg": {
            "ok": bool(FFMPEG and os.path.exists(FFMPEG)),
            "path": FFMPEG,
        },
        "ffprobe": {
            "ok": bool(FFPROBE and os.path.exists(FFPROBE)),
            "path": FFPROBE,
        },
        "upload_dir": {
            "ok": False,
            "path": UPLOAD_DIR,
        },
        "upload_cleanup": {
            "ok": True,
            "max_age_hours": STT_UPLOAD_MAX_AGE_HOURS,
            "interval_seconds": STT_UPLOAD_CLEANUP_INTERVAL_SECONDS,
            "extensions": sorted(TEMP_AUDIO_EXTENSIONS),
        },
        "whisper_model": {
            "ok": False,
            "path": WHISPER_MODEL_PATH,
            "loaded": model is not None,
            "error": model_load_error,
        },
    }

    try:
        ensure_upload_dir_writable()
        checks["upload_dir"]["ok"] = True
    except Exception as err:
        checks["upload_dir"]["error"] = str(err)

    if checks["whisper_model"]["path"] and os.path.isdir(WHISPER_MODEL_PATH):
        try:
            get_model()
            checks["whisper_model"]["ok"] = True
            checks["whisper_model"]["loaded"] = True
            checks["whisper_model"]["error"] = None
        except Exception as err:
            checks["whisper_model"]["error"] = str(err)
    else:
        checks["whisper_model"]["error"] = (
            f"Whisper model directory missing: {WHISPER_MODEL_PATH}"
        )

    ok = all(item.get("ok") for item in checks.values())
    return {
        "ok": ok,
        "status": "ok" if ok else "error",
        "checks": checks,
        "target_audio": f"U-law, {TARGET_SR}hz, 64kbps, mono",
    }


def save_upload(file: UploadFile) -> str:
    ensure_upload_dir_writable()
    cleanup_old_files(force=False)

    ext = os.path.splitext(file.filename)[1].lower() or ".bin"
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)

    with open(path, "wb") as f:
        f.write(file.file.read())

    return path


def run_ffprobe(path: str) -> dict:
    ensure_audio_runtime()
    cmd = [
        FFPROBE,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,codec_tag_string,sample_rate,channels,bit_rate",
        "-show_entries",
        "format=duration,format_name",
        "-of",
        "json",
        path,
    ]

    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise HTTPException(status_code=400, detail=f"ffprobe failed: {p.stderr[:300]}")
    data = json.loads(p.stdout or "{}")
    streams = data.get("streams") or []
    if not streams:
        raise HTTPException(status_code=400, detail="File has no audio stream.")
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

    if br == 0 and sr > 0 and ch > 0:
        br = sr * 8 * ch

    is_ulaw = codec_name in ("pcm_mulaw", "mulaw") or codec_tag in (
        "ulaw",
        "mulaw",
    )
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
    ensure_audio_runtime()
    cmd = [
        FFMPEG,
        "-hide_banner",
        "-nostats",
        "-i",
        path,
        "-af",
        filter_name,
        "-f",
        "null",
        "-",
    ]
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
        issues.append({"code": "not_wav", "label": "Arquivo nao esta em WAV."})
    if codec != "u-law":
        issues.append({"code": "codec", "label": "Codec diferente de mu-law."})
    if metadata.get("sample_rate_hz") != TARGET_SR:
        issues.append({"code": "sample_rate", "label": "Sample rate diferente de 8000 Hz."})
    if metadata.get("channels") != TARGET_CH:
        issues.append({"code": "channels", "label": "Audio nao esta em mono."})
    kbps = metadata.get("bit_rate_kbps") or 0
    if kbps and not (56 <= kbps <= 72):
        issues.append({"code": "bitrate", "label": "Bitrate fora do esperado (~64 kbps)."})
    if (silence.get("initial_sec") or 0) >= 0.5:
        issues.append({"code": "initial_silence", "label": "Silencio inicial acima de 0.5s."})
    if (silence.get("final_sec") or 0) >= 0.5:
        issues.append({"code": "final_silence", "label": "Silencio final acima de 0.5s."})
    if volume.get("mean_db") is not None and volume["mean_db"] < -30:
        issues.append({"code": "low_volume", "label": "Volume medio baixo."})
    if volume.get("peak_db") is not None and volume["peak_db"] > -1:
        issues.append({"code": "peak_volume", "label": "Pico de volume muito alto."})
    if volume.get("mean_db") is not None and volume["mean_db"] > -12:
        issues.append({"code": "high_volume", "label": "Volume medio alto."})

    return {
        "file": {"name": original_name, "size_bytes": os.path.getsize(path)},
        "metadata": metadata,
        "volume": volume,
        "silence": silence,
        "matches_target": metadata["matches_target"] and not issues,
        "issues": issues,
        "recommendations": ["Converter para WAV mu-law 8k mono."] if issues else [],
    }


@app.get("/health")
def health():
    result = health_check()
    return JSONResponse(result, status_code=200 if result["ok"] else 503)


@app.post("/analyze")
def analyze_audio(file: UploadFile = File(...)):
    path = save_upload(file)

    try:
        return analyze_audio_file(path, file.filename)
    finally:
        safe_remove_file(path)


@app.post("/transcribe")
def transcribe_audio(file: UploadFile = File(...)):
    path = save_upload(file)

    try:
        audio = audio_attributes(path)

        loaded_model = get_model()
        segments, info = loaded_model.transcribe(path, vad_filter=True)
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
                "summary": audio["summary"],
                "matches_target": audio["matches_target"],
                "target": audio["target"],
            },
        }
    finally:
        safe_remove_file(path)


@app.post("/convert")
def convert_audio(file: UploadFile = File(...)):
    ensure_audio_runtime()
    in_path = save_upload(file)

    out_name = f"{uuid.uuid4().hex}.wav"
    out_path = os.path.join(UPLOAD_DIR, out_name)

    try:
        cmd = [
            FFMPEG,
            "-y",
            "-i",
            in_path,
            "-ac",
            str(TARGET_CH),
            "-ar",
            str(TARGET_SR),
            "-c:a",
            TARGET_CODEC,
            out_path,
        ]
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode != 0:
            raise HTTPException(
                status_code=400,
                detail=f"ffmpeg failed: {p.stderr[-500:]}",
            )

        conv = audio_attributes(out_path)

        return FileResponse(
            out_path,
            media_type="audio/wav",
            filename=out_name,
            headers={
                "X-Audio-Summary": conv["summary"],
                "X-Audio-Matches-Target": str(conv["matches_target"]).lower(),
            },
            background=BackgroundTask(cleanup_response_files, in_path, out_path),
        )
    except Exception:
        cleanup_response_files(in_path, out_path)
        raise


class TTSRequest(BaseModel):
    text: str
    voice: str = "pt-BR-FranciscaNeural"
    rate: Union[str, int, float] = "+0%"
    volume: Union[str, int, float] = "+0%"

    @field_validator("rate", "volume", mode="before")
    @classmethod
    def normalize_pct(cls, v):
        if isinstance(v, (int, float)):
            v = int(round(v))
            sign = "+" if v >= 0 else ""
            return f"{sign}{v}%"
        if isinstance(v, str):
            s = v.strip()
            if s == "":
                return "+0%"
            if s.lstrip("+-").replace(".", "", 1).isdigit() and not s.endswith("%"):
                number = int(round(float(s)))
                sign = "+" if number >= 0 else ""
                return f"{sign}{number}%"
            if s.endswith("%"):
                raw = s[:-1]
                if raw.lstrip("+-").replace(".", "", 1).isdigit():
                    number = int(round(float(raw)))
                    sign = "+" if number >= 0 else ""
                    return f"{sign}{number}%"
            return s
        return "+0%"


def is_tls_or_network_error(err: Exception) -> bool:
    msg = str(err).lower()
    return (
        "certificate_verify_failed" in msg
        or "self-signed certificate" in msg
        or "cannot connect to host" in msg
        or "speech.platform.bing.com" in msg
        or "ssl" in msg
        or "cert" in msg
    )


async def save_edge_tts(text: str, path: str, req: TTSRequest):
    try:
        communicate = edge_tts.Communicate(
            text,
            voice=req.voice,
            rate=req.rate,
            volume=req.volume,
        )
        await communicate.save(path)

    except ValueError as err:
        if is_tls_or_network_error(err):
            raise HTTPException(
                status_code=503,
                detail=(
                    "Falha SSL/rede ao conectar no Microsoft TTS "
                    "speech.platform.bing.com:443. "
                    "No ambiente corporativo, a aplicação está usando "
                    "TTS_SSL_VERIFY=false para contornar inspeção SSL/proxy. "
                    f"Detalhe técnico: {err}"
                ),
            ) from err

        raise HTTPException(
            status_code=400,
            detail=f"Parametros TTS invalidos: {err}",
        ) from err

    except Exception as err:
        logger.exception("Falha ao gerar TTS via edge-tts")
        raise HTTPException(
            status_code=502,
            detail=f"edge-tts failed: {err}",
        ) from err


@app.post("/tts")
async def tts(req: TTSRequest):
    cleanup_old_files(force=False)

    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Campo 'text' vazio.")

    out_mp3 = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.mp3")

    try:
        await save_edge_tts(text, out_mp3, req)
    except Exception:
        safe_remove_file(out_mp3)
        raise

    return FileResponse(
        out_mp3,
        media_type="audio/mpeg",
        filename=os.path.basename(out_mp3),
        background=BackgroundTask(cleanup_response_files, out_mp3),
    )

@app.post("/tts_ulaw")
async def tts_ulaw(req: TTSRequest):
    ensure_audio_runtime()
    cleanup_old_files(force=False)

    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Campo 'text' vazio.")

    tmp_mp3 = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.mp3")
    out_wav = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.wav")

    try:
        await save_edge_tts(text, tmp_mp3, req)

        cmd = [
            FFMPEG,
            "-y",
            "-i",
            tmp_mp3,
            "-ac",
            str(TARGET_CH),
            "-ar",
            str(TARGET_SR),
            "-c:a",
            TARGET_CODEC,
            out_wav,
        ]
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode != 0:
            raise HTTPException(
                status_code=400,
                detail=f"ffmpeg failed: {p.stderr[-500:]}",
            )

        return FileResponse(
            out_wav,
            media_type="audio/wav",
            filename=os.path.basename(out_wav),
            background=BackgroundTask(cleanup_response_files, tmp_mp3, out_wav),
        )
    except Exception:
        cleanup_response_files(tmp_mp3, out_wav)
        raise
