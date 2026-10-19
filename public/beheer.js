(() => {
  const { render: renderMeme, el } = window.MemeKit;
  const $ = (id) => document.getElementById(id);
  const status = $("status");
  let token = "";
  try { token = sessionStorage.getItem("mf:admin") || ""; } catch {}
  $("token").value = token;

  async function call(path, body) {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Mislukt.");
    return data;
  }

  async function load() {
    status.className = "status"; status.textContent = "Laden…";
    try {
      const { memes } = await call("/api/admin/queue");
      const q = $("queue"); q.textContent = "";
      if (!memes.length) q.append(el("p", "status", "Niets gemeld. Alles rustig op de band."));
      for (const m of memes) {
        const card = el("div");
        card.append(renderMeme(m, "Gemelde meme"));
        const meta = el("div", "meta");
        if (m.hidden) meta.append(el("span", "pill hidden", "verborgen"));
        meta.append(el("span", null, `${m.reports} meldingen · ${m.nickname}${m.isReply ? " · reactie" : ""}`));
        card.append(el("div", "status", m.headline || ""), meta);
        const row = el("div", "meta");
        for (const [action, label] of [[m.hidden ? "show" : "hide", m.hidden ? "Terugzetten" : "Verbergen"], ["delete", "Definitief verwijderen"]]) {
          const b = el("button", "btn", label); b.type = "button";
          b.addEventListener("click", async () => { b.disabled = true; try { await call(`/api/admin/memes/${m.id}`, { action }); await load(); } catch (e) { b.disabled = false; status.className = "status err"; status.textContent = e.message; } });
          row.append(b);
        }
        card.append(row);
        q.append(card);
      }
      status.textContent = memes.length + " in de wachtrij.";
    } catch (e) { status.className = "status err"; status.textContent = e.message; }
  }

  $("login").addEventListener("submit", (e) => {
    e.preventDefault();
    token = $("token").value.trim();
    try { sessionStorage.setItem("mf:admin", token); } catch {}
    load();
  });
  $("desk").addEventListener("click", async () => {
    status.className = "status"; status.textContent = "De nieuwsdesk leest het nieuws…";
    try { const { made } = await call("/api/admin/newsdesk", {}); status.textContent = `${made} nieuwe memes op de band.`; }
    catch (e) { status.className = "status err"; status.textContent = e.message; }
  });
  if (token) load();
})();
