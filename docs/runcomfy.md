# RunComfy: track → MIDI + this app

> **Pentru transcriere gratuită pe PC-ul tău**, folosește în schimb serverul local Basic Pitch: vezi [`local-basic-pitch.md`](local-basic-pitch.md). Secțiunile de mai jos rămân doar dacă vrei în continuare RunComfy (plată).

End-to-end flow: **Expo app** → **small HTTPS backend** (holds secrets) → **RunComfy Serverless v2** → optional **MIDI → `DetectedNote[]`** → app staff.

## 1. ComfyUI workflow (RunComfy)

1. Launch ComfyUI on RunComfy and build **audio → MIDI** (custom nodes are fine if they are included in **Cloud Save**).
2. **Queue Prompt** with a short WAV; confirm `.mid` (or equivalent) in outputs.
3. **Workflow → Export (API)** → save as [`workflows/track-to-midi-api.json`](../workflows/track-to-midi-api.json).
4. **Cloud Save** the workflow, then **Deploy workflow as API**.
5. Copy **`deployment_id`** and create an **API token** (Bearer). Store them only on the server (see below).

## 2. Async queue API (v2)

Base host: `https://api.runcomfy.net`

| Step | Method | Path |
|------|--------|------|
| Submit | `POST` | `/prod/v2/deployments/{deployment_id}/inference` |
| Poll | `GET` | `/prod/v2/deployments/{deployment_id}/requests/{request_id}/status` |
| Result | `GET` | `/prod/v2/deployments/{deployment_id}/requests/{request_id}/result` |

- **Authorization:** `Bearer <token>` on every call.
- **Submit body (typical):** `{ "overrides": { "<nodeId>": { "inputs": { "<key>": "<value>" } } } }`
- **Audio input:** public **HTTPS URL** to raw WAV/MP3, or **`data:audio/wav;base64,...`** (same pattern as images in [RunComfy docs](https://docs.runcomfy.com/serverless/async-queue-endpoints)).
- **Poll:** `status` moves `in_queue` → `in_progress` → **`completed`**. Then **GET** `result_url` (or construct the result path with `request_id`).
- **Result:** JSON with `status: "succeeded"` and **`outputs`**: node id → arrays of objects with **`url`** (hosted files, short TTL). Your MIDI file usually appears as a `.mid` URL inside one of those structures.

## 3. Map overrides to your exported JSON

1. Open `track-to-midi-api.json`.
2. Find the node that loads or receives **audio** (e.g. Load Audio URL). Note its top-level key → that is **`RUNCOMFY_AUDIO_NODE_ID`**.
3. Under that node’s `"inputs"`, find the field your graph uses for the file (`audio`, `url`, `file`, etc.) → **`RUNCOMFY_AUDIO_INPUT_KEY`** on the server.
4. Optional: other tunables (BPM, thresholds) → add to **`RUNCOMFY_EXTRA_OVERRIDES`** (JSON string) on the server.

See also [`workflows/example-overrides.json`](../workflows/example-overrides.json).

## 4. Backend în repo (`server/`)

Folderul [`server/`](../server/) găzduiește acum serverul **Python Basic Pitch** (gratis, local). Vezi [`local-basic-pitch.md`](local-basic-pitch.md) pentru instalare și `POST /transcribe`.

Dacă vrei în continuare **RunComfy**, trebuie un proxy separat care implementează pașii din secțiunile 2–3 (nu mai este inclus în acest repo).

## 5. Expo app

Set **`EXPO_PUBLIC_TRANSCRIBE_API_URL`** la URL-ul serverului tău (local sau alt host), fără slash final, ex. `http://192.168.1.50:8787`.

- Dacă e setat, după stop app-ul **încearcă backend-ul**; dacă nu primește note sau primește eroare, **revine** la transcrierea locală YIN.
- **Nu** pune token RunComfy în client; tokenul rămâne doar pe serverul care apelează RunComfy (dacă îl refaci separat).

## 6. Cost / UX

- Inference is **async**; expect multi-second latency. The app shows processing state without per-node progress unless you extend the proxy.
- Outputs on RunComfy are **temporary** (~7 days); the proxy downloads MIDI immediately when possible.
