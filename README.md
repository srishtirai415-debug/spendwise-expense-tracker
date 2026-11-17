# SpendWise – Expense & Income Tracker

A Flask + SQLite web app with user accounts and a colourful dashboard.

## Features
- Register and log in (passwords are hashed, never stored in plain text)
- Every user sees only their own data
- Add **Expense** or **Income** entries (e.g. Groceries, Monthly salary) with categories
- Edit and delete entries, search, filter by type and category, pick a month
- Dashboard cards: balance, total income, total expenses, savings rate
- Charts: income vs expenses for the last 6 months, spending by category
- Export the current table to CSV

## Run
```bash
pip install -r requirements.txt
python server.py
```
Open http://127.0.0.1:5000, click **Create an account**, then log in.

The charts use Chart.js loaded from a CDN, so you need an internet connection for the charts to appear.

Optional environment variables: `PORT` (default 5000), `EXPENSE_DB` (SQLite file path), `SECRET_KEY` (session signing key; if not set, one is created in `secret.key`).

## Databases
- **Local (default):** SQLite file `expenses.db`, nothing to configure.
- **Postgres:** if the environment variable `DATABASE_URL` is set, the app uses Postgres instead (tables are created automatically). This is what you need on Vercel, where files cannot be saved.

### Deploy on Vercel with Neon
1. In your Vercel project open **Storage**, create a **Neon** Postgres database and connect it to the project. Vercel adds `DATABASE_URL` automatically.
2. Add the environment variable `SECRET_KEY` (a long random text).
3. Push to GitHub and redeploy.

## Project structure
```
server.py            Flask app, database and API
templates/           login.html, register.html, dashboard.html
static/css/style.css Styling
static/js/auth.js    Login and register forms
static/js/dashboard.js  Dashboard, charts, table
expenses.db          SQLite database (created on first run)
```

## API (login required except register/login)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Create account: name, email, password |
| POST | `/api/login` | Log in: email, password |
| POST | `/api/logout` | Log out |
| GET | `/api/me` | Current user |
| GET | `/api/categories` | Categories for Expense and Income |
| GET | `/api/transactions` | List, filters: `type`, `category`, `month`, `q` |
| POST | `/api/transactions` | Create: type, title, amount, category, date |
| PUT | `/api/transactions/<id>` | Update |
| DELETE | `/api/transactions/<id>` | Delete |
| GET | `/api/stats?month=YYYY-MM` | Totals, category breakdown, 6-month series |

## Notes
- Do not share `secret.key` or `expenses.db`.
- For real online deployment, run behind a production server (e.g. gunicorn) with HTTPS.
