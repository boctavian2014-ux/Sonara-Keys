# Transcriere locală (Basic Pitch) fără RunComfy

Aplicația poate trimite audio la un mic server local care rulează **Spotify Basic Pitch** în Python și întoarce aceeași structură **`DetectedNote[]`** ca înainte (`name`, `octave`, `startTime`, `endTime`, `midi`).

## De ce nu din `public-apis`

Lista [public-apis](https://github.com/public-apis/public-apis) nu include un API public gratuit dedicat **audio → MIDI**; intrările „Music” sunt în mare parte catalog, lyrics, streaming, metadate. Pentru transcriere reală, Basic Pitch local este varianta gratuită și stabilă.

## 1. Pornește serverul Python

Din repo:

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Implicit ascultă pe portul **8787** (`http://localhost:8787`). Setează `PORT` dacă vrei alt port.

## 2. Configurează aplicația Expo

În `.env` (sau variabile de build Expo), setează:

```env
EXPO_PUBLIC_TRANSCRIBE_API_URL=http://localhost:8787
```

Pe **telefon fizic** în aceeași rețea Wi‑Fi, folosește IP-ul PC-ului, nu `localhost`:

```env
EXPO_PUBLIC_TRANSCRIBE_API_URL=http://192.168.1.50:8787
```

Repornește bundler-ul după schimbarea env (`npx expo start --clear`).

## 3. Import direct din audio (Home → server)

Pe ecranul Home, butonul **„Importă din audio (server PC)”** înregistrează PCM de la microfon, îmbină chunk-urile, le encodează ca WAV și trimite **`POST /transcribe`** cu același JSON **`{ wavBase64 }`** ca ascultarea live (vezi [`src/audio/transcribeRemote.ts`](../src/audio/transcribeRemote.ts)). Fluxul folosește **aceeași** variabilă **`EXPO_PUBLIC_TRANSCRIBE_API_URL`** ca transcrierea din `useNoteDetection`: portul din URL trebuie să coincidă cu serverul (ex. **8787** dacă rulezi `python app.py` implicit, sau **8765** dacă setezi `PORT=8765` — important e ca env-ul din app să fie identic cu host:port-ul unde ascultă FastAPI).

Nu folosi ascultarea live în timpul acestui import; cele două fluxuri împart modulul de microfon.

## 4. Comportament în app (ascultare live)

În [`src/audio/useNoteDetection.ts`](../src/audio/useNoteDetection.ts) ordinea este:

1. **Server** (dacă `EXPO_PUBLIC_TRANSCRIBE_API_URL` e setat) — Basic Pitch pe PC, de obicei mult mai rapid decât TF pe telefon.
2. **YIN** pe telefon — rapid (secunde), bun la linie melodică simplă.
3. **Basic Pitch on-device** (TensorFlow) — doar dacă încă nu sunt note; e lent la prima rulare (descărcare model). Poți sări peste el cu:

```env
EXPO_PUBLIC_SKIP_ONDEVICE_BASIC_PITCH=1
```

Lungimea audio trimisă la analiză e plafonată la **~8 s** (ultimele secunde din înregistrare) ca să nu blocheze telefonul minute întregi.

## 5. Parametri opționali (server)

Vezi [`server/.env.example`](../server/.env.example): praguri Basic Pitch (`BP_ONSET_THRESHOLD`, `BP_FRAME_THRESHOLD`, etc.) dacă vrei să tunezi sensibilitatea.

## 6. Notă despre RunComfy

Documentația veche RunComfy rămâne opțională în [`runcomfy.md`](runcomfy.md); nu mai este necesară pentru fluxul gratuit local.
