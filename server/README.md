# Local Basic Pitch transcribe server

Python + [Spotify Basic Pitch](https://github.com/spotify/basic-pitch). No RunComfy, no cloud API keys.

## Setup

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

TensorFlow is pulled in by `basic-pitch`; first install can take a few minutes.

## Run

```bash
python app.py
```

Default: `http://0.0.0.0:8787`. Override port:

```bash
set PORT=9000
python app.py
```

## Endpoints

- `GET /health` → `{ "ok": true }`
- `POST /transcribe` with JSON `{ "wavBase64": "..." }` (same as the Expo app), or multipart field `audio` (WAV), or JSON `{ "audioUrl": "https://..." }`.

Response: `{ "ok": true, "notes": [ ... ], "engine": "basic-pitch-python" }`.

Optional tuning via environment variables — see `.env.example`.
