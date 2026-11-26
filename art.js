/* INDEPENDENT — hand-drawn style SVG illustrations (no external images).
   ART.staff[kind]  -> portrait of the specialist (viewBox 0 0 160 160)
   ART.food[key]    -> grocery item (viewBox 0 0 120 120) */
(function () {
  "use strict";
  const INK = "#13241f";

  function svg(vb, body, label) {
    return `<svg viewBox="${vb}" role="img" aria-label="${label || ""}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  }

  /* ---------------- Portraits ---------------- */
  // Shared face: eyes, brows, nose, smile. `y` shifts the face vertically.
  function face(skin, opts) {
    const o = Object.assign({ brow: INK, smile: true, lashes: false }, opts || {});
    return `
      <ellipse cx="80" cy="74" rx="27" ry="31" fill="${skin}"/>
      <ellipse cx="53" cy="77" rx="5" ry="7" fill="${skin}"/><ellipse cx="107" cy="77" rx="5" ry="7" fill="${skin}"/>
      <path d="M64 66q5-4 10 0M86 66q5-4 10 0" fill="none" stroke="${o.brow}" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="69" cy="74" rx="3" ry="3.6" fill="${INK}"/><ellipse cx="91" cy="74" rx="3" ry="3.6" fill="${INK}"/>
      <circle cx="70" cy="73" r="1" fill="#fff"/><circle cx="92" cy="73" r="1" fill="#fff"/>
      ${o.lashes ? '<path d="M64 71l-2-2M96 71l2-2" stroke="' + INK + '" stroke-width="1.6" stroke-linecap="round"/>' : ""}
      <path d="M80 77q-3 8 1 10" fill="none" stroke="rgba(19,36,31,.35)" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="62" cy="85" r="5" fill="#e8786a" opacity=".22"/><circle cx="98" cy="85" r="5" fill="#e8786a" opacity=".22"/>
      ${o.smile ? '<path d="M70 92q10 8 20 0" fill="none" stroke="' + INK + '" stroke-width="2.8" stroke-linecap="round"/>' : ""}`;
  }
  function body(color, collar, neck) {
    return `
      <path d="M71 98h18v14H71z" fill="${neck}"/>
      <path d="M28 160c2-30 22-46 52-46s50 16 52 46z" fill="${color}"/>
      <path d="M66 112l14 14 14-14" fill="none" stroke="${collar}" stroke-width="4" stroke-linejoin="round"/>`;
  }
  function badge(bg, icon) {
    return `<g transform="translate(116 112)"><circle r="20" fill="${bg}" stroke="#fffdf7" stroke-width="4"/>${icon}</g>`;
  }

  const staff = {
    plumber: svg("0 0 160 160", `
      <circle cx="80" cy="80" r="80" fill="#a9cdef"/>
      ${body("#2f5d8a", "#f2b531", "#c79066")}
      <path d="M48 160v-34M112 160v-34" stroke="#244a6f" stroke-width="7"/>
      <path d="M53 72c-2-26 12-38 27-38s30 10 27 38c-4-10-10-16-27-16s-23 6-27 16z" fill="#1d1a17"/>
      ${face("#d9a77c", {})}
      <path d="M68 88q12 6 24 0q-2 6-12 6t-12-6z" fill="#1d1a17"/>
      ${badge("#f2b531", '<path d="M-8 8l9-9M2-2a6 6 0 1 0 6-6l-3 3 3 3 3-3" fill="none" stroke="#13241f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>')}
    `, "Сантехник"),

    electric: svg("0 0 160 160", `
      <circle cx="80" cy="80" r="80" fill="#f6dfa0"/>
      ${body("#e8772e", "#f6eedc", "#d8a77f")}
      <path d="M44 132l14 28M116 132l-14 28" stroke="#f6eedc" stroke-width="6"/>
      ${face("#e0b088", {})}
      <path d="M50 62c0-22 14-34 30-34s30 12 30 34z" fill="#f2b531"/>
      <path d="M44 62h72" stroke="#d99a12" stroke-width="7" stroke-linecap="round"/>
      <path d="M80 30v30" stroke="#d99a12" stroke-width="4"/>
      ${badge("#0f3a34", '<path d="M3-11L-7 2h7l-3 10 10-14H0z" fill="#f2b531"/>')}
    `, "Электрик"),

    cleaning: svg("0 0 160 160", `
      <circle cx="80" cy="80" r="80" fill="#9fd8c6"/>
      ${body("#2a8a76", "#fffdf7", "#e0ad86")}
      <path d="M80 126v34" stroke="#fffdf7" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round"/>
      ${face("#e6b993", { lashes: true })}
      <path d="M48 80c-6-34 10-52 32-52s38 18 32 52c-2-18-12-30-32-30s-30 12-32 30z" fill="#c8401f"/>
      <path d="M52 62q28-22 56 0" fill="none" stroke="#f2b531" stroke-width="3" stroke-dasharray="1 7" stroke-linecap="round"/>
      <path d="M50 78c-6 16-2 26 6 30M110 78c6 16 2 26-6 30" fill="none" stroke="#c8401f" stroke-width="8" stroke-linecap="round"/>
      ${badge("#f5b5a1", '<path d="M-4-12v13M-9 1h10l3 10H-12z" fill="#13241f" stroke="#13241f" stroke-width="2" stroke-linejoin="round"/>')}
    `, "Уборка"),

    handy: svg("0 0 160 160", `
      <circle cx="80" cy="80" r="80" fill="#f5b5a1"/>
      ${body("#a8321a", "#13241f", "#c48d63")}
      <path d="M40 140h80M36 152h88M60 116v44M100 116v44" stroke="#7d2413" stroke-width="3" opacity=".55"/>
      <path d="M53 70c-1-24 11-34 27-34s28 10 27 34c-4-8-11-13-27-13s-23 5-27 13z" fill="#b9b4ab"/>
      ${face("#cf9b70", { brow: "#8f8a80" })}
      <path d="M56 84c2 22 12 30 24 30s22-8 24-30c-4 8-10 10-24 10s-20-2-24-10z" fill="#c9c4ba"/>
      <path d="M70 94q10 6 20 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      ${badge("#0f3a34", '<path d="M-9 9l11-11M-2-10l8 8-4 4-8-8z" fill="#f2b531" stroke="#f2b531" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>')}
    `, "Мастер")
  };

  /* ---------------- Groceries ---------------- */
  const plate = (bg) => `<rect x="4" y="4" width="112" height="112" rx="28" fill="${bg}"/><ellipse cx="60" cy="98" rx="38" ry="7" fill="rgba(19,36,31,.10)"/>`;
  const food = {
    bread: svg("0 0 120 120", plate("#f6dfa0") + `
      <path d="M22 76c0-24 16-38 38-38s38 14 38 38c0 10-6 16-16 16H38c-10 0-16-6-16-16z" fill="#c9782e"/>
      <path d="M28 70c4-18 16-26 32-26s28 8 32 26" fill="none" stroke="#a85d1d" stroke-width="3"/>
      <path d="M42 58l8 10M56 52l8 10M70 54l8 10" stroke="#f6dfa0" stroke-width="4" stroke-linecap="round"/>`, "Хлеб"),
    milk: svg("0 0 120 120", plate("#d9ebf8") + `
      <path d="M40 40l8-14h24l8 14v52a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6z" fill="#fffdf7" stroke="#2f5d8a" stroke-width="3" stroke-linejoin="round"/>
      <path d="M40 40h40" stroke="#2f5d8a" stroke-width="3"/>
      <path d="M40 66q10-6 20 0t20 0v26a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6z" fill="#a9cdef"/>
      <circle cx="60" cy="54" r="6" fill="#2f5d8a"/>`, "Молоко"),
    kefir: svg("0 0 120 120", plate("#e4f3ec") + `
      <path d="M46 24h28v10l6 10v48a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V44l6-10z" fill="#fffdf7" stroke="#1f7a5c" stroke-width="3" stroke-linejoin="round"/>
      <rect x="44" y="18" width="32" height="10" rx="3" fill="#1f7a5c"/>
      <rect x="40" y="56" width="40" height="22" fill="#9fd8c6"/>
      <path d="M48 67h24" stroke="#1f7a5c" stroke-width="3" stroke-linecap="round"/>`, "Кефир"),
    eggs: svg("0 0 120 120", plate("#fbe9d6") + `
      <path d="M18 70h84l-6 22H24z" fill="#b8a48a"/>
      <ellipse cx="38" cy="64" rx="11" ry="14" fill="#fffdf7" stroke="#d8c3a5" stroke-width="2"/>
      <ellipse cx="60" cy="60" rx="11" ry="14" fill="#f3d8b4" stroke="#d8c3a5" stroke-width="2"/>
      <ellipse cx="82" cy="64" rx="11" ry="14" fill="#fffdf7" stroke="#d8c3a5" stroke-width="2"/>
      <path d="M24 80h72" stroke="#9a8670" stroke-width="3"/>`, "Яйца"),
    sugar: svg("0 0 120 120", plate("#f3eee6") + `
      <path d="M34 34h52l4 60H30z" fill="#fffdf7" stroke="#8f8a80" stroke-width="3" stroke-linejoin="round"/>
      <path d="M34 34l6-10h40l6 10" fill="#e9e3d8" stroke="#8f8a80" stroke-width="3" stroke-linejoin="round"/>
      <rect x="40" y="54" width="40" height="20" rx="4" fill="#c8401f"/>
      <rect x="50" y="88" width="10" height="10" rx="2" fill="#fff" stroke="#c9c4ba" stroke-width="2" transform="rotate(-12 55 93)"/>`, "Сахар"),
    tea: svg("0 0 120 120", plate("#e4f3ec") + `
      <path d="M28 52h52v18a26 26 0 0 1-52 0z" fill="#fffdf7" stroke="#0f3a34" stroke-width="3"/>
      <path d="M80 58h8a9 9 0 0 1 0 18h-10" fill="none" stroke="#0f3a34" stroke-width="3"/>
      <path d="M32 58h44" stroke="#b5481f" stroke-width="7" opacity=".75"/>
      <path d="M46 44c-4-6 4-8 0-14M60 44c-4-6 4-8 0-14" fill="none" stroke="#5c6a64" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M40 70q14 8 28 0" fill="none" stroke="#f2b531" stroke-width="3" stroke-dasharray="1 6" stroke-linecap="round"/>`, "Чай"),
    butter: svg("0 0 120 120", plate("#fff3d6") + `
      <path d="M20 74l12-16h60l8 16v12H20z" fill="#2a8a76"/>
      <path d="M34 50h48l10 14H28z" fill="#f6d36b" stroke="#d99a12" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M28 64h64v12H28z" fill="#f2c84b"/>`, "Масло"),
    potato: svg("0 0 120 120", plate("#efe4d2") + `
      <ellipse cx="46" cy="70" rx="22" ry="17" fill="#c9995e"/>
      <ellipse cx="76" cy="64" rx="20" ry="15" fill="#d8ab70"/>
      <ellipse cx="64" cy="82" rx="18" ry="12" fill="#b9874f"/>
      <circle cx="40" cy="66" r="2" fill="#8a6136"/><circle cx="52" cy="74" r="2" fill="#8a6136"/><circle cx="80" cy="60" r="2" fill="#8a6136"/><circle cx="66" cy="84" r="2" fill="#8a6136"/>`, "Картофель"),
    apple: svg("0 0 120 120", plate("#fbe0d6") + `
      <path d="M60 40c-8-6-30-6-32 18-2 22 14 38 24 38 4 0 6-2 8-2s4 2 8 2c10 0 26-16 24-38-2-24-24-24-32-18z" fill="#c8401f"/>
      <path d="M40 54q2-8 10-10" fill="none" stroke="#f5b5a1" stroke-width="4" stroke-linecap="round"/>
      <path d="M60 40c0-8 2-14 6-18" fill="none" stroke="#5a3a1c" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M64 30c8-8 18-6 20-2-6 6-14 6-20 2z" fill="#2a8a76"/>`, "Яблоки"),
    beef: svg("0 0 120 120", plate("#fbe0d6") + `
      <path d="M26 64c0-18 18-30 38-28s32 14 30 30-18 28-38 26-30-12-30-28z" fill="#b53a2a"/>
      <path d="M36 62c6-10 18-14 30-12s20 10 18 18" fill="none" stroke="#f3cfc0" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="70" cy="74" rx="8" ry="6" fill="#f3e6dc"/>
      <circle cx="70" cy="74" r="3" fill="#d8c3a5"/>`, "Говядина"),
    chicken: svg("0 0 120 120", plate("#fff3d6") + `
      <path d="M30 70c0-16 14-28 34-28s28 14 26 26c-2 14-14 24-32 24-16 0-28-8-28-22z" fill="#e2a45c"/>
      <path d="M84 56l14-12M92 42a5 5 0 1 0 6 6" fill="none" stroke="#e2a45c" stroke-width="7" stroke-linecap="round"/>
      <path d="M92 42a5 5 0 1 0 6 6" fill="#fffdf7" stroke="#d8c3a5" stroke-width="2"/>
      <path d="M40 66q10-10 24-8" fill="none" stroke="#f6d39b" stroke-width="4" stroke-linecap="round"/>`, "Курица"),
    rice: svg("0 0 120 120", plate("#f3eee6") + `
      <path d="M22 66h76c0 18-16 30-38 30S22 84 22 66z" fill="#2a8a76"/>
      <path d="M26 66c2-14 16-22 34-22s32 8 34 22z" fill="#fffdf7"/>
      <path d="M40 58l4-2M52 52l4 1M64 56l4-2M76 60l4 1M58 62l3 2M46 62l4 0" stroke="#d8c3a5" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M30 76q30 10 60 0" fill="none" stroke="#f2b531" stroke-width="3" stroke-dasharray="1 7" stroke-linecap="round"/>`, "Рис")
  };

  window.ART = { staff, food };
})();
