from __future__ import annotations

import base64
import io
import os
import secrets
import time
from typing import Annotated, Any, Dict, List

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_to_name_octave(midi: int) -> tuple[str, int]:
    midi = max(0, min(127, int(round(midi))))
    return NOTE_NAMES[midi % 12], (midi // 12) - 1


def load_transcriptor():
    # Lazy import so the container boots fast and we can surface import errors cleanly.
    from piano_transcription_inference import PianoTranscription

    device = os.environ.get("PTI_DEVICE", "").strip() or ("cuda" if os.environ.get("CUDA_VISIBLE_DEVICES") else "cpu")
    return PianoTranscription(device=device)


_transcriptor = None


def get_transcriptor():
    global _transcriptor
    if _transcriptor is None:
        _transcriptor = load_transcriptor()
    return _transcriptor


class TranscribeWindowBody(BaseModel):
    sessionId: str
    wavBase64: str
    sampleRate: int
    windowStartSec: float


def _require_gpu_api_key(
    x_sonara_api_key: Annotated[str | None, Header(alias="X-Sonara-Api-Key")] = None,
) -> None:
    """If PIANO_GPU_API_KEY is set, require matching X-Sonara-Api-Key header."""
    expected = os.environ.get("PIANO_GPU_API_KEY", "").strip()
    if not expected:
        return
    if x_sonara_api_key is None:
        raise HTTPException(status_code=401, detail="Missing API key.")
    try:
        ok = secrets.compare_digest(x_sonara_api_key, expected)
    except (TypeError, ValueError):
        ok = False
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid API key.")


app = FastAPI(title="Sonara Keys — GPU piano transcription")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    """So opening the base URL in a browser is not a bare 404."""
    return {
        "ok": True,
        "service": "sonara-keys-gpu",
        "health": "/health",
        "transcribe_window": "POST /transcribe-window",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"ok": True, "engine": "piano_transcription_inference"}


def decode_wav_base64(wav_b64: str) -> tuple[np.ndarray, int]:
    raw = base64.b64decode(wav_b64)
    data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = np.mean(data, axis=1)
    return data, int(sr)


@app.post("/transcribe-window")
def transcribe_window(
    body: TranscribeWindowBody,
    _: Annotated[None, Depends(_require_gpu_api_key)],
):
    t0 = time.time()
    audio, sr = decode_wav_base64(body.wavBase64)

    # The library expects (samples,) float32 and will internally resample if needed.
    transcriptor = get_transcriptor()

    # transcribe() signature differs across forks; we handle common return shapes.
    result: Any = transcriptor.transcribe(audio, None)  # type: ignore[arg-type]

    # Expect dict with 'est_note_events' or similar
    note_events = None
    if isinstance(result, dict):
        note_events = result.get("est_note_events") or result.get("note_events")
    if note_events is None:
        # fallback: empty
        note_events = []

    notes: List[Dict[str, Any]] = []
    for i, ev in enumerate(note_events):
        # common keys: onset_time, offset_time, midi_note, velocity
        try:
            onset = float(ev.get("onset_time", ev.get("start_time", 0.0)))
            offset = float(ev.get("offset_time", ev.get("end_time", onset)))
            midi = int(round(float(ev.get("midi_note", ev.get("pitch_midi", 0)))))
        except Exception:
            continue
        name, octave = midi_to_name_octave(midi)
        notes.append(
            {
                "id": f"pti-{body.sessionId}-{i}-{(body.windowStartSec + onset):.4f}",
                "name": name,
                "octave": octave,
                "midi": midi,
                "startTime": float(body.windowStartSec + onset),
                "endTime": float(body.windowStartSec + offset),
            }
        )

    notes.sort(key=lambda n: n["startTime"])
    dt_ms = int((time.time() - t0) * 1000)

    stitched = stitch_session_notes(body.sessionId, notes)
    return {
        "ok": True,
        "notes": stitched,
        "engine": "piano_transcription_inference",
        "ms": dt_ms,
        "sr": sr,
    }


# --- Simple streaming stitching (server-side) ---
# Keeps a small rolling memory per session and removes duplicates across overlapping windows.

_session_notes: Dict[str, List[Dict[str, Any]]] = {}
_session_last_seen: Dict[str, float] = {}

# Tunables (seconds)
_DEDUP_ONSET_EPS = float(os.environ.get("PTI_DEDUP_ONSET_EPS", "0.06"))  # 60ms
_DEDUP_OFFSET_EPS = float(os.environ.get("PTI_DEDUP_OFFSET_EPS", "0.12"))  # 120ms
_SESSION_TTL_SEC = float(os.environ.get("PTI_SESSION_TTL_SEC", "45"))
_MAX_SESSION_NOTES = int(os.environ.get("PTI_MAX_SESSION_NOTES", "4000"))


def _cleanup_sessions(now: float) -> None:
    dead = [sid for sid, t in _session_last_seen.items() if (now - t) > _SESSION_TTL_SEC]
    for sid in dead:
        _session_last_seen.pop(sid, None)
        _session_notes.pop(sid, None)


def _is_dup(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return (
        int(a.get("midi", -1)) == int(b.get("midi", -2))
        and abs(float(a.get("startTime", 0.0)) - float(b.get("startTime", 0.0))) <= _DEDUP_ONSET_EPS
        and abs(float(a.get("endTime", 0.0)) - float(b.get("endTime", 0.0))) <= _DEDUP_OFFSET_EPS
    )


def stitch_session_notes(session_id: str, incoming: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    now = time.time()
    _cleanup_sessions(now)
    _session_last_seen[session_id] = now

    existing = _session_notes.get(session_id, [])
    if not existing:
        _session_notes[session_id] = incoming[-_MAX_SESSION_NOTES :]
        return incoming

    merged: List[Dict[str, Any]] = existing[:]
    for n in incoming:
        if any(_is_dup(n, e) for e in merged[-256:]):  # check recent tail only
            continue
        merged.append(n)

    merged.sort(key=lambda n: float(n.get("startTime", 0.0)))
    if len(merged) > _MAX_SESSION_NOTES:
        merged = merged[-_MAX_SESSION_NOTES :]
    _session_notes[session_id] = merged

    # Return only newest slice near the end to reduce payload size
    return merged[-800:]

