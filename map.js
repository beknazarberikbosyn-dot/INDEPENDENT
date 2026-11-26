/* ==========================================================
   INDEPENDENT — «Живая карта Алматы»
   Leaflet 1.9.4 (cdnjs, SRI-pinned) + CARTO basemap on OpenStreetMap data.
   Loaded lazily: if Leaflet or the tiles do not load (offline, blocked),
   the screens keep their decorative SVG and nothing breaks.
   Geometry helpers below work without Leaflet (used by the trip simulation).
   ========================================================== */
(function () {
  "use strict";

  const CDN = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
  const SRI = {
    css: "sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==",
    js: "sha512-BwHfrr4c9kmRkLw6iXFdzcdWV/PGkVgiIyIWLLlTSXzWQzxuSg4DiQUCpauz/EWjgk5TYQqX/kvn9pG1NpYfqg=="
  };
  const TILES = "https://{s}.basemaps.cartocdn.com/{style}/{z}/{x}/{y}{r}.png";
  const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> · <a href="https://overturemaps.org" target="_blank" rel="noopener">Overture Maps</a>';
  const ALMATY = [[43.02, 76.55], [43.48, 77.3]];

  const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const reduce = mq("(prefers-reduced-motion: reduce)");
  const coarse = mq("(pointer: coarse)");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------------- Lazy loading of Leaflet ---------------- */
  let loading = null;
  function load() {
    if (loading) return loading;
    loading = new Promise((resolve) => {
      if (window.L && window.L.map) return resolve(true);
      let left = 2, ok = true, done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(!!(v && window.L && window.L.map)); };
      const timer = setTimeout(() => finish(false), 15000);
      const one = (good) => { ok = ok && good; if (--left === 0) finish(ok); };
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = CDN + "leaflet.css";
      css.integrity = SRI.css; css.crossOrigin = "anonymous"; css.referrerPolicy = "no-referrer";
      css.onload = () => one(true); css.onerror = () => one(false);
      // before our stylesheet, so styles.css can restyle Leaflet
      const ours = document.querySelector('link[rel="stylesheet"][href^="styles.css"]');
      document.head.insertBefore(css, ours || null);
      const js = document.createElement("script");
      js.src = CDN + "leaflet.js"; js.async = true;
      js.integrity = SRI.js; js.crossOrigin = "anonymous"; js.referrerPolicy = "no-referrer";
      js.onload = () => one(true); js.onerror = () => one(false);
      document.head.appendChild(js);
    });
    return loading;
  }

  /* ---------------- Geometry (no Leaflet needed) ---------------- */
  const KX = Math.cos(43.24 * Math.PI / 180) * 111320, KY = 110540;
  const dist = (a, b) => Math.hypot((b[1] - a[1]) * KX, (b[0] - a[0]) * KY);
  function measure(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return { pts, cum, total: cum[cum.length - 1] || 0 };
  }
  function seg(m, d) { // index i so that cum[i] <= d <= cum[i+1]
    let lo = 0, hi = m.pts.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (m.cum[mid] <= d) lo = mid; else hi = mid - 1; }
    return Math.max(0, lo);
  }
  function pointAt(m, d) {
    if (m.pts.length < 2) return m.pts[0];
    d = Math.max(0, Math.min(m.total, d));
    const i = seg(m, d), L = m.cum[i + 1] - m.cum[i], t = L ? (d - m.cum[i]) / L : 0;
    const a = m.pts[i], b = m.pts[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  function headingAt(m, d) { // degrees clockwise from north
    const a = pointAt(m, Math.max(0, d - 14)), b = pointAt(m, Math.min(m.total, d + 14));
    return Math.atan2((b[1] - a[1]) * KX, (b[0] - a[0]) * KY) * 180 / Math.PI;
  }
  function slice(m, d0, d1) {
    d0 = Math.max(0, d0); d1 = Math.min(m.total, d1);
    if (d1 <= d0 || m.pts.length < 2) return [];
    const out = [pointAt(m, d0)];
    for (let i = 0; i < m.pts.length; i++) if (m.cum[i] > d0 && m.cum[i] < d1) out.push(m.pts[i]);
    out.push(pointAt(m, d1));
    return out;
  }

  /* ---------------- Icons ---------------- */
  const CAR_SVG = '<svg viewBox="0 0 26 44" aria-hidden="true">' +
    '<rect x="1" y="9" width="3" height="5" rx="1.5" fill="#d9e2df"/><rect x="22" y="9" width="3" height="5" rx="1.5" fill="#d9e2df"/>' +
    '<rect x="3" y="1.5" width="20" height="41" rx="8.5" fill="#fff" stroke="#0c302b" stroke-width="1.4"/>' +
    '<rect x="5" y="2.8" width="5" height="2.4" rx="1.2" fill="#fff3bf"/><rect x="16" y="2.8" width="5" height="2.4" rx="1.2" fill="#fff3bf"/>' +
    '<path d="M6 13.5 Q13 9.5 20 13.5 L19 18.5 H7 Z" fill="#164a42"/>' +
    '<path d="M7 31 H19 L20 35.5 Q13 38.5 6 35.5 Z" fill="#164a42"/>' +
    '<rect x="7" y="19.5" width="12" height="10.5" rx="2.5" fill="#eef3f1"/>' +
    '<rect x="9" y="22.6" width="8" height="4.2" rx="1.4" fill="#f2b531"/>' +
    '<rect x="5" y="40" width="4" height="1.6" rx=".8" fill="#e0533a"/><rect x="17" y="40" width="4" height="1.6" rx=".8" fill="#e0533a"/></svg>';
  const BUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M4 11h16M8 21v-3M16 21v-3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="8.5" cy="14.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="14.5" r="1.3" fill="currentColor"/></svg>';
  const FIT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';

  function divIcon(cls, html) {
    return window.L.divIcon({ className: "lm-icon " + cls, html, iconSize: [0, 0], iconAnchor: [0, 0] });
  }
  const ICON = {
    pinA: (label) => divIcon("lm-pin lm-pin-a", (label ? `<span class="lm-label">${esc(label)}</span>` : "") + '<span class="lm-dot"></span>'),
    pinB: (label) => divIcon("lm-pin lm-pin-b", '<span class="lm-halo"></span><span class="lm-dot"></span>' + (label ? `<span class="lm-label">${esc(label)}</span>` : "")),
    stop: (label) => divIcon("lm-stop" + (label ? " major" : ""), '<span class="lm-stop-dot"></span>' + (label ? `<span class="lm-label lm-label-stop">${esc(label)}</span>` : "")),
    car: () => divIcon("lm-car", `<span class="lm-car-rot">${CAR_SVG}</span><span class="lm-tag" hidden></span>`),
    bus: (num) => divIcon("lm-bus", `<span class="lm-bus-dot"></span><span class="lm-bus-pill">${BUS_SVG}<b>${esc(num)}</b></span>`)
  };

  const STYLE = {
    casing:  { color: "#0b2925", weight: 15, opacity: 0.72 },
    mid:     { color: "#1f6a5f", weight: 9, opacity: 0.95 },
    dots:    { color: "#f2b531", weight: 5.5, opacity: 1, dashArray: "1 13", className: "lm-march" },
    done:    { color: "#f2b531", weight: 3, opacity: 0.45 },
    pickup:  { color: "#ffffff", weight: 3.5, opacity: 0.75, dashArray: "6 9" },
    walk:    { color: "#ffffff", weight: 5, opacity: 0.95, dashArray: "1 10" },
    busCase: { color: "#0b2925", weight: 13, opacity: 0.72 },
    bus:     { color: "#7fb6ea", weight: 7, opacity: 1 },
    approach:{ color: "#a9cdef", weight: 3.5, opacity: 0.55, dashArray: "5 9" }
  };

  /* ---------------- Map view ---------------- */
  function create(el, opts) {
    opts = opts || {};
    const L = window.L;
    const map = L.map(el, {
      zoomControl: false, attributionControl: false,
      scrollWheelZoom: false,               // enabled after a click / focus (desktop)
      dragging: !coarse, touchZoom: true,   // phones: one finger scrolls the page, two fingers zoom
      doubleClickZoom: true, keyboard: true, boxZoom: false,
      zoomSnap: 0.25, zoomDelta: 1, wheelPxPerZoomLevel: 110,
      minZoom: 11, maxZoom: 18, maxBounds: ALMATY, maxBoundsViscosity: 0.9,
      fadeAnimation: !reduce, zoomAnimation: !reduce, markerZoomAnimation: !reduce, inertia: !reduce
    }).setView([43.238, 76.93], 13);

    map.createPane("labels");
    const lp = map.getPane("labels");
    lp.style.zIndex = 390; lp.style.pointerEvents = "none";

    const base = L.tileLayer(TILES, { style: "dark_nolabels", subdomains: "abcd", maxZoom: 18, attribution: ATTR, className: "lm-base" }).addTo(map);
    L.tileLayer(TILES, { style: "dark_only_labels", subdomains: "abcd", maxZoom: 18, pane: "labels", className: "lm-labels" }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(map);

    let loads = 0, errors = 0, failed = false;
    base.on("tileload", () => { if (failed) return; if (!loads++ && opts.onReady) opts.onReady(); });
    base.on("tileerror", () => {
      errors++;
      if (!loads && errors >= 4 && !failed) { failed = true; if (opts.onFail) opts.onFail(); }
    });

    // Large, high-contrast controls: zoom in / out / show the whole route
    const labels = { zoomIn: "+", zoomOut: "−", fit: "fit" };
    const btns = {};
    const Ctl = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const box = L.DomUtil.create("div", "lm-ctl");
        [["zoomIn", "+", () => map.zoomIn()], ["zoomOut", "−", () => map.zoomOut()], ["fit", FIT_SVG, () => view.refit(true)]].forEach(([k, html, fn]) => {
          const b = L.DomUtil.create("button", "lm-btn lm-" + k, box);
          b.type = "button"; b.innerHTML = html;
          L.DomEvent.on(b, "click", (e) => { L.DomEvent.stop(e); fn(); });
          btns[k] = b;
        });
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.disableScrollPropagation(box);
        return box;
      }
    });
    map.addControl(new Ctl());

    // Desktop: the wheel scrolls the page until the user clicks / focuses the map
    const hint = document.createElement("div");
    hint.className = "lm-hint"; hint.setAttribute("aria-hidden", "true");
    el.appendChild(hint);
    let hintTimer;
    const wheelOn = () => { if (!map.scrollWheelZoom.enabled()) map.scrollWheelZoom.enable(); el.classList.add("lm-wheel"); hint.classList.remove("on"); };
    const wheelOff = () => { map.scrollWheelZoom.disable(); el.classList.remove("lm-wheel"); };
    if (!coarse) {
      el.addEventListener("click", wheelOn);
      el.addEventListener("focus", wheelOn);
      el.addEventListener("mouseleave", wheelOff);
      el.addEventListener("blur", wheelOff);
      el.addEventListener("wheel", () => {
        if (map.scrollWheelZoom.enabled()) return;
        hint.textContent = labels.hint || "";
        hint.classList.add("on");
        clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.remove("on"), 1600);
      }, { passive: true });
    }

    // small zoom → hide stop names to keep the map calm
    const zoomClass = () => el.classList.toggle("lm-far", map.getZoom() < 14.75);
    map.on("zoomend", zoomClass); zoomClass();

    const insets = { top: 12, right: 12, bottom: 12, left: 12 };
    let lastFit = null;
    const sized = () => el.clientWidth > 60 && el.clientHeight > 60;

    const view = {
      map, el,
      get ready() { return loads > 0 && !failed; },
      group() { return L.layerGroup().addTo(map); },
      line(group, pts, style, extra) { return L.polyline(pts, Object.assign({ interactive: false, lineCap: "round", lineJoin: "round" }, STYLE[style], extra || {})).addTo(group); },
      marker(group, pt, icon, z) { return L.marker(pt, { icon, interactive: false, keyboard: false, zIndexOffset: z || 0 }).addTo(group); },
      icon: ICON,
      style: STYLE,
      setLabels(o) {
        Object.assign(labels, o);
        Object.keys(btns).forEach((k) => { if (labels[k]) { btns[k].setAttribute("aria-label", labels[k]); btns[k].title = labels[k]; } });
      },
      setInsets(o) {
        Object.assign(insets, o);
        el.style.setProperty("--lm-top", insets.top + "px");
        el.style.setProperty("--lm-bottom", insets.bottom + "px");
        el.style.setProperty("--lm-right", insets.right + "px");
      },
      invalidate() { if (sized()) map.invalidateSize({ pan: false, animate: false }); },
      fit(pts, animate, maxZoom) {
        lastFit = { pts, maxZoom };
        if (!sized() || !pts || !pts.length) return;
        const b = L.latLngBounds(pts);
        if (!b.isValid()) return;
        const w = el.clientWidth, h = el.clientHeight;
        // labels sit above pins (top), controls on the right
        const side = Math.round(Math.min(72, el.clientWidth * 0.11));
        let top = insets.top + 46, bottom = insets.bottom + 48, left = insets.left + side, right = insets.right + side + 6;
        const sy = Math.max(0, top + bottom - (h - 90)), sx = Math.max(0, left + right - (w - 90));
        if (sy) { top -= sy / 2; bottom -= sy / 2; }
        if (sx) { left -= sx / 2; right -= sx / 2; }
        const o = { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom], maxZoom: maxZoom || 16.25 };
        if (animate && !reduce) map.flyToBounds(b, Object.assign(o, { duration: 0.9, easeLinearity: 0.3 }));
        else map.fitBounds(b, Object.assign(o, { animate: false }));
      },
      refit(animate) { if (lastFit) view.fit(lastFit.pts, animate, lastFit.maxZoom); }
    };
    return view;
  }

  /* Rotate a car marker toward its heading without spinning the long way round */
  function rotate(marker, deg) {
    const elx = marker.getElement && marker.getElement();
    if (!elx) return;
    const r = elx.querySelector(".lm-car-rot");
    if (!r) return;
    const prev = marker._lmDeg == null ? deg : marker._lmDeg;
    let d = ((deg - prev) % 360 + 540) % 360 - 180;
    marker._lmDeg = prev + d;
    r.style.transform = "rotate(" + marker._lmDeg.toFixed(1) + "deg)";
  }
  function tag(marker, text) {
    const elx = marker.getElement && marker.getElement();
    if (!elx) return;
    const t = elx.querySelector(".lm-tag");
    if (!t) return;
    if (!text) { t.hidden = true; return; }
    if (t.textContent !== text) t.textContent = text;
    t.hidden = false;
  }

  window.LiveMap = { load, create, measure, pointAt, headingAt, slice, rotate, tag, reduce, coarse };
})();
