# GPU Piano Transcription Server (Streaming)

This service provides **piano-specialized polyphonic transcription** intended for **live** use with ~0.5–1s latency.

## Endpoints

- `GET /` → short JSON (so the base URL in a browser is not an empty 404)
- `GET /health` → `{ ok: true }`
- `POST /warmup` → loads the model into GPU RAM (same auth rules as `/transcribe-window` when `PIANO_GPU_API_KEY` is set). Call once after the pod starts if you did **not** set `PTI_WARMUP_STARTUP=1`.
- `POST /transcribe-window`
  - JSON body:
    - `wavBase64`: base64-encoded mono WAV (16-bit PCM recommended)
    - `sampleRate`: number (e.g. 44100 or 48000)
    - `windowStartSec`: number (absolute start time of the window in the full session timeline)
    - `sessionId`: string (client-chosen)
  - Response:
    - `{ ok: true, notes: DetectedNote[], engine: "piano_transcription_inference" }`

`DetectedNote` matches the app contract:

```json
{ "id": "x", "name": "C#", "octave": 4, "midi": 61, "startTime": 1.23, "endTime": 1.56 }
```

## Local run (GPU)

```bash
cd server-gpu
python -m venv .venv
source .venv/bin/activate   # Linux/Mac
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8789 --timeout-keep-alive 180
```

### RunPod / proxy **502**

Typical causes: pod sleeping, `uvicorn` not running, **cold first request** (model load + inference exceeds proxy timeout), or payload too large.

Mitigations:

1. **`PTI_WARMUP_STARTUP=1`** in the pod environment, then restart Uvicorn — loads `PianoTranscription` at startup so the first `/transcribe-window` is faster.
2. Or after each deploy: `curl -X POST https://…/warmup` (add `X-Sonara-Api-Key` if you use one).
3. In the Expo app, use **smaller** `EXPO_PUBLIC_PIANO_GPU_WINDOW_SEC` / hop (defaults were reduced in the client; see root `.env.example`).
4. Keep **`--timeout-keep-alive 180`** on Uvicorn (already in the `Dockerfile` `CMD`).

## Deploy

Use the provided `Dockerfile` (CUDA + PyTorch). This is designed for GPU-capable platforms (not Railway).

## API key (recommended for public URLs)

On the server, set environment variable `PIANO_GPU_API_KEY` to a long random string, then restart Uvicorn.  
`POST /transcribe-window` then requires header `X-Sonara-Api-Key` with the same value.  
`GET /health` stays open (no key).

If `PIANO_GPU_API_KEY` is unset, the server accepts requests without a key (local dev only).

## App configuration

Set this in the Expo app `.env`:

```env
EXPO_PUBLIC_PIANO_GPU_API_URL=https://<your-gpu-service-domain>
EXPO_PUBLIC_PIANO_GPU_STREAMING=1
# Smaller window = smaller WAV per request (fewer 502s on slow proxies)
# EXPO_PUBLIC_PIANO_GPU_WINDOW_SEC=0.6
# EXPO_PUBLIC_PIANO_GPU_HOP_SEC=0.3
# EXPO_PUBLIC_PIANO_GPU_FETCH_TIMEOUT_MS=180000
# Must match server PIANO_GPU_API_KEY when the server enforces it (bundled into the client — not a true secret)
EXPO_PUBLIC_PIANO_GPU_API_KEY=<same-as-server>
```

