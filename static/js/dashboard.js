(() => {
  const $ = (id) => document.getElementById(id);
  const PALETTE = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#64748b"];

  const state = {
    categories: { Expense: [], Income: [] },
    type: "Expense",
    editingId: null,
    rows: [],
    barChart: null,
    donut: null,
  };

  // ---------- helpers ----------
  const money = (n) =>
    "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function todayLocal() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function monthShort(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" }) + " " + String(y).slice(2);
  }

  function monthLong(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  }

  function prettyDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.toggle("error", isError);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, { headers: { "Content-Type": "application/json" }, ...opts });
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("Please log in again");
    }
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Request failed");
    return body;
  }

  // ---------- form (add / edit) ----------
  function fillCategories(selected) {
    const sel = $("category");
    sel.innerHTML = state.categories[state.type]
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join("");
    if (selected && state.categories[state.type].includes(selected)) sel.value = selected;
  }

  function setType(type, selectedCategory) {
    state.type = type;
    document.querySelectorAll("#typeSeg button").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
    const isExp = type === "Expense";
    $("titleLabel").textContent = isExp ? "Expense name" : "Income source";
    $("title").placeholder = isExp ? "e.g. Groceries" : "e.g. Monthly salary";
    fillCategories(selectedCategory);
    $("saveBtn").textContent = state.editingId ? "Save changes" : isExp ? "Add expense" : "Add income";
  }

  function resetForm() {
    state.editingId = null;
    $("txForm").reset();
    $("date").value = todayLocal();
    $("formTitle").textContent = "Add a transaction";
    $("cancelEdit").hidden = true;
    setType(state.type);
  }

  $("typeSeg").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button");
    if (btn) setType(btn.dataset.type);
  });

  $("cancelEdit").addEventListener("click", resetForm);

  $("txForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const payload = {
      type: state.type,
      title: $("title").value.trim(),
      amount: parseFloat($("amount").value),
      category: $("category").value,
      date: $("date").value,
    };
    const editing = !!state.editingId;
    try {
      if (editing) {
        await api("/transactions/" + encodeURIComponent(state.editingId), { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/transactions", { method: "POST", body: JSON.stringify(payload) });
      }
    } catch (err) {
      toast(err.message, true);
      return;
    }
    const period = $("periodMonth").value;
    const outside = period && !payload.date.startsWith(period);
    resetForm();
    await refresh();
    toast(
      (editing ? "Changes saved" : payload.type + " added") +
        (outside ? " (outside the selected month, click All time to see it)" : "")
    );
  });

  // ---------- table ----------
  function renderTable() {
    $("list").innerHTML = state.rows
      .map((r) => {
        const cls = r.type.toLowerCase();
        const sign = r.type === "Income" ? "+" : "−";
        return `<tr>
          <td>${prettyDate(r.date)}</td>
          <td><div class="t-title">${esc(r.title)}</div></td>
          <td><span class="badge ${cls}">${r.type}</span></td>
          <td>${esc(r.category)}</td>
          <td class="r amount ${cls}">${sign} ${money(r.amount)}</td>
          <td class="actions">
            <button class="icon-btn edit" data-id="${r.id}">Edit</button>
            <button class="icon-btn del" data-id="${r.id}">Delete</button>
          </td>
        </tr>`;
      })
      .join("");
    $("empty").style.display = state.rows.length ? "none" : "block";
  }

  $("list").addEventListener("click", async (ev) => {
    const edit = ev.target.closest(".edit");
    const del = ev.target.closest(".del");
    if (edit) {
      const row = state.rows.find((r) => r.id === edit.dataset.id);
      if (!row) return;
      state.editingId = row.id;
      $("formTitle").textContent = "Edit transaction";
      $("cancelEdit").hidden = false;
      setType(row.type, row.category);
      $("title").value = row.title;
      $("amount").value = row.amount;
      $("date").value = row.date;
      $("formPanel").scrollIntoView({ behavior: "smooth", block: "center" });
      $("title").focus();
    } else if (del) {
      if (!confirm("Delete this transaction?")) return;
      try {
        await api("/transactions/" + encodeURIComponent(del.dataset.id), { method: "DELETE" });
      } catch (err) {
        toast(err.message, true);
        return;
      }
      if (state.editingId === del.dataset.id) resetForm();
      await refresh();
      toast("Transaction deleted");
    }
  });

  // ---------- stats & charts ----------
  function renderStats(s) {
    $("income").textContent = money(s.income);
    $("expense").textContent = money(s.expense);
    $("balance").textContent = money(s.balance);
    $("balance").classList.toggle("neg", s.balance < 0);
    $("savings").textContent = s.savings_rate === null ? "–" : s.savings_rate.toFixed(0) + "%";
    $("savings").classList.toggle("neg", s.savings_rate !== null && s.savings_rate < 0);

    const period = $("periodMonth").value;
    $("periodText").textContent = period ? "Showing " + monthLong(period) : "Showing all time";
    $("donutSub").textContent = period ? monthLong(period) : "All time";

    if (typeof Chart === "undefined") {
      $("chartError").style.display = "block";
      return;
    }
    renderBar(s.monthly);
    renderDonut(s.expense_by_category);
  }

  function compact(v) {
    if (v >= 10000000) return "₹" + (v / 10000000).toFixed(1) + "Cr";
    if (v >= 100000) return "₹" + (v / 100000).toFixed(1) + "L";
    if (v >= 1000) return "₹" + (v / 1000).toFixed(0) + "k";
    return "₹" + v;
  }

  function renderBar(monthly) {
    const data = {
      labels: monthly.map((m) => monthShort(m.month)),
      datasets: [
        { label: "Income", data: monthly.map((m) => m.income), backgroundColor: "#10b981", borderRadius: 6, maxBarThickness: 34 },
        { label: "Expenses", data: monthly.map((m) => m.expense), backgroundColor: "#ef4444", borderRadius: 6, maxBarThickness: 34 },
      ],
    };
    if (state.barChart) {
      state.barChart.data = data;
      state.barChart.update();
      return;
    }
    state.barChart = new Chart($("barChart"), {
      type: "bar",
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + money(c.parsed.y) } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: "#eef0f8" }, ticks: { callback: compact } },
        },
      },
    });
  }

  function renderDonut(cats) {
    const empty = cats.length === 0;
    $("donutBox").style.display = empty ? "none" : "block";
    $("donutEmpty").style.display = empty ? "block" : "none";
    if (empty) return;
    const data = {
      labels: cats.map((c) => c.category),
      datasets: [{ data: cats.map((c) => c.total), backgroundColor: cats.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 2, borderColor: "#fff" }],
    };
    if (state.donut) {
      state.donut.data = data;
      state.donut.update();
      return;
    }
    state.donut = new Chart($("donutChart"), {
      type: "doughnut",
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (c) => c.label + ": " + money(c.parsed) } },
        },
      },
    });
  }

  // ---------- loading ----------
  async function refresh() {
    const month = $("periodMonth").value;
    const monthQs = month ? "month=" + encodeURIComponent(month) : "";
    const rowParams = new URLSearchParams();
    if (month) rowParams.set("month", month);
    if ($("filterType").value) rowParams.set("type", $("filterType").value);
    if ($("filterCategory").value) rowParams.set("category", $("filterCategory").value);
    if ($("search").value.trim()) rowParams.set("q", $("search").value.trim());
    try {
      const [stats, rows] = await Promise.all([
        api("/stats" + (monthQs ? "?" + monthQs : "")),
        api("/transactions" + (rowParams.toString() ? "?" + rowParams : "")),
      ]);
      state.rows = rows;
      renderStats(stats);
      renderTable();
    } catch (err) {
      toast(err.message, true);
    }
  }

  let searchTimer;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 250);
  });
  ["filterType", "filterCategory", "periodMonth"].forEach((id) => $(id).addEventListener("change", refresh));
  $("allTimeBtn").addEventListener("click", () => {
    $("periodMonth").value = "";
    refresh();
  });

  $("exportBtn").addEventListener("click", () => {
    const rows = [["Date", "Type", "Name", "Category", "Amount"]].concat(
      state.rows.map((r) => [r.date, r.type, r.title, r.category, r.amount.toFixed(2)])
    );
    // Prefix risky leading characters so spreadsheets do not run a cell as a formula.
    const safe = (c) => (/^[=+\-@]/.test(String(c)) ? "'" + c : c);
    const csv = rows.map((r) => r.map((c) => `"${String(safe(c)).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("logoutBtn").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (_) { /* ignore */ }
    window.location.href = "/login";
  });

  // ---------- start ----------
  async function init() {
    try {
      const [me, cats] = await Promise.all([api("/me"), api("/categories")]);
      state.categories = cats;
      $("userName").textContent = me.name;
      $("userEmail").textContent = me.email;
      $("avatar").textContent = me.name.trim().charAt(0).toUpperCase();
      $("firstName").textContent = me.name.trim().split(/\s+/)[0];
    } catch (err) {
      return;
    }

    const allCats = [...new Set([...state.categories.Expense, ...state.categories.Income])];
    $("filterCategory").innerHTML =
      '<option value="">All categories</option>' + allCats.map((c) => `<option>${esc(c)}</option>`).join("");

    $("periodMonth").value = todayLocal().slice(0, 7);
    resetForm();
    refresh();
  }

  init();
})();
