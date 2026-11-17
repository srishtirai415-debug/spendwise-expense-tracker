import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import date, timedelta
from functools import wraps

from flask import Flask, g, jsonify, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("EXPENSE_DB", os.path.join(BASE_DIR, "expenses.db"))

CATEGORIES = {
    "Expense": ["Food", "Transport", "Bills", "Rent", "Shopping", "Health", "Education", "Entertainment", "Other"],
    "Income": ["Salary", "Freelance", "Business", "Investment", "Gift", "Other"],
}

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# def load_secret_key():
#     """Use SECRET_KEY from the environment, otherwise create one once and keep it in secret.key."""
#     env_key = os.environ.get("SECRET_KEY")
#     if env_key:
#         return env_key
#     path = os.path.join(BASE_DIR, "secret.key")
#     if os.path.exists(path):
#         with open(path) as f:
#             return f.read().strip()
#     key = secrets.token_hex(32)
#     with open(path, "w") as f:
#         f.write(key)
#     return key
def load_secret_key():
    return os.environ.get("SECRET_KEY") or secrets.token_hex(32)


app = Flask(__name__)
app.config.update(
    SECRET_KEY=load_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
)


# ---------------------------------------------------------------- database
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type TEXT NOT NULL CHECK (type IN ('Expense', 'Income')),
                title TEXT NOT NULL,
                amount REAL NOT NULL CHECK (amount > 0),
                category TEXT NOT NULL,
                date TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
            """
        )


# ---------------------------------------------------------------- helpers
_attempts = {}


def too_many_attempts(key, limit=10, window=300):
    now = time.time()
    hits = [t for t in _attempts.get(key, []) if now - t < window]
    _attempts[key] = hits
    return len(hits) >= limit


def record_attempt(key):
    _attempts.setdefault(key, []).append(time.time())


def api_login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify(error="Please log in"), 401
        return fn(*args, **kwargs)

    return wrapper


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def last_months(n=6):
    today = date.today()
    y, m = today.year, today.month
    keys = []
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(keys))


def validate_transaction(data):
    tx_type = data.get("type")
    if tx_type not in CATEGORIES:
        return None, "Type must be Expense or Income"
    title = str(data.get("title", "")).strip()
    if not title or len(title) > 200:
        return None, "Name is required (max 200 characters)"
    try:
        amount = round(float(data.get("amount")), 2)
    except (TypeError, ValueError):
        return None, "Amount must be a number"
    if not 0 < amount < 1e12:
        return None, "Amount must be greater than 0"
    category = data.get("category")
    if category not in CATEGORIES[tx_type]:
        return None, "Category must be one of: " + ", ".join(CATEGORIES[tx_type])
    d = str(data.get("date", ""))
    if not DATE_RE.match(d):
        return None, "Date must be YYYY-MM-DD"
    try:
        date.fromisoformat(d)
    except ValueError:
        return None, "Date is not a valid calendar date"
    return {"type": tx_type, "title": title, "amount": amount, "category": category, "date": d}, None


@app.after_request
def no_cache(resp):
    if request.path.startswith("/api") or request.path == "/dashboard":
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------- pages
@app.get("/")
def home():
    return redirect("/dashboard" if session.get("user_id") else "/login")


@app.get("/login")
def login_page():
    if session.get("user_id"):
        return redirect("/dashboard")
    return render_template("login.html")


@app.get("/register")
def register_page():
    if session.get("user_id"):
        return redirect("/dashboard")
    return render_template("register.html")


@app.get("/dashboard")
def dashboard_page():
    if not session.get("user_id"):
        return redirect("/login")
    return render_template("dashboard.html")


# ---------------------------------------------------------------- auth API
@app.post("/api/register")
def register():
    data = json_body()
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not 2 <= len(name) <= 60:
        return jsonify(error="Name must be 2 to 60 characters"), 400
    if not EMAIL_RE.match(email) or len(email) > 120:
        return jsonify(error="Enter a valid email address"), 400
    if not 8 <= len(password) <= 128:
        return jsonify(error="Password must be at least 8 characters"), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
            (name, email, generate_password_hash(password)),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify(error="An account with this email already exists"), 409
    session.clear()
    session["user_id"] = cur.lastrowid
    session.permanent = True
    return jsonify(id=cur.lastrowid, name=name, email=email), 201


@app.post("/api/login")
def login():
    key = request.remote_addr or "unknown"
    if too_many_attempts(key):
        return jsonify(error="Too many failed attempts. Try again in a few minutes."), 429
    data = json_body()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    row = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        record_attempt(key)
        return jsonify(error="Invalid email or password"), 401
    _attempts.pop(key, None)
    session.clear()
    session["user_id"] = row["id"]
    session.permanent = True
    return jsonify(id=row["id"], name=row["name"], email=row["email"])


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
@api_login_required
def me():
    row = get_db().execute("SELECT id, name, email FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    if not row:
        session.clear()
        return jsonify(error="Please log in"), 401
    return jsonify(id=row["id"], name=row["name"], email=row["email"])


@app.get("/api/categories")
def categories():
    return jsonify(CATEGORIES)


# ---------------------------------------------------------------- transactions API
@app.get("/api/transactions")
@api_login_required
def list_transactions():
    sql = "SELECT id, type, title, amount, category, date FROM transactions WHERE user_id = ?"
    params = [session["user_id"]]
    tx_type = request.args.get("type")
    category = request.args.get("category")
    month = request.args.get("month")
    q = request.args.get("q", "").strip()
    if tx_type:
        if tx_type not in CATEGORIES:
            return jsonify(error="Invalid type"), 400
        sql += " AND type = ?"
        params.append(tx_type)
    if category:
        sql += " AND category = ?"
        params.append(category)
    if month:
        if not MONTH_RE.match(month):
            return jsonify(error="month must be YYYY-MM"), 400
        sql += " AND date LIKE ?"
        params.append(month + "-%")
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        sql += " AND title LIKE ? ESCAPE '\\'"
        params.append(f"%{escaped}%")
    sql += " ORDER BY date DESC, rowid DESC"
    rows = get_db().execute(sql, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/transactions")
@api_login_required
def create_transaction():
    clean, err = validate_transaction(json_body())
    if err:
        return jsonify(error=err), 400
    clean["id"] = uuid.uuid4().hex[:12]
    db = get_db()
    db.execute(
        "INSERT INTO transactions (id, user_id, type, title, amount, category, date) "
        "VALUES (:id, :uid, :type, :title, :amount, :category, :date)",
        {**clean, "uid": session["user_id"]},
    )
    db.commit()
    return jsonify(clean), 201


@app.put("/api/transactions/<tx_id>")
@api_login_required
def update_transaction(tx_id):
    clean, err = validate_transaction(json_body())
    if err:
        return jsonify(error=err), 400
    db = get_db()
    cur = db.execute(
        "UPDATE transactions SET type=:type, title=:title, amount=:amount, category=:category, date=:date "
        "WHERE id=:id AND user_id=:uid",
        {**clean, "id": tx_id, "uid": session["user_id"]},
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify(error="Not found"), 404
    return jsonify({**clean, "id": tx_id})


@app.delete("/api/transactions/<tx_id>")
@api_login_required
def delete_transaction(tx_id):
    db = get_db()
    cur = db.execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, session["user_id"]))
    db.commit()
    if cur.rowcount == 0:
        return jsonify(error="Not found"), 404
    return "", 204


@app.get("/api/stats")
@api_login_required
def stats():
    uid = session["user_id"]
    month = request.args.get("month")
    if month and not MONTH_RE.match(month):
        return jsonify(error="month must be YYYY-MM"), 400
    db = get_db()

    where, params = "user_id = ?", [uid]
    if month:
        where += " AND date LIKE ?"
        params.append(month + "-%")

    totals = {"Income": 0.0, "Expense": 0.0}
    count = 0
    for r in db.execute(f"SELECT type, SUM(amount) AS t, COUNT(*) AS c FROM transactions WHERE {where} GROUP BY type", params):
        totals[r["type"]] = r["t"] or 0.0
        count += r["c"]

    by_cat = db.execute(
        f"SELECT category, SUM(amount) AS total FROM transactions WHERE {where} AND type = 'Expense' "
        "GROUP BY category ORDER BY total DESC",
        params,
    ).fetchall()

    months = last_months(6)
    series = {k: {"month": k, "income": 0.0, "expense": 0.0} for k in months}
    for r in db.execute(
        "SELECT substr(date, 1, 7) AS m, type, SUM(amount) AS t FROM transactions "
        "WHERE user_id = ? AND substr(date, 1, 7) >= ? GROUP BY m, type",
        (uid, months[0]),
    ):
        if r["m"] in series:
            series[r["m"]]["income" if r["type"] == "Income" else "expense"] = round(r["t"], 2)

    income, expense = totals["Income"], totals["Expense"]
    return jsonify(
        income=round(income, 2),
        expense=round(expense, 2),
        balance=round(income - expense, 2),
        savings_rate=round((income - expense) / income * 100, 1) if income > 0 else None,
        count=count,
        expense_by_category=[{"category": r["category"], "total": round(r["total"], 2)} for r in by_cat],
        monthly=[series[k] for k in months],
    )


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="127.0.0.1", port=port, debug=False)
