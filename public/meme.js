// Draws memes and the meme editor. Shared by the feed and the moderation page.
// Every visitor string reaches the page through textContent, never as markup.
window.MemeKit = (() => {
  const FORMATS = {
    impact: { name: "Boven- en ondertekst", fields: ["Bovenste tekst", "Onderste tekst"], scene: true },
    drake: { name: "Nee / Ja", fields: ["Nee tegen…", "Ja tegen…"] },
    brain: { name: "Groeiend brein", fields: ["Klein brein", "Groter brein", "Stralend brein", "Galaxybrein"] },
    nobody: { name: "Niemand:", fields: ["Wie", "Doet wat"] },
    expect: { name: "Verwachting / Werkelijkheid", fields: ["Verwachting", "Werkelijkheid"], scene: true },
  };
  const SCENES = { fire: "Alles staat in brand", stonks: "Grafiek die keldert", rain: "Regenwolk", spotlight: "Spotlight", space: "De ruimte" };
  const MAXLEN = 120;
  const SVGNS = "http://www.w3.org/2000/svg";

  const SCENE_SVG = {
    fire: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0a05"/><stop offset="1" stop-color="#8a1f0a"/></linearGradient></defs>
      <rect width="100" height="100" fill="url(#g)"/>
      <rect x="0" y="70" width="100" height="30" fill="#3a1408"/>
      <g fill="#ff7a1a"><path d="M2 100 C4 80 12 78 10 62 C18 72 20 84 24 100Z"/><path d="M22 100 C22 82 32 74 30 56 C40 70 44 86 44 100Z"/><path d="M58 100 C56 84 64 76 62 58 C72 72 76 88 76 100Z"/><path d="M76 100 C78 84 88 80 86 64 C96 76 98 90 98 100Z"/></g>
      <g fill="#ffd23a"><path d="M8 100 C9 88 14 86 13 76 C18 84 19 92 20 100Z"/><path d="M28 100 C28 90 34 84 33 72 C39 82 40 92 40 100Z"/><path d="M62 100 C62 90 67 86 66 74 C72 84 72 92 72 100Z"/><path d="M82 100 C83 90 88 88 87 78 C93 86 94 94 94 100Z"/></g>
      <g fill="#120705"><rect x="44" y="64" width="16" height="3"/><rect x="45" y="67" width="2" height="12"/><rect x="57" y="67" width="2" height="12"/><circle cx="52" cy="56" r="6"/><rect x="47" y="61" width="10" height="4" rx="2"/><rect x="61" y="58" width="5" height="6" rx="1"/></g>`,
    stonks: `<rect width="100" height="100" fill="#0b1630"/>
      <g stroke="#1f3463" stroke-width=".4">${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${10 + i * 10} H100"/><path d="M${10 + i * 10} 0 V100"/>`).join("")}</g>
      <polyline points="4,22 18,30 28,24 40,46 52,40 64,64 74,58 90,84" fill="none" stroke="#ff4040" stroke-width="3" stroke-linejoin="round"/>
      <path d="M90 84 L82 84 L90 76Z" fill="#ff4040" stroke="#ff4040" stroke-width="2" stroke-linejoin="round"/>`,
    rain: `<rect width="100" height="100" fill="#3d4652"/>
      <g fill="#7d8896"><circle cx="34" cy="30" r="12"/><circle cx="50" cy="24" r="15"/><circle cx="66" cy="31" r="11"/><rect x="24" y="30" width="52" height="12" rx="6"/></g>
      <g stroke="#a9c4e6" stroke-width="1.2" stroke-linecap="round">${Array.from({ length: 14 }, (_, i) => `<path d="M${22 + (i % 7) * 9 + (i > 6 ? 4 : 0)} ${50 + (i > 6 ? 16 : 0)} l-3 9"/>`).join("")}</g>
      <rect x="0" y="88" width="100" height="12" fill="#2b323b"/>`,
    spotlight: `<defs><radialGradient id="s" cx=".5" cy="1" r=".7"><stop offset="0" stop-color="#fff4c2" stop-opacity=".9"/><stop offset="1" stop-color="#fff4c2" stop-opacity="0"/></radialGradient></defs>
      <rect width="100" height="100" fill="#2a1240"/>
      <path d="M44 0 H56 L82 86 H18Z" fill="url(#s)"/>
      <ellipse cx="50" cy="88" rx="32" ry="6" fill="#fff4c2" opacity=".55"/>
      <path d="M50 54 l4 9 10 1 -8 6 3 10 -9 -6 -9 6 3 -10 -8 -6 10 -1Z" fill="#ffd23a"/>`,
    space: `<rect width="100" height="100" fill="#06060f"/>
      <g fill="#fff">${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 37) % 100}" cy="${(i * 53) % 100}" r="${i % 5 ? 0.35 : 0.7}"/>`).join("")}</g>
      <circle cx="66" cy="62" r="18" fill="#5b4bd6"/><circle cx="60" cy="56" r="18" fill="#7b6cf0" opacity=".5"/>
      <ellipse cx="66" cy="62" rx="30" ry="6" fill="none" stroke="#c9b8ff" stroke-width="1.6" transform="rotate(-18 66 62)"/>`,
  };

  let uid = 0;
  function svg(inner) {
    const s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 100 100");
    s.setAttribute("preserveAspectRatio", "xMidYMid slice");
    s.setAttribute("aria-hidden", "true");
    const id = "s" + ++uid;
    s.innerHTML = inner.replace(/id="(\w)"/g, `id="$1${id}"`).replace(/url\(#(\w)\)/g, `url(#$1${id})`);
    return s;
  }
  const sceneEl = (name) => { const s = svg(SCENE_SVG[name] || SCENE_SVG.spotlight); s.classList.add("scene"); return s; };
  const verdictSvg = (yes) => svg(yes
    ? `<rect width="100" height="100" fill="#d9f2e2"/><circle cx="50" cy="50" r="30" fill="#1f8a4c"/><path d="M36 51 l10 10 18 -22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<rect width="100" height="100" fill="#f8dcd6"/><circle cx="50" cy="50" r="30" fill="#c8321c"/><path d="M38 38 L62 62 M62 38 L38 62" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`);
  function brainSvg(level) {
    const bg = ["#1a1a22", "#1d2440", "#25307a", "#3b1f7a"][level];
    const glow = [0, 0.35, 0.7, 1][level];
    const r = 14 + level * 3;
    return svg(`<defs><radialGradient id="b"><stop offset="0" stop-color="#ffe9a8" stop-opacity="${glow}"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient></defs>
      <rect width="100" height="100" fill="${bg}"/>
      ${level === 3 ? Array.from({ length: 18 }, (_, i) => `<circle cx="${(i * 41) % 100}" cy="${(i * 29) % 100}" r=".6" fill="#fff"/>`).join("") : ""}
      <circle cx="50" cy="50" r="${r * 2.4}" fill="url(#b)"/>
      <ellipse cx="50" cy="50" rx="${r * 1.25}" ry="${r}" fill="${level ? "#f6b6c8" : "#c98d9c"}"/>
      <path d="M${50 - r * 0.9} ${50 - r * 0.2} q${r * 0.3} ${-r * 0.6} ${r * 0.6} 0 t${r * 0.6} 0 t${r * 0.6} 0 M${50 - r * 0.8} ${50 + r * 0.35} q${r * 0.3} ${-r * 0.5} ${r * 0.55} 0 t${r * 0.55} 0 t${r * 0.55} 0 M50 ${50 - r} V${50 + r}" fill="none" stroke="#8a3d55" stroke-width="1.6" stroke-linecap="round"/>`);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const sizeFor = (text, base) => { const n = (text || "").length; return n > 90 ? base * 0.55 : n > 60 ? base * 0.68 : n > 34 ? base * 0.82 : base; };

  function cleanMeme(m) {
    const format = FORMATS[m && m.format] ? m.format : "impact";
    const scene = SCENES[m && m.scene] ? m.scene : "spotlight";
    const raw = Array.isArray(m && m.lines) ? m.lines : [];
    const lines = FORMATS[format].fields.map((_, i) => String(raw[i] ?? "").slice(0, MAXLEN));
    return { format, scene, lines };
  }

  function render(input, label) {
    const m = cleanMeme(input);
    const L = m.lines;
    const box = el("div", "meme m-" + m.format);
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", (label ? label + ": " : "") + L.filter(Boolean).join(" / "));
    if (m.format === "impact") {
      box.append(sceneEl(m.scene));
      const t = el("div", "cap top", L[0]); t.style.fontSize = sizeFor(L[0], 10) + "cqi";
      const b = el("div", "cap bot", L[1]); b.style.fontSize = sizeFor(L[1], 10) + "cqi";
      box.append(t, b);
    } else if (m.format === "drake") {
      [0, 1].forEach((i) => {
        const p = el("div", "panel");
        const pic = el("div", "pic"); pic.append(verdictSvg(i === 1));
        const say = el("div", "say", L[i]); say.style.fontSize = sizeFor(L[i], 6.4) + "cqi";
        p.append(pic, say); box.append(p);
      });
    } else if (m.format === "brain") {
      [0, 1, 2, 3].forEach((i) => {
        const p = el("div", "panel");
        const say = el("div", "say", L[i]); say.style.fontSize = sizeFor(L[i], 4.6) + "cqi";
        const pic = el("div", "pic"); pic.append(brainSvg(i));
        p.append(say, pic); box.append(p);
      });
    } else if (m.format === "nobody") {
      const a = el("div", "ln"); a.append(el("b", null, "Niemand:"));
      const b = el("div", "ln"); b.append(el("b", null, "Helemaal niemand:"));
      const c = el("div", "ln"); c.append(el("b", null, (L[0] || "Ik") + ": "), document.createTextNode(L[1]));
      c.style.fontSize = sizeFor(L[1], 6.4) + "cqi";
      box.append(a, b, el("div", "gap"), c);
    } else if (m.format === "expect") {
      ["Verwachting", "Werkelijkheid"].forEach((tag, i) => {
        const p = el("div", "panel");
        const pic = el("div", "pic"); pic.append(sceneEl(i === 0 ? "spotlight" : m.scene === "spotlight" ? "rain" : m.scene));
        const cap = el("div", "cap", L[i]); cap.style.fontSize = sizeFor(L[i], 7) + "cqi";
        p.append(pic, el("span", "tag", tag), cap); box.append(p);
      });
    }
    box.append(el("span", "wm", "MEMEFABRIEK.NL"));
    return box;
  }

  function composer(slot, onChange, initial) {
    const node = document.getElementById("composer-tpl").content.firstElementChild.cloneNode(true);
    const id = "c" + ++uid;
    const fmt = node.querySelector('[data-k="fmt"]');
    const scene = node.querySelector('[data-k="scene"]');
    const linesBox = node.querySelector('[data-k="lines"]');
    const sceneField = node.querySelector("[data-scene-field]");
    fmt.id = id + "-fmt"; scene.id = id + "-scene";
    node.querySelector('[data-for="fmt"]').htmlFor = fmt.id;
    node.querySelector('[data-for="scene"]').htmlFor = scene.id;
    for (const [k, f] of Object.entries(FORMATS)) fmt.append(new Option(f.name, k));
    for (const [k, s] of Object.entries(SCENES)) scene.append(new Option(s, k));
    let state = cleanMeme(initial);
    function buildLines() {
      linesBox.textContent = "";
      FORMATS[state.format].fields.forEach((label, i) => {
        const f = el("div", "field");
        const lab = el("label", "label", label); lab.htmlFor = `${id}-l${i}`;
        const inp = document.createElement("input");
        inp.type = "text"; inp.id = `${id}-l${i}`; inp.maxLength = MAXLEN; inp.value = state.lines[i] || "";
        inp.addEventListener("input", () => { state.lines[i] = inp.value; onChange(get()); });
        f.append(lab, inp); linesBox.append(f);
      });
      sceneField.hidden = !FORMATS[state.format].scene;
    }
    const get = () => cleanMeme(state);
    function set(m) { state = cleanMeme(m); fmt.value = state.format; scene.value = state.scene; buildLines(); onChange(get()); }
    fmt.addEventListener("change", () => { state = cleanMeme({ ...state, format: fmt.value }); buildLines(); onChange(get()); });
    scene.addEventListener("change", () => { state.scene = scene.value; onChange(get()); });
    slot.append(node);
    set(state);
    return { get, set, clear() { set({ format: state.format, scene: state.scene, lines: [] }); } };
  }

  return { render, composer, el, cleanMeme };
})();
