/* ==========================================================
   INDEPENDENT — addresses and car routes for the chosen city (window.GEO)
   Geocoding: Nominatim (OpenStreetMap), always bounded to the city's box,
     ≤ 1 request per second, typing debounced, results cached in localStorage.
   Routing: OSRM demo server (driving), cached; a gently curved line if it fails.
   Both are free public services for light use: © OpenStreetMap contributors (ODbL).
   No API keys. Nothing here throws: offline / errors come back as { error }.
   ========================================================== */
(function () {
  "use strict";

  const NOMINATIM = "https://nominatim.openstreetmap.org/";
  const OSRM = "https://router.project-osrm.org/route/v1/driving/";
  const PREFIX = "ind2.geo.";
  const TTL = 30 * 864e5;                       // cached answers live 30 days

  /* ---------------- tiny helpers (no Leaflet needed) ---------------- */
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const ll = (p) => (Array.isArray(p) ? p : [p.lat, p.lng]);
  function haversine(a, b) {
    a = ll(a); b = ll(b);
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function measure(pts) {
    let t = 0;
    for (let i = 1; i < pts.length; i++) t += haversine(pts[i - 1], pts[i]);
    return t;
  }
  // point `m` metres from p toward bearing `deg` (clockwise from north)
  function offset(p, m, deg) {
    p = ll(p);
    const kx = Math.cos(rad(p[0])) * 111320, b = rad(deg);
    return [p[0] + Math.cos(b) * m / 110540, p[1] + Math.sin(b) * m / kx];
  }
  // gentle arc a → b (used while the real street route is loading, or when routing fails)
  function curve(a, b, n) {
    a = ll(a); b = ll(b); n = n || 24;
    const kx = Math.cos(rad(a[0])) * 111320, KY = 110540;
    const dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * KY, bend = 0.12;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = Math.sin(Math.PI * t) * bend;
      const x = dx * t - dy * s, y = dy * t + dx * s;
      out.push([+(a[0] + y / KY).toFixed(6), +(a[1] + x / kx).toFixed(6)]);
    }
    return out;
  }
  // Douglas–Peucker until the line has at most `max` points
  function simplify(pts, max) {
    max = max || 250;
    if (pts.length <= max) return pts;
    const kx = Math.cos(rad(pts[0][0]));
    const dist = (p, a, b) => {
      const ax = a[1] * kx, ay = a[0], bx = b[1] * kx, by = b[0], px = p[1] * kx, py = p[0];
      const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
      return Math.hypot(px - ax - t * dx, py - ay - t * dy);
    };
    let eps = 0.000005, out = pts;
    while (out.length > max && eps < 0.01) {
      const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
      const stack = [[0, pts.length - 1]];
      while (stack.length) {
        const [i, j] = stack.pop();
        let k = -1, dm = eps;
        for (let m = i + 1; m < j; m++) { const d = dist(pts[m], pts[i], pts[j]); if (d > dm) { dm = d; k = m; } }
        if (k > 0) { keep[k] = 1; stack.push([i, k], [k, j]); }
      }
      out = pts.filter((_, i) => keep[i]);
      eps *= 1.6;
    }
    return out;
  }
  function inBounds(p, bounds) {
    if (!bounds) return true;
    p = ll(p);
    return p[0] >= bounds[0][0] && p[0] <= bounds[1][0] && p[1] >= bounds[0][1] && p[1] <= bounds[1][1];
  }

  /* ---------------- cache ---------------- */
  const mem = {};
  function cget(k) {
    if (mem[k]) return mem[k];
    try {
      const v = JSON.parse(localStorage.getItem(PREFIX + k) || "null");
      if (v && Date.now() - v.t < TTL) return (mem[k] = v.d);
    } catch (e) { /* ignore */ }
    return null;
  }
  function cset(k, d) {
    mem[k] = d;
    try { localStorage.setItem(PREFIX + k, JSON.stringify({ t: Date.now(), d })); } catch (e) { /* full: memory only */ }
  }

  /* ---------------- Nominatim queue: at most one request per second ---------------- */
  let chain = Promise.resolve(), lastAt = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
  function getJSON(url, ms) {
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => ac && ac.abort(), ms || 10000);
    return fetch(url, { signal: ac ? ac.signal : undefined, headers: { Accept: "application/json" }, referrerPolicy: "strict-origin-when-cross-origin" })
      .then((r) => { clearTimeout(timer); if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .catch((e) => { clearTimeout(timer); throw e; });
  }
  // stale(): the caller no longer needs the answer (the user typed on) — skipped without spending a slot
  function nominatim(path, params, stale) {
    const job = chain.then(async () => {
      if (stale && stale()) return { skipped: true };
      const gap = lastAt + 1100 - Date.now();
      if (gap > 0) await wait(gap);
      if (stale && stale()) return { skipped: true };
      lastAt = Date.now();
      const qs = Object.keys(params).map((k) => k + "=" + encodeURIComponent(params[k])).join("&");
      try { return { data: await getJSON(NOMINATIM + path + "?" + qs) }; }
      catch (e) { return { error: "error" }; }
    });
    chain = job.catch(() => null);
    return job;
  }

  /* ---------------- address normalisation ---------------- */
  const LET = "a-zа-яёәғқңөұүһі";
  const fold = (s) => String(s || "").toLowerCase().replace(/ё/g, "е")
    .replace(/[әғқңөұүһі]/g, (c) => ({ ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и" })[c]);
  // street-type words (RU + KK) → the full Russian word Nominatim knows best
  const TYPES = [
    [/^(ул|ул\.|улица|улицы|улице|улицу|көше|көшесі|көшесіне|көшесіндегі|к-сі|к\.)$/, "улица"],
    [/^(пр|пр\.|пр-т|пр-т\.|просп|просп\.|проспект|проспекта|проспекте|проспекту|даңғылы|даңғылына|даңғ|даңғ\.)$/, "проспект"],
    [/^(мкр|мкр\.|микрорайон|микрорайона|микрорайоне|м-н|шағынаудан|шағынауданы|шағын|ш\.а\.)$/, "микрорайон"],
    [/^(пер|пер\.|переулок|переулка|тұйық)$/, "переулок"],
    [/^(б-р|бульвар|бульвара|желекжол|желекжолы)$/, "бульвар"],
    [/^(ш\.|шоссе|тас-жолы)$/, "шоссе"]
  ];
  const NOISE = /^(дом|д\.|д|үй|үйі|г\.|город|город[еа]|қаласы|қ\.|в|во|на|до|к|по|из|от|адрес|мекенжай)$/;
  function parse(input, cityRx) {
    let s = " " + String(input || "").replace(/[ \s]+/g, " ") + " ";
    let flat = "";
    // apartment goes to its own field: «кв. 5», «квартира 12», «5-пәтер», «пәтер 5»
    s = s.replace(new RegExp("[,\\s]+(кв\\.?|квартира|кв-ра|пәтер)\\s*(\\d+[" + LET + "]?)(?![" + LET + "\\d])", "gi"), (m, a, n) => { flat = n; return " "; });
    s = s.replace(new RegExp("[,\\s]+(\\d+[" + LET + "]?)\\s*-?\\s*пәтер[" + LET + "]*", "gi"), (m, n) => { flat = n; return " "; });
    if (cityRx) s = s.replace(new RegExp("(^|[\\s,])(г\\.\\s*)?(" + cityRx + ")[" + LET + "-]*(\\s+қаласы)?", "gi"), " ");
    s = s.replace(/№/g, " ").replace(/тас\s+жолы/gi, " тас-жолы ");
    const toks = s.replace(/,/g, " , ").split(" ").filter(Boolean);
    let type = "";
    const rest = [], nums = [];
    const HRX = new RegExp("^(?:д\\.)?(\\d+[а-яa-z]?(?:/\\d+[а-яa-z]?)?)(?:-?(?:[" + LET + "]{1,4}))?$", "i");
    toks.forEach((tk) => {
      const low = tk.toLowerCase();
      if (tk === ",") return;
      const ty = TYPES.find(([rx]) => rx.test(low));
      if (ty) { if (!type) type = ty[1]; return; }
      if (NOISE.test(low)) return;
      // «150», «150а», «150/1», «150-ге», «д.5»
      const hm = HRX.exec(low);
      if (hm) { nums.push(rest.length); rest.push({ n: hm[1] }); return; }
      rest.push(tk.replace(/^[«"“]|[»"”.]$/g, ""));
    });
    // the last number is the house; earlier ones belong to the name («Самал 2, 25»)
    let house = "";
    if (nums.length) { const i = nums[nums.length - 1]; house = rest[i].n; rest.splice(i, 1); }
    for (let i = 0; i < rest.length; i++) if (typeof rest[i] === "object") rest[i] = rest[i].n;
    const core = rest.join(" ").replace(/\s+/g, " ").trim();
    return { core, house, type, flat };
  }
  // longest word of the street name, cut a little so declension still matches («Абая» / «Абай»)
  function stemOf(core) {
    const w = fold(core).split(/[\s-]+/).filter((x) => x.length > 2 && !/^\d+$/.test(x)).sort((a, b) => b.length - a.length)[0] || fold(core);
    return w.length > 4 ? w.slice(0, w.length - 2) : w.slice(0, Math.max(3, w.length - 1));
  }

  /* ---------------- result parsing ---------------- */
  const ROADS = /^(road|street|residential|primary|secondary|tertiary|unclassified|living_street|service|pedestrian|trunk|footway|highway)$/;
  function toResult(r) {
    const a = r.address || {};
    const road = a.road || a.pedestrian || a.footway || a.square || "";
    const house = a.house_number || "";
    const area = a.neighbourhood || a.quarter || a.residential || a.suburb || "";
    let label;
    if (house) label = (road || area || r.name || "") + ", " + house;
    else if (r.name && !ROADS.test(r.addresstype || r.type)) label = r.name + (road && road !== r.name ? ", " + road : "");
    else label = road || r.name || String(r.display_name || "").split(",")[0];
    const district = [a.suburb && a.suburb !== area ? a.suburb : "", a.city_district, area && area !== label ? area : ""].filter(Boolean)
      .filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 2).join(", ");
    const kind = house ? "house" : (r.category === "highway" || ROADS.test(r.addresstype || "")) ? "street" : "poi";
    return { lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6), label: label.replace(/^,\s*/, ""), full: r.display_name || label, district, kind, house, road, id: r.place_id };
  }
  const sameHouse = (a, b) => {
    a = fold(a).replace(/\s/g, ""); b = fold(b).replace(/\s/g, "");
    return a === b || a.split(/[;,]/).includes(b);
  };

  /* ---------------- search ---------------- */
  let lang = "ru";
  function setLang(l) { lang = l === "kk" ? "kk" : "ru"; }
  function city(id) { const K = window.KZ; return K && K.cities && K.cities[id] ? K.cities[id] : null; }

  // variants tried one by one (≤ 1 req/s) until one gives a good answer
  function variants(p) {
    const c = p.core, h = p.house ? " " + p.house : "";
    const out = [];
    const add = (x) => { x = x.replace(/\s+/g, " ").trim(); if (x && !out.includes(x)) out.push(x); };
    const T = p.type;
    if (T === "улица") [T, "проспект", ""].forEach((x) => add(x + " " + c + h));
    else if (T === "проспект") [T, "улица", ""].forEach((x) => add(x + " " + c + h));
    else if (T) [T, ""].forEach((x) => add(x + " " + c + h));
    else ["", "проспект", "улица"].forEach((x) => add(x + " " + c + h));
    return out.slice(0, 3);
  }

  async function search(query, cityId, opts) {
    opts = opts || {};
    const C = city(cityId);
    const p = parse(query, C ? C.rx : "");
    if (!p.core && !p.house) return { list: [], parsed: p };
    const key = "s." + cityId + "." + lang + "." + fold((p.type || "") + "|" + p.core + "|" + p.house);
    const hit = cget(key);
    if (hit) return { list: hit, parsed: p, cached: true };
    if (offline()) return { list: [], parsed: p, error: "offline" };
    const b = C ? C.bounds : null;
    const base = { format: "jsonv2", addressdetails: 1, countrycodes: "kz", limit: 6, "accept-language": lang };
    if (b) Object.assign(base, { viewbox: [b[0][1], b[0][0], b[1][1], b[1][0]].join(","), bounded: 1 });
    const cname = C ? C.name.ru : "";
    const stem = stemOf(p.core);
    const good = (r) => {
      const hay = fold((r.road || "") + " " + r.label + " " + r.full);
      const nameOk = !stem || hay.includes(stem);
      return nameOk && (!p.house || sameHouse(r.house, p.house));
    };
    let all = [], error = null;
    const tries = variants(p);
    // a house number was typed but no variant has it: show the street itself (approximate)
    if (p.house && p.core) tries.push((p.type || "") + " " + p.core);
    for (let i = 0; i < tries.length; i++) {
      if (i === tries.length - 1 && p.house && all.some(good)) break;
      const res = await nominatim("search", Object.assign({}, base, { q: tries[i] + (cname ? ", " + cname : "") }), opts.stale);
      if (res.skipped) return { list: [], parsed: p, skipped: true };
      if (res.error) { error = res.error; break; }
      (res.data || []).map(toResult).filter((r) => inBounds([r.lat, r.lng], b)).forEach((r) => {
        const dup = all.some((x) => x.id === r.id || haversine(x, r) < 25 || (fold(x.label) === fold(r.label) && haversine(x, r) < 400));
        if (!dup) all.push(r);
      });
      if (all.some(good)) break;
    }
    if (error && !all.length) return { list: [], parsed: p, error };
    // best first: exact house on the named street → the named street → anything else
    const score = (r) => (good(r) ? 0 : (stem && fold(r.road + " " + r.label).includes(stem)) ? 1 : 2) * 10 + (p.house ? (r.kind === "house" ? 0 : 1) : (r.kind === "street" ? 0 : 1));
    all.forEach((r) => { r.good = good(r); r.score = score(r); });
    all.sort((x, y) => x.score - y.score);
    // one row per street when only streets were found
    const seen = {};
    all = all.filter((r) => { if (r.kind !== "street") return true; const k = fold(r.road || r.label); if (seen[k]) return false; seen[k] = 1; return true; });
    // the typed street and house were found: other streets with the same number only confuse
    if (all.some((r) => r.good)) all = all.filter((r) => r.good || (r.score < 20 && r.kind !== "house"));
    if (p.house) all.forEach((r) => { if (r.kind !== "house") r.approx = true; });
    const list = all.slice(0, 6);
    if (!error) cset(key, list);
    return { list, parsed: p, error };
  }

  // live suggestions while typing: debounced (700 ms, ≥ 3 letters), stale answers dropped
  function suggester(onResult, ms) {
    let timer = null, gen = 0;
    return function (query, cityId) {
      clearTimeout(timer);
      const my = ++gen;
      const q = String(query || "").trim();
      if (q.replace(/[^0-9a-zа-яёәғқңөұүһі]/gi, "").length < 3) { onResult(null, q); return; }
      timer = setTimeout(() => {
        search(q, cityId, { stale: () => my !== gen }).then((r) => { if (my === gen && !r.skipped) onResult(r, q); });
      }, ms || 700);
    };
  }

  async function reverse(lat, lng) {
    const key = "v." + lang + "." + lat.toFixed(4) + "," + lng.toFixed(4);
    const hit = cget(key);
    if (hit) return hit;
    if (offline()) return null;
    const res = await nominatim("reverse", { format: "jsonv2", addressdetails: 1, zoom: 18, lat: lat.toFixed(6), lon: lng.toFixed(6), "accept-language": lang });
    if (!res.data || res.data.error) return null;
    const r = toResult(res.data);
    r.lat = lat; r.lng = lng;           // keep the user's own point
    cset(key, r);
    return r;
  }

  /* ---------------- OSRM: driving route ---------------- */
  let rchain = Promise.resolve(), rlast = 0;
  const pendingR = {};
  function routeKey(a, b) { a = ll(a); b = ll(b); return "r." + [a[0], a[1], b[0], b[1]].map((x) => (+x).toFixed(5)).join(","); }
  function approx(a, b) {
    const pts = curve(a, b, 24), len = Math.round(measure(pts) * 1.25);
    return { pts, len, dur: Math.round(len / 7), approx: true };
  }
  function cachedRoute(a, b) { return cget(routeKey(a, b)); }
  function route(a, b) {
    const key = routeKey(a, b);
    const hit = cget(key);
    if (hit) return Promise.resolve(hit);
    if (pendingR[key]) return pendingR[key];
    if (offline()) return Promise.resolve(approx(a, b));
    const A = ll(a), B = ll(b);
    const job = rchain.then(async () => {
      const gap = rlast + 300 - Date.now();
      if (gap > 0) await wait(gap);
      rlast = Date.now();
      try {
        const d = await getJSON(OSRM + A[1].toFixed(6) + "," + A[0].toFixed(6) + ";" + B[1].toFixed(6) + "," + B[0].toFixed(6) + "?overview=full&geometries=geojson", 12000);
        const r0 = d && d.code === "Ok" && d.routes && d.routes[0];
        if (!r0 || !r0.geometry || !r0.geometry.coordinates.length) throw new Error("no route");
        let pts = r0.geometry.coordinates.map((c) => [+c[1].toFixed(6), +c[0].toFixed(6)]);
        // the pins sit on the exact points; the street line starts where the router snapped them
        pts = simplify([A].concat(pts, [B]), 250);
        const out = { pts, len: Math.round(r0.distance), dur: Math.round(r0.duration) };
        cset(key, out);
        return out;
      } catch (e) { return approx(a, b); }
      finally { delete pendingR[key]; }
    });
    rchain = job.catch(() => null);
    return (pendingR[key] = job);
  }

  window.GEO = { search, suggester, reverse, route, cachedRoute, approx, parse, setLang, haversine, measure, offset, curve, simplify, inBounds, fold };
})();
