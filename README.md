# Traede Dashboard

Dashboard for visualisering av salgsdata fra Traede. Henter produkter, kunder, ordrer og fakturaer via Traede Core API og viser dem i et interaktivt dashboard.

## Tech Stack

- **Frontend:** React (Vite) + Recharts
- **Backend:** Python (FastAPI)
- **Database:** PostgreSQL
- **Sync:** Python-scripts for Traede API → PostgreSQL

## Prosjektstruktur

```
traede-dashboard/
├── frontend/          # React + Vite dashboard
│   └── src/
├── backend/           # FastAPI backend
│   └── app/
├── sync/              # Synkroniseringsscripts mot Traede
│   ├── traede_client.py
│   ├── initial_import.py
│   └── incremental_sync.py
├── db/
│   └── schema.sql     # PostgreSQL-skjema
├── .env               # Miljøvariabler (IKKE commit!)
└── .env.example       # Mal for .env
```

## Oppsett

### 1. Miljøvariabler

Kopier `.env.example` til `.env` og fyll inn verdiene:

```bash
cp .env.example .env
```

Du trenger:
- `TRAEDE_API_TOKEN` – Bearer token fra Traede
- `TRAEDE_APP_KEY` – App key fra Traede
- `DATABASE_URL` – PostgreSQL connection string

### 2. Database

Opprett en PostgreSQL-database og kjør skjemaet:

```bash
psql -d traede_dashboard -f db/schema.sql
```

### 3. Python-avhengigheter

```bash
pip install -r sync/requirements.txt
pip install -r backend/requirements.txt
```

### 4. Første import (historisk data)

```bash
cd sync
python initial_import.py
```

### 5. Start backend

```bash
cd backend
uvicorn app.main:app --reload
```

Backend kjører på `http://localhost:8000`. API-docs på `http://localhost:8000/docs`.

### 6. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend kjører på `http://localhost:5173`.

### 7. Inkrementell synkronisering

For å holde dataen oppdatert, kjør periodisk:

```bash
cd sync
python incremental_sync.py
```

Sett opp som cron-jobb for automatisk synkronisering, f.eks. hvert 15. minutt:

```cron
*/15 * * * * cd /path/to/traede-dashboard/sync && python incremental_sync.py
```

## API-endepunkter

| Endepunkt | Beskrivelse |
|-----------|-------------|
| `GET /api/dashboard/overview` | Nøkkeltall (ordrer, omsetning, kunder) |
| `GET /api/products/top-sellers` | Topp-selgende produkter |
| `GET /api/products` | Alle produkter med søk |
| `GET /api/customers/top-buyers` | Beste kunder etter kjøpsbeløp |
| `GET /api/customers` | Alle kunder med søk |
| `GET /api/sales/timeline` | Salg over tid (dag/uke/måned) |
| `GET /api/sync/status` | Synkroniseringsstatus |
| `GET /api/health` | Helsesjekk |

Alle endepunkter støtter `date_from` og `date_to` query-parametre.
