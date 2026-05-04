# Sonara Keys

**From score to sound, one key at a time.**

Sonara Keys este o aplicație **Expo (React Native)** pentru detectarea notelor în timp real de la **microfon**, afișare pe **portativ**, mod **Practice** cu tastatură on-screen, bibliotecă locală de melodii și export **SVG / JSON / MIDI**. Opțional: transcriere mai bogată pe PC prin **Basic Pitch** (Python) și autentificare **Kinde**.

---

## Ce face aplicația

| Zonă | Descriere |
|------|-------------|
| **Ascultare live** | PCM de la microfon → pipeline YIN / opțional server Basic Pitch → note pe portativ. |
| **Practice** | Melodie exemplu sau melodie salvată; feedback corect/greșit; auto-play; tastatură. |
| **Bibliotecă** | Melodii salvate local (`expo-file-system`), Practice, partajare fișiere. |
| **Import audio** | Înregistrare scurtă → WAV → `POST /transcribe` pe serverul tău (același contract ca live). |

Microfonul **nu** rulează în **Expo Go** — ai nevoie de **development build** (`npx expo run:android` / `run:ios`).

---

## Stack

- **Expo SDK 54**, React Native 0.81, TypeScript  
- **@edkimmel/expo-audio-stream** — captură PCM nativă  
- **TensorFlow.js** — Basic Pitch on-device (opțional dezactivat prin env)  
- **@kinde/expo** — conturi (opțional, dacă pui cheile în `.env`)  
- **Server `server/`** — FastAPI + Spotify Basic Pitch pentru `/transcribe`  

Design: `theme/sonaraTheme.ts` + `theme/theme.ts`; Practice: `src/theme/practiceTheme.ts`.

---

## Cerințe

- Node.js **18+**  
- **Android Studio** / **Xcode** pentru build nativ  
- Telefon sau emulator cu intrare audio (pentru live detection)  

---

## Instalare și rulare

```bash
npm install
npx expo start
```

Build nativ (recomandat pentru microfon):

```bash
npx expo run:android
# sau
npx expo run:ios
```

USB + Metro pe același PC:

```bash
npm run dev:usb
```

Web (`npm run web`): fără microfon live; demo tastatură / auto-play unde e suportat.

---

## Variabile de mediu (`.env`)

Copiază din **`.env.example`** și completează:

| Variabilă | Rol |
|-----------|-----|
| `EXPO_PUBLIC_TRANSCRIBE_API_URL` | URL server Basic Pitch (ex. `http://IP:8787`). Fără `/` final. |
| `EXPO_PUBLIC_SKIP_ONDEVICE_BASIC_PITCH` | Opțional `1` — sari peste TF pe telefon. |
| `EXPO_PUBLIC_KINDE_DOMAIN` | URL subdomeniu Kinde (`https://xxx.kinde.com`). |
| `EXPO_PUBLIC_KINDE_CLIENT_ID` | Client ID aplicație nativă din Kinde. |
| `EXPO_PUBLIC_SUPABASE_URL` | URL proiect Supabase (ex. `https://hctlyggquhrxmdeiolmc.supabase.co`). |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Cheia **anon** publică (Settings → API în Supabase). |

După modificări: **`npx expo start --clear`**.

**Kinde — Callback URL** în dashboard (scheme din `app.json`):  
`sonarakeys://kinde_callback`

Fișierul **`.env`** nu se comite (e în `.gitignore`).

---

## Supabase

Proiect dashboard: [Supabase — Sonara Keys (hctlyggquhrxmdeiolmc)](https://supabase.com/dashboard/project/hctlyggquhrxmdeiolmc).

1. În **Settings → API** copiază **Project URL** și **anon public** în `.env` (vezi tabelul de mai sus).  
2. În cod, clientul e în [`src/lib/supabase.ts`](src/lib/supabase.ts) — `supabase` e `null` până pui ambele variabile.  
3. Pentru melodii în cloud: creează tabele în **SQL Editor**, activează **RLS** + politici pe `auth.uid()` (sau integrezi mai întâi Kinde JWT cu Supabase — pas separat).  
4. Exemplu SQL minimal pentru o viitoare tabelă `melodies` (ajustează după nevoie):

```sql
create table if not exists public.melodies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  title text not null,
  notes jsonb not null,
  created_at timestamptz default now()
);
```

---

## Server Python (transcriere)

```bash
cd server
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
python app.py
```

Detalii: [`docs/local-basic-pitch.md`](docs/local-basic-pitch.md).

---

## Teste

```bash
npm test                 # Jest (unit)
npm run test:e2e:build:android   # Detox — necesită APK + emulator (vezi detox.config.js)
```

---

## Depanare rapidă

- **„Module not found” în Expo Go** — normal; folosește dev build.  
- **Timeout la IP în dev** — același Wi‑Fi ca PC-ul sau `npm run dev:usb` + `adb reverse`.  
- **Web** — fără modul microfon; folosește Android/iOS pentru flux complet.  

---

## Licență

Drepturi de autor **DEVAIEOOD LTD** — vezi fișierul [`LICENSE`](LICENSE) din rădăcina repo-ului.  
Codul nu este licențiat ca open source implicit; pentru utilizare sau redistribuire contactează deținătorul.

---

Repository: [github.com/boctavian2014-ux/Sonara-Keys](https://github.com/boctavian2014-ux/Sonara-Keys)
