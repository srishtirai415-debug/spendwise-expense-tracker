(() => {
  const form = document.getElementById("authForm");
  const errorBox = document.getElementById("error");
  const submitBtn = document.getElementById("submitBtn");
  const mode = form.dataset.mode; // "login" or "register"

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add("show");
  }

  document.querySelectorAll(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
    });
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errorBox.classList.remove("show");

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const payload = { email, password };

    if (!email || !password) return showError("Please fill in all fields.");

    if (mode === "register") {
      const name = document.getElementById("name").value.trim();
      const confirm = document.getElementById("confirm").value;
      if (name.length < 2) return showError("Please enter your name.");
      if (password.length < 8) return showError("Password must be at least 8 characters.");
      if (password !== confirm) return showError("Passwords do not match.");
      payload.name = name;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = "Please wait...";
    try {
      const res = await fetch("/api/" + mode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
      window.location.href = "/dashboard";
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
})();
