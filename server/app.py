"""
Local transcription API: WAV in -> Basic Pitch -> DetectedNote[] JSON.
Same contract as the previous Node proxy: POST /transcribe, GET /health.
"""
from __future__ import annotations

import base64
import hashlib
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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


class DetectedNoteModel(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    octave: Optional[int] = None
    startTime: float
    endTime: float
    midi: int


class TimeSignatureModel(BaseModel):
    beatsPerBar: int
    beatUnit: int


class KeySignatureAccidentalsModel(BaseModel):
    kind: str  # 'sharp' | 'flat'
    count: int


class KeySignatureModel(BaseModel):
    tonic: str
    mode: str  # 'major' | 'minor'
    accidentals: KeySignatureAccidentalsModel


class MeasureMetaModel(BaseModel):
    index: int
    startBeats: float
    endBeats: float


class QuantizedNoteModel(DetectedNoteModel):
    hand: str  # 'RH' | 'LH'
    qOnsetBeats: float
    qDurBeats: float
    value: str
    measureIndex: int
    beatInMeasure: float
    onsetGroupId: str


class ScoreAnalysisModel(BaseModel):
    tempoBpm: Optional[float] = None
    timeSignature: TimeSignatureModel
    keySignature: KeySignatureModel
    measures: List[MeasureMetaModel]
    notes: List[QuantizedNoteModel]
    chords: List[Dict[str, Any]] = []


class RenderScoreBody(BaseModel):
    analysis: Optional[ScoreAnalysisModel] = None
    # Fallback: raw DetectedNote[] (server can do a basic quantize later; for now, prefer analysis)
    notes: Optional[List[DetectedNoteModel]] = None


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


_svg_cache: Dict[str, str] = {}
_svg_cache_order: List[str] = []
_SVG_CACHE_MAX = 32


def _cache_get(key: str) -> Optional[str]:
    v = _svg_cache.get(key)
    if v is None:
        return None
    try:
        _svg_cache_order.remove(key)
    except ValueError:
        pass
    _svg_cache_order.append(key)
    return v


def _cache_put(key: str, svg: str) -> None:
    _svg_cache[key] = svg
    try:
        _svg_cache_order.remove(key)
    except ValueError:
        pass
    _svg_cache_order.append(key)
    while len(_svg_cache_order) > _SVG_CACHE_MAX:
        old = _svg_cache_order.pop(0)
        _svg_cache.pop(old, None)


def _find_musescore_exe() -> Optional[str]:
    env = os.environ.get("MUSESCORE_PATH")
    if env and str(env).strip():
        p = str(env).strip()
        if Path(p).exists():
            return p

    for name in ["musescore", "mscore", "MuseScore4.exe", "MuseScore3.exe"]:
        p = shutil.which(name)
        if p:
            return p

    # Common Windows install paths
    candidates = [
        r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe",
        r"C:\Program Files (x86)\MuseScore 4\bin\MuseScore4.exe",
        r"C:\Program Files\MuseScore 3\bin\MuseScore3.exe",
        r"C:\Program Files (x86)\MuseScore 3\bin\MuseScore3.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


def _musicxml_pitch(midi: int) -> Tuple[str, int, int]:
    # step, alter, octave (MusicXML)
    midi = max(0, min(127, int(round(midi))))
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    name = names[midi % 12]
    octave = (midi // 12) - 1
    step = name[0]
    alter = 1 if "#" in name else 0
    return step, alter, octave


def _note_type_and_dots(value: str) -> Tuple[str, int]:
    # Map app NoteValue to MusicXML type+dots
    if value == "whole":
        return "whole", 0
    if value == "half":
        return "half", 0
    if value == "half_dotted":
        return "half", 1
    if value == "quarter":
        return "quarter", 0
    if value == "quarter_dotted":
        return "quarter", 1
    if value == "eighth":
        return "eighth", 0
    if value == "eighth_dotted":
        return "eighth", 1
    if value == "sixteenth":
        return "16th", 0
    return "32nd", 0


def _musicxml_from_analysis(analysis: ScoreAnalysisModel) -> str:
    # We use divisions=8 so 1 beat (quarter) = 8 divisions, and the analysis grid 0.125 beat = 1 division.
    divisions = 8
    ts = analysis.timeSignature
    bar_len_beats = ts.beatsPerBar * (0.5 if int(ts.beatUnit) == 8 else 1.0)
    beats_per_measure_div = int(round(bar_len_beats * divisions))
    measure_count = max(1, len(analysis.measures))

    # key signature fifths: sharps positive, flats negative
    acc = analysis.keySignature.accidentals
    fifths = int(acc.count) if acc.kind == "sharp" else -int(acc.count)

    # Build per-staff onset groups within measures: staff 1=RH, staff 2=LH
    per_measure_staff: List[Dict[int, Dict[float, List[QuantizedNoteModel]]]] = []
    for _ in range(measure_count):
        per_measure_staff.append({1: {}, 2: {}})

    for n in analysis.notes:
        mi = max(0, min(measure_count - 1, int(n.measureIndex)))
        staff = 1 if n.hand == "RH" else 2
        onset_in_measure = float(n.beatInMeasure)
        d = per_measure_staff[mi][staff]
        arr = d.get(onset_in_measure)
        if arr:
            arr.append(n)
        else:
            d[onset_in_measure] = [n]

    def emit_staff_voice(measure_idx: int, staff: int) -> str:
        groups = per_measure_staff[measure_idx][staff]
        onsets = sorted(groups.keys())
        cur_div = 0
        out: List[str] = []
        voice = "1" if staff == 1 else "5"

        def emit_rest(dur_div: int) -> None:
            if dur_div <= 0:
                return
            out.append(
                f"<note><rest/><duration>{dur_div}</duration><voice>{voice}</voice><staff>{staff}</staff></note>"
            )

        for onset_beats in onsets:
            onset_div = int(round(onset_beats * divisions))
            gap = onset_div - cur_div
            if gap > 0:
                emit_rest(gap)
                cur_div += gap

            ns = groups[onset_beats]
            # MusicXML chord: first note normal, subsequent have <chord/>
            ns_sorted = sorted(ns, key=lambda x: int(x.midi))
            for i, qn in enumerate(ns_sorted):
                dur_div = max(1, int(round(float(qn.qDurBeats) * divisions)))
                step, alter, octv = _musicxml_pitch(int(qn.midi))
                typ, dots = _note_type_and_dots(str(qn.value))
                chord = "<chord/>" if i > 0 else ""
                alter_xml = f"<alter>{alter}</alter>" if alter != 0 else ""
                dots_xml = "<dot/>" * dots
                out.append(
                    "<note>"
                    f"{chord}"
                    "<pitch>"
                    f"<step>{step}</step>"
                    f"{alter_xml}"
                    f"<octave>{octv}</octave>"
                    "</pitch>"
                    f"<duration>{dur_div}</duration>"
                    f"<voice>{voice}</voice>"
                    f"<type>{typ}</type>"
                    f"{dots_xml}"
                    f"<staff>{staff}</staff>"
                    "</note>"
                )
            # Advance time by max duration of the onset group in this voice
            max_dur = max(1, max(int(round(float(qn.qDurBeats) * divisions)) for qn in ns_sorted))
            cur_div += max_dur

        # Fill to end of measure
        if cur_div < beats_per_measure_div:
            emit_rest(beats_per_measure_div - cur_div)

        return "".join(out)

    tempo = analysis.tempoBpm or 120.0
    # MusicXML header
    parts: List[str] = []
    parts.append('<?xml version="1.0" encoding="UTF-8"?>')
    parts.append('<score-partwise version="3.1">')
    parts.append("<part-list>")
    parts.append('<score-part id="P1"><part-name>Piano</part-name></score-part>')
    parts.append("</part-list>")
    parts.append('<part id="P1">')

    for mi in range(measure_count):
        attrs = ""
        if mi == 0:
            attrs = (
                "<attributes>"
                f"<divisions>{divisions}</divisions>"
                f"<key><fifths>{fifths}</fifths></key>"
                f"<time><beats>{int(ts.beatsPerBar)}</beats><beat-type>{int(ts.beatUnit)}</beat-type></time>"
                "<staves>2</staves>"
                '<clef number="1"><sign>G</sign><line>2</line></clef>'
                '<clef number="2"><sign>F</sign><line>4</line></clef>'
                "</attributes>"
            )
        # A minimal metronome mark on first measure
        direction = ""
        if mi == 0:
            direction = (
                "<direction placement=\"above\">"
                "<direction-type>"
                "<metronome>"
                "<beat-unit>quarter</beat-unit>"
                f"<per-minute>{int(round(float(tempo)))}</per-minute>"
                "</metronome>"
                "</direction-type>"
                f"<sound tempo=\"{float(tempo):.2f}\"/>"
                "</direction>"
            )

        m_xml = [f'<measure number="{mi + 1}">', attrs, direction]
        # Staff 1 then staff 2 notes
        m_xml.append(emit_staff_voice(mi, 1))
        m_xml.append(emit_staff_voice(mi, 2))
        m_xml.append("</measure>")
        parts.append("".join(m_xml))

    parts.append("</part>")
    parts.append("</score-partwise>")
    return "".join(parts)


@app.post("/render-score-svg")
async def render_score_svg(body: RenderScoreBody):
    try:
        if body.analysis is None:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": 'Expected JSON body { "analysis": ScoreAnalysis }'},
            )

        payload_key = hashlib.sha256(body.model_dump_json().encode("utf-8")).hexdigest()
        cached = _cache_get(payload_key)
        if cached is not None:
            return {"ok": True, "svg": cached, "cached": True}

        musescore = _find_musescore_exe()
        if not musescore:
            return JSONResponse(
                status_code=500,
                content={
                    "ok": False,
                    "error": "MuseScore CLI not found. Install MuseScore and set MUSESCORE_PATH to the executable.",
                },
            )

        musicxml = _musicxml_from_analysis(body.analysis)

        with tempfile.TemporaryDirectory(prefix="sonara-score-") as td:
            td_path = Path(td)
            in_path = td_path / "score.musicxml"
            out_path = td_path / "score.svg"
            in_path.write_text(musicxml, encoding="utf-8")

            # MuseScore typically outputs score-1.svg, but we provide a target prefix anyway.
            # Using a timeout to avoid hanging processes in production.
            proc = subprocess.run(
                [musescore, str(in_path), "-o", str(out_path)],
                capture_output=True,
                text=True,
                timeout=25,
            )
            if proc.returncode != 0:
                err = (proc.stderr or proc.stdout or "").strip()
                return JSONResponse(
                    status_code=500,
                    content={"ok": False, "error": f"MuseScore export failed (code {proc.returncode}). {err[:1200]}"},
                )

            svgs = sorted(td_path.glob("score*.svg"))
            if not svgs:
                return JSONResponse(
                    status_code=500,
                    content={"ok": False, "error": "MuseScore did not produce any SVG output."},
                )

            svg = svgs[0].read_text(encoding="utf-8")
            _cache_put(payload_key, svg)
            return {"ok": True, "svg": svg, "cached": False}
    except subprocess.TimeoutExpired:
        return JSONResponse(
            status_code=504,
            content={"ok": False, "error": "MuseScore export timed out."},
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})

# Allow `python app.py` for quick run
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8787"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
