# Track → MIDI (RunComfy / ComfyUI)

This folder holds the **API workflow export** used by your RunComfy deployment and the **override template** your backend sends at inference time.

## `track-to-midi-api.json` (you generate this)

1. In **RunComfy** ComfyUI, build a graph that loads audio (URL or path) and produces a **MIDI** file (or a node whose API output exposes hosted file URLs).
2. Run **Queue Prompt** once with a short WAV and confirm MIDI appears in the output.
3. In ComfyUI: **Workflow → Export (API)** (not the UI-only workflow JSON).
4. Save the file here as **`track-to-midi-api.json`**.

Node IDs in that file (e.g. `"12"`, `"45"`) are what you reference in **`overrides`** when calling RunComfy. They must match your deployment’s saved workflow.

## `example-overrides.json`

Shape-only example. Replace node IDs and input keys with those from **your** `track-to-midi-api.json` (see [`docs/runcomfy.md`](../docs/runcomfy.md)).

## Related code

- Local transcribe server (Basic Pitch): [`../server/`](../server/) — vezi [`../docs/local-basic-pitch.md`](../docs/local-basic-pitch.md)
- App env: `EXPO_PUBLIC_TRANSCRIBE_API_URL`
- RunComfy (opțional, cu cost): [`../docs/runcomfy.md`](../docs/runcomfy.md)
