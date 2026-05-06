# GPU Piano Transcription Server (Streaming)

This service provides **piano-specialized polyphonic transcription** intended for **live** use with ~0.5–1s latency.

## Endpoints

- `GET /health` → `{ ok: true }`
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
uvicorn app:app --host 0.0.0.0 --port 8789
```

## Deploy

Use the provided `Dockerfile` (CUDA + PyTorch). This is designed for GPU-capable platforms (not Railway).

## App configuration

Set this in the Expo app `.env`:

```env
EXPO_PUBLIC_PIANO_GPU_API_URL=https://<your-gpu-service-domain>
EXPO_PUBLIC_PIANO_GPU_STREAMING=1
```

