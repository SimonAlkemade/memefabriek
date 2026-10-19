(() => {
  const { render: renderMeme, composer, el } = window.MemeKit;
  const $ = (id) => document.getElementById(id);

  // ---------- per-browser memory: nickname, a secret for deleting your own memes, your meme ids ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("mf:" + k, JSON.stringify(v)); } catch {} },
  };
  let deleteKey = store.get("deleteKey", null);
  if (!deleteKey) {
    deleteKey = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    store.set("deleteKey", deleteKey);
  }
  const mine = new Set(store.get("mine", []));
  const reported = new Set(store.get("reported", []));
  const remember = (set, key, id) => { set.add(id); store.set(key, [...set].slice(-500)); };

  const nickInput = $("nickname");
  nickInput.value = store.get("nickname", "");
  nickInput.addEventListener("input", () => store.set("nickname", nickInput.value.trim()));
  function nickname(status) {
    const n = nickInput.value.trim();
    if (!n) { status.className = "status err"; status.textContent = "Kies eerst een bijnaam, bovenaan de pagina."; nickInput.focus(); }
    return n;
  }

  // ---------- API ----------
  async function api(path, body) {
    const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || "Er ging iets mis. Probeer het opnieuw.");
    return data;
  }

  // ---------- Turnstile (spam check), only when the site has it switched on ----------
  let turnstileReady = null;
  function loadTurnstile(siteKey) {
    turnstileReady = new Promise((resolve) => {
      window.onTurnstileLoad = () => {
        const id = window.turnstile.render("#turnstile", { sitekey: siteKey, execution: "execute", appearance: "interaction-only", "refresh-expired": "manual" });
        resolve(id);
      };
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
      s.async = true;
      document.head.append(s);
    });
  }
  async function turnstileToken() {
    if (!turnstileReady) return undefined;
    const id = await turnstileReady;
    $("turnstile").hidden = false;
    window.turnstile.reset(id);
    window.turnstile.execute(id);
    for (let i = 0; i < 120; i++) {
      const t = window.turnstile.getResponse(id);
      if (t) { $("turnstile").hidden = true; return t; }
      await new Promise((r) => setTimeout(r, 250));
    }
    return undefined;
  }

  // ---------- state ----------
  const S = { memes: [], next: null, open: new Set(), fresh: new Set(), claude: true };
  const feed = $("feed");

  function ago(iso) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (!isFinite(s)) return "";
    if (s < 60) return "zojuist";
    if (s < 3600) return Math.floor(s / 60) + " min geleden";
    if (s < 86400) return Math.floor(s / 3600) + " uur geleden";
    const d = Math.floor(s / 86400);
    return d === 1 ? "gisteren" : d + " dagen geleden";
  }
  const who = (m) => (m.desk ? "de Nieuwsdesk" : m.nickname || "iemand");

  async function load(more) {
    try {
      const data = await api("/api/feed" + (more && S.next ? "?before=" + encodeURIComponent(S.next) : ""));
      if (more) {
        const have = new Set(S.memes.map((m) => m.id));
        S.memes.push(...data.memes.filter((m) => !have.has(m.id)));
        S.next = data.next;
      } else {
        // Refresh the newest page and keep any older pages the visitor already loaded.
        const last = data.memes.length ? data.memes[data.memes.length - 1].createdAt : "";
        const prev = new Set(S.memes.map((m) => m.id));
        if (S.memes.length) data.memes.forEach((m) => { if (!prev.has(m.id)) S.fresh.add(m.id); });
        const older = data.next ? S.memes.filter((m) => m.createdAt < last) : [];
        S.memes = [...data.memes, ...older];
        if (!older.length) S.next = data.next;
      }
      softRender();
    } catch (e) {
      if (!S.memes.length) { $("feed-empty").querySelector("span").textContent = "De memes konden niet worden geladen. Ververs de pagina om het opnieuw te proberen."; }
    }
  }

  // ---------- small controls ----------
  function confirmBtn(label, armedLabel, onConfirm) {
    const b = el("button", "btn ghost", label); b.type = "button";
    let armed = false;
    b.addEventListener("click", async () => {
      if (!armed) { armed = true; b.textContent = armedLabel; setTimeout(() => { armed = false; if (!b.disabled) b.textContent = label; }, 3000); return; }
      b.disabled = true;
      try { await onConfirm(); } catch (e) { b.disabled = false; b.textContent = e.message || "Mislukt"; }
    });
    return b;
  }
  function actionsFor(m) {
    const row = [];
    if (mine.has(m.id)) {
      row.push(confirmBtn("Verwijderen", "Nogmaals klikken om te verwijderen", async () => {
        await api(`/api/memes/${m.id}/delete`, { deleteKey });
        await load(false);
      }));
    } else if (!m.desk && !reported.has(m.id)) {
      row.push(confirmBtn("Melden", "Nogmaals klikken om te melden", async () => {
        await api(`/api/memes/${m.id}/report`, {});
        remember(reported, "reported", m.id);
        render();
      }));
    }
    return row;
  }
  function shareBtn(m) {
    const b = el("button", "btn ghost", "Link kopiëren"); b.type = "button";
    b.addEventListener("click", async () => {
      const url = location.origin + "/#m-" + m.id;
      try { await navigator.clipboard.writeText(url); b.textContent = "Gekopieerd"; }
      catch { location.hash = "m-" + m.id; b.textContent = "Kopieer de link uit de adresbalk"; }
      setTimeout(() => (b.textContent = "Link kopiëren"), 2500);
    });
    return b;
  }

  // Reply editors survive re-renders, so a refresh never eats what someone is typing.
  const replyBoxes = new Map();
  function replyBox(meme) {
    if (replyBoxes.has(meme.id)) return replyBoxes.get(meme.id);
    const wrap = el("div", "press");
    const head = el("div", "press-head");
    head.append(el("h2", null, "Reageer met een meme"));
    const close = el("button", "btn ghost", "Sluiten"); close.type = "button";
    close.addEventListener("click", () => { S.open.delete(meme.id); render(); });
    head.append(close);
    const body = el("div", "press-body");
    const left = el("div");
    const right = el("div", "field"); right.append(el("span", "label", "Voorbeeld"));
    const prev = el("div"); right.append(prev);
    body.append(left, right);
    const actions = el("div", "press-actions");
    const ai = el("button", "btn", "Laat Claude erop reageren"); ai.type = "button"; ai.hidden = !S.claude;
    const post = el("button", "btn primary", "Plaats reactie"); post.type = "button";
    const status = el("span", "status"); status.setAttribute("role", "status");
    actions.append(ai, post, status);
    wrap.append(head, body, actions);
    const comp = composer(left, (m) => { prev.textContent = ""; prev.append(renderMeme(m, "Voorbeeld van je reactie")); }, { format: "drake", scene: "fire", lines: [] });
    ai.addEventListener("click", async () => {
      ai.disabled = true; status.className = "status"; status.textContent = "Claude bedenkt een weerwoord…";
      try { comp.set((await api("/api/generate", { replyTo: meme.id })).meme); status.textContent = "Pas de tekst aan als je wilt en plaats hem."; }
      catch (e) { status.className = "status err"; status.textContent = e.message; }
      ai.disabled = false;
    });
    post.addEventListener("click", async () => {
      const nick = nickname(status); if (!nick) return;
      const m = comp.get();
      if (!m.lines.some((l) => l.trim())) { status.className = "status err"; status.textContent = "Schrijf minstens één regel."; return; }
      post.disabled = true; status.className = "status"; status.textContent = "Bezig met plaatsen…";
      try {
        const { id } = await api(`/api/memes/${meme.id}/replies`, { ...m, nickname: nick, deleteKey, turnstileToken: await turnstileToken() });
        remember(mine, "mine", id);
        comp.clear(); status.textContent = "Geplaatst.";
        await load(false);
      } catch (e) { status.className = "status err"; status.textContent = e.message; }
      post.disabled = false;
    });
    replyBoxes.set(meme.id, wrap);
    return wrap;
  }

  function render() {
    $("feed-empty").hidden = S.memes.length > 0;
    if (!S.memes.length) $("feed-empty").querySelector("span").textContent = "Nog geen memes. Pers de eerste uit een nieuwskop hierboven.";
    $("more").hidden = !S.next;
    [...feed.querySelectorAll(".batch")].forEach((n) => n.remove());
    S.memes.forEach((m) => {
      const sec = el("article", "batch" + (S.fresh.has(m.id) ? " fresh" : ""));
      sec.id = "m-" + m.id;
      const ticket = el("div", "ticket");
      ticket.append(el("div", "no", m.desk ? "NIEUWSDESK" : "PERS"));
      const txt = el("div", "txt");
      txt.append(el("span", "label", "Uit het nieuws"), el("div", "hl", m.headline || "Zonder kop"));
      const meta = el("div", "meta");
      if (m.source && /^https:\/\//.test(m.source.url)) {
        const a = el("a", null, m.source.host); a.href = m.source.url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow ugc";
        meta.append(a);
      }
      meta.append(el("span", null, "geperst door " + who(m) + " · " + ago(m.createdAt)));
      txt.append(meta);
      ticket.append(txt);
      sec.append(ticket, renderMeme(m, "Meme over " + (m.headline || "het nieuws")));

      const reps = m.replies || [];
      const head = el("div", "replies-head");
      head.append(el("span", "label", reps.length ? `${reps.length} ${reps.length === 1 ? "reactie" : "reacties"}` : "Nog geen reacties"));
      const right = el("div", "meta");
      const rb = el("button", "btn", S.open.has(m.id) ? "Verberg reactievak" : "Reageer met een meme"); rb.type = "button";
      rb.addEventListener("click", () => { S.open.has(m.id) ? S.open.delete(m.id) : S.open.add(m.id); render(); });
      right.append(rb, shareBtn(m), ...actionsFor(m));
      head.append(right);
      const repWrap = el("div", "replies");
      repWrap.append(head);
      if (S.open.has(m.id)) repWrap.append(replyBox(m));
      if (reps.length) {
        const grid = el("div", "reply-grid");
        reps.forEach((r) => {
          if (reported.has(r.id)) return;
          const c = el("div", "reply");
          c.append(renderMeme(r, "Reactie-meme"));
          const mm = el("div", "meta");
          mm.append(el("span", null, who(r) + " · " + ago(r.createdAt)), ...actionsFor(r));
          c.append(mm); grid.append(c);
        });
        repWrap.append(grid);
      }
      sec.append(repWrap);
      if (!reported.has(m.id)) feed.append(sec);
    });
    S.fresh.clear();
  }

  // A timed refresh waits while someone is typing in a reply box, so focus is never pulled away.
  let pending = false;
  function softRender() {
    if (feed.contains(document.activeElement) && document.activeElement.matches("input, select")) { pending = true; return; }
    pending = false;
    render();
  }
  feed.addEventListener("focusout", () => setTimeout(() => { if (pending) softRender(); }, 0));

  // ---------- the press ----------
  function setupPress() {
    const prev = $("np-preview"), head = $("np-headline"), url = $("np-url"), status = $("np-status"), ai = $("np-ai"), post = $("np-post");
    ai.hidden = !S.claude;
    // An untouched editor previews an example, so the first view shows what comes out of the press.
    const example = { format: "impact", scene: "stonks", lines: ["Plak een nieuwskop", S.claude ? "Claude maakt er een meme van" : "Schrijf er een grap bij"] };
    const comp = composer($("np-slot"), (m) => {
      prev.textContent = "";
      prev.append(renderMeme(m.format !== "impact" || m.lines.some((l) => l.trim()) ? m : { ...example, scene: m.scene }, "Voorbeeld"));
    }, { format: "impact", scene: "stonks", lines: [] });
    ai.addEventListener("click", async () => {
      const h = head.value.trim();
      if (!h) { status.className = "status err"; status.textContent = "Plak eerst een nieuwskop."; head.focus(); return; }
      ai.disabled = true; status.className = "status"; status.textContent = "Claude leest het nieuws…";
      try { comp.set((await api("/api/generate", { headline: h })).meme); status.textContent = "Pas de tekst aan als je wilt en zet hem op de band."; }
      catch (e) { status.className = "status err"; status.textContent = e.message; }
      ai.disabled = false;
    });
    post.addEventListener("click", async () => {
      const nick = nickname(status); if (!nick) return;
      const h = head.value.trim(), m = comp.get();
      if (!h) { status.className = "status err"; status.textContent = "Elke meme hoort bij een nieuwskop. Vul de kop in."; head.focus(); return; }
      if (!m.lines.some((l) => l.trim())) { status.className = "status err"; status.textContent = "Schrijf minstens één regel."; return; }
      post.disabled = true; status.className = "status"; status.textContent = "Bezig met persen…";
      try {
        const { id } = await api("/api/memes", { ...m, headline: h, sourceUrl: url.value.trim(), nickname: nick, deleteKey, turnstileToken: await turnstileToken() });
        remember(mine, "mine", id);
        head.value = ""; url.value = ""; comp.clear(); status.textContent = "Staat op de band.";
        await load(false);
        $("m-" + id)?.scrollIntoView({ behavior: "smooth" });
      } catch (e) { status.className = "status err"; status.textContent = e.message; }
      post.disabled = false;
    });
  }

  // ---------- boot ----------
  $("more").addEventListener("click", () => load(true));
  api("/api/config").then((c) => {
    S.claude = Boolean(c.claude);
    if (c.turnstileSiteKey) loadTurnstile(c.turnstileSiteKey);
  }).catch(() => {}).finally(() => {
    setupPress();
    load(false).then(() => { if (location.hash.startsWith("#m-")) $(location.hash.slice(1))?.scrollIntoView(); });
  });
  setInterval(() => { if (document.visibilityState === "visible") load(false); }, 30000);
  setInterval(softRender, 60000);
})();
