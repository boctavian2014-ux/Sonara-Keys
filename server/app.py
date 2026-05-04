"""
Local transcription API: WAV in -> Basic Pitch -> DetectedNote[] JSON.
Same contract as the previous Node proxy: POST /transcribe, GET /health.
"""
from __future__ import annotations

import base64
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, List, Optional

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_loaded_model: Any = None


def get_model():
    global _loaded_model
    if _loaded_model is None:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import Model

        _loaded_model = Model(ICASSP_2022_MODEL_PATH)
    return _loaded_model


def midi_to_name_octave(midi: int) -> tuple[str, int]:
    midi = max(0, min(127, int(round(midi))))
    return NOTE_NAMES[midi % 12], (midi // 12) - 1


def note_events_to_json(note_events: List[tuple]) -> List[dict[str, Any]]:
    notes: List[dict[str, Any]] = []
    for i, ev in enumerate(note_events):
        if len(ev) == 5:
            start_s, end_s, pitch_midi, _amp, _bends = ev
        elif len(ev) == 4:
            start_s, end_s, pitch_midi, _amp = ev
        else:
            continue
        name, octave = midi_to_name_octave(pitch_midi)
        notes.append(
            {
                "id": f"bp-{i}-{start_s:.4f}",
                "name": name,
                "octave": octave,
                "startTime": float(start_s),
                "endTime": float(end_s),
                "midi": int(round(pitch_midi)),
            }
        )
    notes.sort(key=lambda n: n["startTime"])
    return notes


def _env_float(name: str) -> Optional[float]:
    v = os.environ.get(name)
    if v is None or not str(v).strip():
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _predict_wav_path(wav_path: Path) -> List[dict[str, Any]]:
    from basic_pitch.inference import predict

    onset = _env_float("BP_ONSET_THRESHOLD")
    frame = _env_float("BP_FRAME_THRESHOLD")
    min_note_ms = _env_float("BP_MINIMUM_NOTE_LENGTH_MS")
    min_freq = _env_float("BP_MINIMUM_FREQUENCY")
    max_freq = _env_float("BP_MAXIMUM_FREQUENCY")

    kwargs: dict[str, Any] = {
        "audio_path": wav_path,
        "model_or_model_path": get_model(),
    }
    if onset is not None:
        kwargs["onset_threshold"] = onset
    if frame is not None:
        kwargs["frame_threshold"] = frame
    if min_note_ms is not None:
        kwargs["minimum_note_length"] = min_note_ms
    if min_freq is not None:
        kwargs["minimum_frequency"] = min_freq
    if max_freq is not None:
        kwargs["maximum_frequency"] = max_freq

    _model_out, _midi_data, note_events = predict(**kwargs)
    return note_events_to_json(note_events)


app = FastAPI(title="Sonara Keys — local Basic Pitch")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranscribeJsonBody(BaseModel):
    wavBase64: Optional[str] = None
    audioUrl: Optional[str] = None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/transcribe")
async def transcribe(request: Request):
    wav_bytes: Optional[bytes] = None
    content_type = (request.headers.get("content-type") or "").lower()

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            f = form.get("audio")
            if f is None or not isinstance(f, UploadFile):
                f = form.get("file")
            if f is None or not isinstance(f, UploadFile):
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "error": 'Expected multipart form field "audio" or "file" (WAV file)',
                    },
                )
            wav_bytes = await f.read()
        else:
            body = TranscribeJsonBody.model_validate(await request.json())
            if body.audioUrl and str(body.audioUrl).strip():
                url = str(body.audioUrl).strip()
                if not url.lower().startswith("https://"):
                    return JSONResponse(
                        status_code=400,
                        content={"ok": False, "error": "audioUrl must be an https:// URL"},
                    )
                with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310
                    wav_bytes = resp.read()
            elif body.wavBase64:
                wav_bytes = base64.b64decode(body.wavBase64)
            else:
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "error": 'Expected JSON { "wavBase64" } or { "audioUrl" } or multipart "audio"/"file"',
                    },
                )

        if not wav_bytes or len(wav_bytes) < 44:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": "WAV payload too small or empty"},
            )

        suffix = ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(wav_bytes)
            tmp_path = Path(tmp.name)

        try:
            notes = _predict_wav_path(tmp_path)
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

        return {"ok": True, "notes": notes, "engine": "basic-pitch-python"}
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": str(e)},
        )


# Allow `python app.py` for quick run
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8787"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
