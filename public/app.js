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
      window.onTurnstileLoad = () => resolve(window.turnstile.render("#turnstile", { sitekey: siteKey, execution: "execute", appearance: "interaction-only", "refresh-expired": "manual" }));
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
  const SORTS = ["hot", "new", "top"];
  const S = {
    sort: SORTS.includes(store.get("sort", "hot")) ? store.get("sort", "hot") : "hot",
    memes: [], next: null, voted: new Set(), open: new Set(), fresh: new Set(), claude: true, shared: null, focus: null,
  };
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
  const linkFor = (id) => location.origin + "/m/" + id;

  // ---------- loading ----------
  async function load(mode) {
    // mode: "reset" (new sort), "more" (next page) or "poll" (refresh the first page in place)
    const page = mode === "more" ? S.next ?? 0 : 0;
    try {
      const data = await api(`/api/feed?sort=${S.sort}&page=${page}`);
      data.voted.forEach((id) => S.voted.add(id));
      if (mode === "more") {
        const have = new Set(S.memes.map((m) => m.id));
        S.memes.push(...data.memes.filter((m) => !have.has(m.id)));
        S.next = data.next;
      } else if (mode === "poll" && S.memes.length) {
        const prev = new Set(S.memes.map((m) => m.id));
        data.memes.forEach((m) => { if (!prev.has(m.id)) S.fresh.add(m.id); });
        const fresh = new Set(data.memes.map((m) => m.id));
        S.memes = [...data.memes, ...S.memes.slice(data.memes.length).filter((m) => !fresh.has(m.id))];
        if (S.next === null) S.next = data.next;
      } else {
        S.memes = data.memes;
        S.next = data.next;
      }
      softRender();
    } catch {
      if (!S.memes.length) $("feed-empty").querySelector("span").textContent = "De memes konden niet worden geladen. Ververs de pagina om het opnieuw te proberen.";
    }
  }

  async function loadShared(id) {
    try {
      const data = await api("/api/memes/" + id);
      data.voted.forEach((v) => S.voted.add(v));
      S.shared = data.meme;
      S.focus = data.focus;
      if (S.focus !== S.shared.id) S.open.add(S.shared.id);
      render();
      requestAnimationFrame(() => document.getElementById("r-" + S.focus)?.scrollIntoView({ block: "center" }) || $("shared").scrollIntoView());
    } catch (e) {
      $("shared").hidden = false;
      $("shared-slot").textContent = e.message;
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
    if (mine.has(m.id)) {
      return [confirmBtn("Verwijderen", "Nogmaals klikken om te verwijderen", async () => {
        await api(`/api/memes/${m.id}/delete`, { deleteKey });
        await load("poll");
      })];
    }
    if (!m.desk && !reported.has(m.id)) {
      return [confirmBtn("Melden", "Nogmaals klikken om te melden", async () => {
        await api(`/api/memes/${m.id}/report`, {});
        remember(reported, "reported", m.id);
        render();
      })];
    }
    return [];
  }
  function laughBtn(m, small) {
    const b = el("button", "laugh" + (small ? " sm" : "")); b.type = "button";
    const paint = () => {
      const on = S.voted.has(m.id);
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", `${on ? "Lach weghalen" : "Lachen"} (${m.score} ${m.score === 1 ? "lachje" : "lachjes"})`);
      b.textContent = "";
      b.append(el("span", "ha", "HAHA"), el("span", null, String(m.score)));
    };
    paint();
    b.addEventListener("click", async () => {
      const was = S.voted.has(m.id);
      was ? S.voted.delete(m.id) : S.voted.add(m.id);
      m.score = Math.max(0, m.score + (was ? -1 : 1));
      paint();
      if (!was) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
      try {
        const r = await api(`/api/memes/${m.id}/vote`, {});
        r.voted ? S.voted.add(m.id) : S.voted.delete(m.id);
        m.score = r.score;
      } catch {
        was ? S.voted.add(m.id) : S.voted.delete(m.id);
        m.score = Math.max(0, m.score + (was ? 1 : -1));
      }
      paint();
    });
    return b;
  }
  function shareBtn(m, headline) {
    const b = el("button", "btn ghost", "Delen"); b.type = "button";
    b.addEventListener("click", async () => {
      const url = linkFor(m.id);
      if (navigator.share) {
        try { await navigator.share({ title: "Memefabriek", text: headline ? `Meme over: ${headline}` : "Moet je zien", url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
      }
      try { await navigator.clipboard.writeText(url); b.textContent = "Link gekopieerd"; }
      catch { history.replaceState(null, "", "/m/" + m.id); b.textContent = "Kopieer de link uit de adresbalk"; }
      setTimeout(() => (b.textContent = "Delen"), 2500);
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
        if (S.shared && S.shared.id === meme.id) await loadShared(meme.id);
        await load("poll");
      } catch (e) { status.className = "status err"; status.textContent = e.message; }
      post.disabled = false;
    });
    replyBoxes.set(meme.id, wrap);
    return wrap;
  }

  function batch(m) {
    const sec = el("article", "batch" + (S.fresh.has(m.id) ? " fresh" : ""));
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

    const bar = el("div", "replies-head");
    const left = el("div", "meta"); left.append(laughBtn(m), shareBtn(m, m.headline), ...actionsFor(m));
    bar.append(left);
    sec.append(bar);

    const reps = (m.replies || []).filter((r) => !reported.has(r.id));
    const head = el("div", "replies-head");
    head.append(el("span", "label", reps.length ? `${reps.length} ${reps.length === 1 ? "reactie" : "reacties"}` : "Nog geen reacties. Wees de eerste."));
    const rb = el("button", "btn" + (reps.length ? "" : " primary"), S.open.has(m.id) ? "Verberg reactievak" : "Reageer met een meme"); rb.type = "button";
    rb.addEventListener("click", () => { S.open.has(m.id) ? S.open.delete(m.id) : S.open.add(m.id); render(); });
    head.append(rb);
    const repWrap = el("div", "replies");
    repWrap.append(head);
    if (S.open.has(m.id)) repWrap.append(replyBox(m));
    if (reps.length) {
      const grid = el("div", "reply-grid");
      const best = reps[0].score >= 2 && (reps.length === 1 || reps[0].score > reps[1].score) ? reps[0].id : null;
      reps.forEach((r) => {
        const c = el("div", "reply" + (r.id === best ? " best" : ""));
        c.id = "r-" + r.id;
        if (r.id === best) c.append(el("span", "crown", "Beste reactie"));
        c.append(renderMeme(r, "Reactie-meme"));
        const mm = el("div", "meta");
        mm.append(laughBtn(r, true), el("span", null, who(r) + " · " + ago(r.createdAt)), ...actionsFor(r));
        c.append(mm); grid.append(c);
      });
      repWrap.append(grid);
    }
    sec.append(repWrap);
    return sec;
  }

  function render() {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.sort === S.sort)));
    $("shared").hidden = !S.shared;
    $("shared-slot").textContent = "";
    if (S.shared) $("shared-slot").append(batch(S.shared));
    const shown = S.memes.filter((m) => !reported.has(m.id) && !(S.shared && m.id === S.shared.id));
    $("feed-empty").hidden = shown.length > 0;
    if (!shown.length) $("feed-empty").querySelector("span").textContent = S.sort === "top" ? "Deze week heeft nog niemand gelachen. Begin jij?" : "Nog geen memes. Pers de eerste uit een nieuwskop hierboven.";
    $("more").hidden = !S.next;
    [...feed.querySelectorAll(".batch")].forEach((n) => n.remove());
    shown.forEach((m) => { const b = batch(m); b.id = "m-" + m.id; feed.append(b); });
    S.fresh.clear();
  }

  // A timed refresh waits while someone is typing in a reply box, so focus is never pulled away.
  let pending = false;
  function softRender() {
    const a = document.activeElement;
    if (a && a.matches("input, select") && (feed.contains(a) || $("shared").contains(a))) { pending = true; return; }
    pending = false;
    render();
  }
  document.addEventListener("focusout", () => setTimeout(() => { if (pending) softRender(); }, 0));

  // ---------- side column ----------
  let press = null;
  async function loadNews() {
    const list = $("news");
    try {
      const { stories } = await api("/api/news");
      list.textContent = "";
      if (!stories.length) { list.append(el("li", "muted", "Het nieuws kon niet worden opgehaald. Plak zelf een kop.")); return; }
      stories.forEach((s) => {
        const li = el("li");
        const b = el("button"); b.type = "button";
        b.append(el("span", "t", s.title), el("span", "h", s.host));
        b.addEventListener("click", () => press && press.use(s));
        li.append(b); list.append(li);
      });
    } catch { list.textContent = ""; list.append(el("li", "muted", "Het nieuws kon niet worden opgehaald. Plak zelf een kop.")); }
  }
  async function loadLeaders() {
    const list = $("leaders");
    try {
      const { leaders } = await api("/api/leaders");
      list.textContent = "";
      if (!leaders.length) { list.append(el("li", "muted", "Nog niemand deze week. De troon is vrij.")); return; }
      leaders.forEach((l, i) => {
        const li = el("li");
        li.append(el("span", "rank", String(i + 1)), el("span", "n", l.nickname), el("span", "s", `${l.laughs} ${l.laughs === 1 ? "lachje" : "lachjes"}`));
        list.append(li);
      });
    } catch { list.textContent = ""; list.append(el("li", "muted", "De ranglijst kon niet worden geladen.")); }
  }

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
    async function write() {
      const h = head.value.trim();
      if (!h) { status.className = "status err"; status.textContent = "Plak eerst een nieuwskop."; head.focus(); return; }
      ai.disabled = true; status.className = "status"; status.textContent = "Claude leest het nieuws…";
      try { comp.set((await api("/api/generate", { headline: h })).meme); status.textContent = "Pas de tekst aan als je wilt en zet hem op de band."; }
      catch (e) { status.className = "status err"; status.textContent = e.message; }
      ai.disabled = false;
    }
    ai.addEventListener("click", write);
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
        if (S.sort !== "new") { S.sort = "new"; store.set("sort", "new"); }
        await load("reset");
        $("m-" + id)?.scrollIntoView({ behavior: "smooth" });
      } catch (e) { status.className = "status err"; status.textContent = e.message; }
      post.disabled = false;
    });
    return {
      use(story) {
        head.value = story.title; url.value = story.url;
        $("press").scrollIntoView({ behavior: "smooth", block: "start" });
        status.className = "status";
        status.textContent = S.claude ? "Kop ingevuld. Schrijf zelf de grap, of laat Claude het doen." : "Kop ingevuld. Schrijf nu de grap.";
        head.focus({ preventScroll: true });
      },
    };
  }

  // ---------- boot ----------
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    if (S.sort === t.dataset.sort) return;
    S.sort = t.dataset.sort; store.set("sort", S.sort);
    S.memes = []; S.next = null; render();
    load("reset");
  }));
  $("more").addEventListener("click", () => load("more"));
  render();
  api("/api/config").then((c) => {
    S.claude = Boolean(c.claude);
    if (c.turnstileSiteKey) loadTurnstile(c.turnstileSiteKey);
  }).catch(() => {}).finally(() => {
    press = setupPress();
    const shared = location.pathname.match(/^\/m\/([0-9a-f-]{36})$/) || location.hash.match(/^#m-([0-9a-f-]{36})$/);
    if (shared) loadShared(shared[1]);
    load("reset");
    loadNews();
    loadLeaders();
  });
  setInterval(() => { if (document.visibilityState === "visible") load("poll"); }, 30000);
  setInterval(() => { if (document.visibilityState === "visible") loadLeaders(); }, 300000);
  setInterval(softRender, 60000);
})();
