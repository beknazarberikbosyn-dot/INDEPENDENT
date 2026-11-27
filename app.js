/* ==========================================================
   INDEPENDENT — mobile prototype logic
   1. RU / KK speech recognition (Web Speech API) + auto language detection
   2. AI assistant that understands a request and opens the right category
   3. Services: taxi, groceries, route, home services (masters / cleaning)
   4. Relative mode: the adult who registered the user sets contacts,
      services and a monthly limit, and acts as a safety net
      (help calls in order, approval of orders over the limit).
   All orders, calls and payments are simulated.
   ========================================================== */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const store = {
    get(k, d) { try { const v = localStorage.getItem("ind2." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ind2." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  /* ==========================================================
     State
     ========================================================== */
  const DEFAULTS = {
    contacts: [
      { id: "m", ru: "Мадина, дочь", kk: "Мадина, қызы", short: { ru: "Мадине", kk: "Мадинаға" }, phone: "+7 701 ··· ·· 21", av: "М", color: "salmon" },
      { id: "e", ru: "Ерлан, сын", kk: "Ерлан, ұлы", short: { ru: "Ерлану", kk: "Ерланға" }, phone: "+7 777 ··· ·· 08", av: "Е", color: "blue" }
    ],
    services: { taxi: true, food: true, services: false },
    limit: 20000,
    spent: 12400,
    askOverLimit: true,
    seeOrders: false,
    city: "almaty"
  };
  const saved = store.get("settings", {});
  const state = {
    lang: store.get("lang", "ru"),
    screen: "home",
    settings: Object.assign({}, DEFAULTS, saved, { services: Object.assign({}, DEFAULTS.services, saved.services || {}) }),
    log: store.get("log", []),
    taxi: { dest: "home", status: "draft", quote: null, ride: null, phase: "wait" },
    trip: { from: null, to: null },       // own «Откуда / Куда» typed by the user (current city only)
    food: { items: null, status: "draft", quote: null },
    route: { dest: "clinic", quote: null },
    services: { kind: "plumber", status: "draft", quote: null }
  };
  const save = () => { store.set("settings", state.settings); store.set("log", state.log.slice(0, 30)); };

  const L = (ru, kk) => (state.lang === "kk" ? kk : ru);
  const t = (key) => {
    const d = window.I18N[state.lang] || window.I18N.ru;
    const v = d[key] != null ? d[key] : (window.I18N.ru[key] || key);
    return String(v).replace(/\{name\}/g, userName());
  };
  const money = (n) => n.toLocaleString("ru-RU").replace(/\s/g, " ") + " ₸";
  const first = () => state.settings.contacts[0];

  /* ==========================================================
     Profile (first-run registration, editable any time)
     ========================================================== */
  // Who the contact is: forms used on screen and in speech (dative needs no declension of the name)
  const REL = {
    daughter:      { ru: { nom: "дочь", dat: "дочери", to: "К дочери" }, kk: { nom: "қызы", dat: "қызыңызға", to: "Қызыма" }, fem: true, words: "доч|қыз" },
    son:           { ru: { nom: "сын", dat: "сыну", to: "К сыну" }, kk: { nom: "ұлы", dat: "ұлыңызға", to: "Ұлыма" }, words: "сын|ұл" },
    granddaughter: { ru: { nom: "внучка", dat: "внучке", to: "К внучке" }, kk: { nom: "немересі", dat: "немереңізге", to: "Немереме" }, fem: true, words: "внуч|немере" },
    grandson:      { ru: { nom: "внук", dat: "внуку", to: "К внуку" }, kk: { nom: "немересі", dat: "немереңізге", to: "Немереме" }, words: "внук|немере" },
    spouse:        { ru: { nom: "супруг(а)", dat: "супругу", to: "К супругу" }, kk: { nom: "жұбайы", dat: "жұбайыңызға", to: "Жұбайыма" }, words: "муж|жен[аеуы]|супруг|жұбай|күйеу|әйел" },
    sister:        { ru: { nom: "сестра", dat: "сестре", to: "К сестре" }, kk: { nom: "әпкесі", dat: "әпкеңізге", to: "Әпкеме" }, fem: true, words: "сестр|әпке|сіңлі|қарындас" },
    brother:       { ru: { nom: "брат", dat: "брату", to: "К брату" }, kk: { nom: "бауыры", dat: "бауырыңызға", to: "Бауырыма" }, words: "брат|бауыр|аға|іні" },
    other:         { ru: { nom: "близкий человек", dat: "близкому", to: "К близким" }, kk: { nom: "жақыны", dat: "жақыныңызға", to: "Жақындарыма" }, words: "близк|родн|жақын|туыс" },
    // a care-centre employee registered the user (role "staff"): the centre is the first to call
    centre:        { ru: { nom: "центр ухода", dat: "центру ухода", to: "В центр ухода" }, kk: { nom: "күтім орталығы", dat: "күтім орталығына", to: "Орталыққа" }, words: "центр|орталы|күтім" }
  };
  // Who filled in the registration: the elderly person, a guardian / relative, or a care-centre employee
  const ROLES = {
    self:     { ru: "сам(а) пользователь", kk: "пайдаланушының өзі" },
    guardian: { ru: "опекун / родственник", kk: "қамқоршы / туыс" },
    staff:    { ru: "сотрудник центра ухода", kk: "күтім орталығының қызметкері" }
  };
  const DEMO_PROFILE = {
    demo: true, role: "self", name: "Айгуль", lang: "ru", city: "almaty", home: "", flat: "",
    contacts: [{ name: "Мадина", rel: "daughter", phone: "+7 701 000 00 21", addr: "" }, { name: "Ерлан", rel: "son", phone: "+7 777 000 00 08", addr: "" }]
  };
  const profile = () => state.settings.profile || DEMO_PROFILE;
  const userName = () => profile().name || "";
  const roleOf = () => (profile().role && ROLES[profile().role] ? profile().role : "self");
  const escRx = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function buildContacts(pf) {
    return pf.contacts.filter((c) => c && c.name).map((c, i) => {
      const r = REL[c.rel] || REL.other;
      const org = c.org ? ` «${c.org}»` : "";
      return { id: "c" + i, name: c.name, rel: c.rel, fem: !!r.fem, addr: c.addr || "", geo: c.geo || null, org: c.org || "", me: !!c.me,
        ru: `${c.name}, ${r.ru.nom}${org}`, kk: `${c.name}, ${r.kk.nom}${org}`, short: { ru: r.ru.dat, kk: r.kk.dat },
        phone: c.phone || "—", av: c.name.trim().charAt(0).toUpperCase(), color: ["salmon", "blue", "mint"][i % 3] };
    });
  }
  // matches «позвони Мадине», «позвони дочке», «қызыма қоңырау шал»
  const contactRx = (c) => new RegExp(`(${escRx(c.name.toLowerCase().slice(0, Math.max(3, c.name.length - 2)))}|${(REL[c.rel] || REL.other).words})`, "i");
  state.settings.contacts = buildContacts(profile());
  // Relatives' verbs: «Мадина одобрила» / «Ерлан одобрил»
  const verb = (c, ru) => (c && c.fem === false ? ru.replace(/а$/, "") : ru);

  /* ==========================================================
     Data
     ========================================================== */
  const DEST = {
    // Real Almaty addresses (default city); other cities replace ru/kk/from/stop from cities.js.
    // Prices, ETA and bus numbers stay the same in every city (they are spoken by recorded clips).
    // Map coordinates and street routes live in routes.js (Almaty) and routes-<city>.js
    home:   { rx: /(дом|домой|үй)/i, ru: "Дом — ул. Римского-Корсакова, 21, кв. 34", kk: "Үй — Римский-Корсаков к-сі, 21, 34-пәтер", chip: { ru: "Домой", kk: "Үйге" }, price: 1400, eta: 4, bus: 37, from: { ru: "«Аманжолова»", kk: "«Аманжолов»" }, stop: { ru: "«Габдулина»", kk: "«Ғабдуллин»" } },
    clinic: { rx: /(поликлиник|больниц|врач|клиник|емхана|аурухана|дәрігер)/i, ru: "Поликлиника №4 — ул. Торайгырова, 16", kk: "№4 емхана — Торайғыров к-сі, 16", chip: { ru: "В поликлинику", kk: "Емханаға" }, price: 1100, eta: 5, bus: 12, from: { ru: "«Габдулина»", kk: "«Ғабдуллин»" }, stop: { ru: "«Поликлиника №4»", kk: "«№4 емхана»" } },
    kid:    { rx: /(доч|мадин|қызым|қызыма|қызға)/i, ru: "Мадина (дочь) — мкр. Самал-2, 25", kk: "Мадина (қызы) — Самал-2, 25", chip: { ru: "К дочери", kk: "Қызыма" }, price: 1900, eta: 6, bus: 92, from: { ru: "«Аксакова»", kk: "«Ақсақов»" }, stop: { ru: "«Самал»", kk: "«Самал»" } },
    market: { rx: /(рын(ок|ку)|базар)/i, ru: "Зелёный базар — ул. Жибек Жолы, 53", kk: "Көк базар — Жібек жолы к-сі, 53", chip: { ru: "На базар", kk: "Базарға" }, price: 1600, eta: 7, bus: 63, from: { ru: "«Габдулина»", kk: "«Ғабдуллин»" }, stop: { ru: "«Зелёный базар»", kk: "«Көк базар»" } }
  };
  const ORIGIN = { ru: "ул. Кабанбай батыра, 12", kk: "Қабанбай батыр к-сі, 12" };
  const HOME_SHORT = { ru: "Дом — ул. Римского-Корсакова, 21", kk: "Үй — Римский-Корсаков к-сі, 21" };

  /* Cities of Kazakhstan (cities.js): the same destinations with each city's own addresses and stops */
  const KZ = window.KZ && window.KZ.cities ? window.KZ : null;
  const CITY_IDS = KZ ? KZ.order : ["almaty"];
  if (!CITY_IDS.includes(state.settings.city)) state.settings.city = "almaty";
  const cityOf = (id) => (KZ && KZ.cities[id || state.settings.city]) || null;
  const cityName = (id) => { const c = cityOf(id); return c ? L(c.name.ru, c.name.kk) : "Алматы"; };
  function cityTexts(id) {
    const c = cityOf(id);
    if (!c) return;
    Object.keys(DEST).forEach((k) => { const d = c.dest[k]; if (d) Object.assign(DEST[k], { ru: d.ru, kk: d.kk, from: d.from, stop: d.stop }); });
    Object.assign(ORIGIN, c.origin);
    Object.assign(HOME_SHORT, c.homeShort);
    applyProfile();
  }
  // The registered user's own home and relative replace the city's demo addresses (map pins stay in that district)
  function applyProfile() {
    const pf = profile();
    if (pf.home) {
      DEST.home.ru = "Дом — " + pf.home + (pf.flat ? ", кв. " + pf.flat : "");
      DEST.home.kk = "Үй — " + pf.home + (pf.flat ? ", " + pf.flat + "-пәтер" : "");
      HOME_SHORT.ru = "Дом — " + pf.home; HOME_SHORT.kk = "Үй — " + pf.home;
    }
    const c0 = state.settings.contacts[0];
    if (c0) {
      const r = REL[c0.rel] || REL.other;
      const tail = (x) => x.split(" — ").slice(1).join(" — ") || x;
      DEST.kid.ru = `${c0.name} (${r.ru.nom}) — ${c0.addr || tail(DEST.kid.ru)}`;
      DEST.kid.kk = `${c0.name} (${r.kk.nom}) — ${c0.addr || tail(DEST.kid.kk)}`;
      DEST.kid.chip = { ru: r.ru.to, kk: r.kk.to };
      DEST.kid.rx = contactRx(c0);
    }
  }
  cityTexts(state.settings.city);
  const CITY_RX = CITY_IDS.filter((id) => cityOf(id)).map((id) => [id, new RegExp(cityOf(id).rx, "i")]);
  const findCity = (s) => { const hit = CITY_RX.find(([, rx]) => rx.test(s)); return hit ? hit[0] : null; };
  // «я в Астане», «город Шымкент», «переключи на Караганду», «Астанадамын», «Шымкентте тұрамын»
  const CITY_INTENT = /(^|\s)(я|мы)\s+(сейчас\s+|уже\s+|живу\s+|теперь\s+)?(в|во)\s|город|переключ|смени|поменяй|выбери|нахожусь|живу|приехал|(да|де|та|те)(мын|мін|мыз|міз)(?![а-яёәғқңөұүһі])|қала|ауыстыр|тұрамын|келдім/i;

  const LET = "a-zа-яёәғқңөұүһі";
  const NL = "[^" + LET + "]";
  const END = "(?![" + LET + "])";

  const ITEMS = [
    { art: "bread", rx: new RegExp("(хлеб|(^|" + NL + ")нан" + END + ")", "i"), ru: "Хлеб", kk: "Нан", price: 250 },
    { art: "milk", rx: /(молок|сүт)/i, ru: "Молоко 1 л", kk: "Сүт 1 л", price: 520 },
    { art: "kefir", rx: /(кефир|айран)/i, ru: "Кефир", kk: "Айран", price: 480 },
    { art: "eggs", rx: /(яйц|жұмыртқа)/i, ru: "Яйца, 10 шт", kk: "Жұмыртқа, 10 дана", price: 900 },
    { art: "sugar", rx: /(сахар|қант)/i, ru: "Сахар 1 кг", kk: "Қант 1 кг", price: 560 },
    { art: "tea", rx: /(чай|шай)/i, ru: "Чай", kk: "Шай", price: 1300 },
    { art: "butter", rx: /(масл|сары май)/i, ru: "Масло", kk: "Сары май", price: 1400 },
    { art: "potato", rx: /(картош|картоп)/i, ru: "Картофель 2 кг", kk: "Картоп 2 кг", price: 600 },
    { art: "apple", rx: /(яблок|алма)/i, ru: "Яблоки 1 кг", kk: "Алма 1 кг", price: 750 },
    { art: "beef", rx: /(мяс|сиыр)/i, ru: "Говядина 1 кг", kk: "Сиыр еті 1 кг", price: 3800 },
    { art: "chicken", rx: /(курин|курица|тауық)/i, ru: "Курица", kk: "Тауық", price: 2200 },
    { art: "rice", rx: /(рис|күріш)/i, ru: "Рис 1 кг", kk: "Күріш 1 кг", price: 700 }
  ];
  const USUAL = { 0: 1, 1: 1, 2: 1 }; // "as usual": bread, milk, kefir
  const DELIVERY = 500;

  const KINDS = {
    plumber:  { rx: /(сантехник|кран|теч|протек|труб|унитаз|ағып|құбыр)/i, ru: "Сантехник", kk: "Сантехник", d: { ru: "кран, трубы", kk: "кран, құбыр" }, who: { ru: "Бауыржан, ★ 4.9", kk: "Бауыржан, ★ 4.9" }, when: { ru: "сегодня, 15:00–17:00", kk: "бүгін, 15:00–17:00" }, price: 3000, priceLbl: { ru: "Выезд и осмотр", kk: "Келу және қарау" } },
    electric: { rx: /(электрик|розетк|свет|лампоч|электр|жарық)/i, ru: "Электрик", kk: "Электрик", d: { ru: "свет, розетки", kk: "жарық, розетка" }, who: { ru: "Азамат, ★ 4.8", kk: "Азамат, ★ 4.8" }, when: { ru: "сегодня, 17:00–19:00", kk: "бүгін, 17:00–19:00" }, price: 3000, priceLbl: { ru: "Выезд и осмотр", kk: "Келу және қарау" } },
    cleaning: { rx: /(уборк|убрать|убраться|клининг|помыть|тазала|жинау|жинап)/i, ru: "Уборка", kk: "Тазалау", d: { ru: "«Таза Үй», 3 часа", kk: "«Таза Үй», 3 сағат" }, who: { ru: "Гульнара, ★ 5.0", kk: "Гүлнара, ★ 5.0" }, when: { ru: "завтра, 10:00", kk: "ертең, 10:00" }, price: 9000, priceLbl: { ru: "Стоимость", kk: "Бағасы" } },
    handy:    { rx: /(мастер|почин|сломал|не работает|шебер|бұзыл|жөнде)/i, ru: "Мастер на все руки", kk: "Әмбебап шебер", d: { ru: "мебель, двери", kk: "жиһаз, есік" }, who: { ru: "Нурлан, ★ 4.9", kk: "Нұрлан, ★ 4.9" }, when: { ru: "завтра, 12:00–14:00", kk: "ертең, 12:00–14:00" }, price: 3500, priceLbl: { ru: "Выезд и осмотр", kk: "Келу және қарау" } }
  };

  // Specialist profiles shown on the services screen (prototype data; portraits are illustrations from art.js)
  const STAFF = {
    plumber: { name: { ru: "Бауыржан Сейткали", kk: "Бауыржан Сейтқали" }, rating: 4.9, exp: 14, jobs: 1240, reviews: 312,
      bio: { ru: "Меняет смесители, чинит протечки и трубы. Работает аккуратно, после себя убирает. Говорит на казахском и русском.", kk: "Араластырғыш ауыстырады, ағып жатқан құбырларды жөндейді. Ұқыпты жұмыс істейді, соңынан жинап кетеді. Қазақша және орысша сөйлейді." },
      tags: { ru: ["Смесители", "Трубы", "Унитазы", "Бойлеры"], kk: ["Араластырғыш", "Құбыр", "Унитаз", "Бойлер"] },
      review: { ru: "«Пришёл вовремя, всё объяснил простыми словами» — Сауле, 71 год", kk: "«Уақытында келді, бәрін қарапайым түсіндірді» — Сәуле, 71 жаста" } },
    electric: { name: { ru: "Азамат Жумабеков", kk: "Азамат Жұмабеков" }, rating: 4.8, exp: 9, jobs: 860, reviews: 204,
      bio: { ru: "Розетки, выключатели, люстры, проводка. Допуск по электробезопасности IV группы. Перед работой отключает свет и всё проверяет.", kk: "Розетка, ажыратқыш, шам, сым тарту. Электр қауіпсіздігі бойынша IV топ рұқсаты бар. Жұмыс алдында жарықты өшіріп, бәрін тексереді." },
      tags: { ru: ["Розетки", "Свет", "Проводка", "Щитки"], kk: ["Розетка", "Жарық", "Сым", "Қалқан"] },
      review: { ru: "«Поменял все розетки за час, денег лишних не взял» — Ерболат, 68 лет", kk: "«Барлық розетканы бір сағатта ауыстырды, артық ақша алмады» — Ерболат, 68 жаста" } },
    cleaning: { name: { ru: "Гульнара Ахметова", kk: "Гүлнара Ахметова" }, rating: 5.0, exp: 7, jobs: 530, reviews: 176,
      bio: { ru: "Генеральная и обычная уборка, мытьё окон, стирка штор. Свои безопасные средства без резкого запаха.", kk: "Жалпы және күнделікті тазалау, терезе жуу, перде жуу. Өткір иісі жоқ қауіпсіз құралдарымен келеді." },
      tags: { ru: ["Квартира", "Окна", "Кухня", "Шторы"], kk: ["Пәтер", "Терезе", "Ас үй", "Перде"] },
      review: { ru: "«Как дочка помогла — чисто и душевно» — Айгуль, 74 года", kk: "«Қызым көмектескендей — таза әрі жылы» — Әйгүл, 74 жаста" } },
    handy: { name: { ru: "Нурлан Оспанов", kk: "Нұрлан Оспанов" }, rating: 4.9, exp: 22, jobs: 1980, reviews: 455,
      bio: { ru: "Соберёт мебель, починит дверь или замок, повесит полку и карниз. Всё нужное привозит с собой.", kk: "Жиһаз құрастырады, есік не құлып жөндейді, сөре мен карниз іледі. Керек құралдың бәрін өзімен әкеледі." },
      tags: { ru: ["Мебель", "Двери", "Замки", "Полки"], kk: ["Жиһаз", "Есік", "Құлып", "Сөре"] },
      review: { ru: "«Золотые руки, и чай с нами попил» — Камал, 80 лет", kk: "«Алтын қол, бізбен шай да ішті» — Камал, 80 жаста" } }
  };
  const ART = window.ART || { staff: {}, food: {} };
  // Real photos (CC0 / public domain, see img/CREDITS.md). Items without a photo keep the drawn illustration.
  const PHOTO = { food: { bread: "img/food/bread.jpg", milk: "img/food/milk.jpg", eggs: "img/food/eggs.jpg", tea: "img/food/tea.jpg", apple: "img/food/apple.jpg" }, staff: {} };
  const pic = (kind, key, alt) => PHOTO[kind][key]
    ? `<img src="${PHOTO[kind][key]}" alt="${esc(alt || "")}" loading="lazy" decoding="async">`
    : (ART[kind][key] || "");

  const SERVICE_NAME = { taxi: { ru: "такси", kk: "такси" }, food: { ru: "продукты", kk: "азық-түлік" }, services: { ru: "бытовые услуги", kk: "тұрмыстық қызметтер" } };

  /* ==========================================================
     Language + navigation
     ========================================================== */
  function applyLang() {
    document.documentElement.lang = state.lang;
    if (window.GEO) window.GEO.setLang(state.lang);
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    $("#typeField").placeholder = t("type.ph");
    $$("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang)));
    setIdleHint();
    render();
  }
  function setLang(lang) {
    if (lang === state.lang) return;
    state.lang = lang; store.set("lang", lang); applyLang();
  }
  $$("[data-lang]").forEach((b) => b.addEventListener("click", () => {
    setLang(b.dataset.lang);
    speak(L("Хорошо, говорим по-русски.", "Жақсы, қазақша сөйлесеміз."));
  }));

  function go(screen) {
    const target = screen === "home" ? "" : screen;
    if (location.hash.slice(1) !== target) location.hash = target;
    else show(screen);
  }
  function show(screen) {
    if (!$(`[data-screen="${screen}"]`)) screen = "home";
    state.screen = screen;
    $$("[data-screen]").forEach((s) => { s.hidden = s.dataset.screen !== screen; });
    render();
    const el = $(`[data-screen="${screen}"]`);
    el.scrollTop = 0; window.scrollTo(0, 0);
    $$(".dnav [data-go]").forEach((b) => { if (b.dataset.go === screen) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    if (screen === "home" && !listening) setIdleHint();
    mapsOnShow(screen);
  }
  window.addEventListener("hashchange", () => show(location.hash.slice(1) || "home"));
  $$("[data-back]").forEach((b) => b.addEventListener("click", () => go("home")));
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => {
    const s = b.dataset.go;
    if (state[s] && "quote" in state[s]) state[s].quote = null;
    if (s === "food" && !state.food.items) state.food.items = Object.assign({}, USUAL);
    go(s);
  }));

  /* ==========================================================
     Speech: synthesis
     ========================================================== */
  // 1) A natural pre-recorded ElevenLabs clip (voice/manifest.js) when the phrase is known.
  // 2) Otherwise the browser voice — but Kazakh only with a real Kazakh voice:
  //    a Russian voice reading Kazakh text is unintelligible, and the text is on screen anyway.
  const clipKey = (lang, text) => lang + "|" + String(text).trim().replace(/\s+/g, " ").toLowerCase();
  let curAudio = null;
  function stopSpeech() {
    if (curAudio) { try { curAudio.pause(); } catch (e) { /* ignore */ } curAudio = null; }
    if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  }
  function speak(text) {
    if (!text) return;
    const lang = state.lang;
    if (window.__voiceLog) window.__voiceLog.push({ lang, text: String(text) });
    stopSpeech();
    const src = (window.VOICE_CLIPS || {})[clipKey(lang, text)];
    if (src) {
      const a = new Audio(src);
      curAudio = a;
      a.play().catch(() => { if (curAudio === a) browserSpeak(text, lang); });
      return;
    }
    browserSpeak(text, lang);
  }
  // Several phrases one after another (route steps): clips if all are recorded, else one browser utterance.
  function speakSeq(texts) {
    const lang = state.lang, clips = window.VOICE_CLIPS || {};
    const srcs = texts.map((x) => clips[clipKey(lang, x)]);
    if (srcs.some((x) => !x)) return speak(texts.join(". "));
    stopSpeech();
    if (window.__voiceLog) texts.forEach((x) => window.__voiceLog.push({ lang, text: x }));
    let i = 0;
    const next = () => {
      if (i >= srcs.length) return;
      const a = new Audio(srcs[i++]);
      curAudio = a;
      a.onended = () => { if (curAudio === a) setTimeout(next, 250); };
      a.play().catch(() => { if (curAudio === a) browserSpeak(texts.join(". "), lang); });
    };
    next();
  }
  function browserSpeak(text, lang) {
    if (!("speechSynthesis" in window)) return;
    try {
      const code = lang === "kk" ? "kk-KZ" : "ru-RU";
      const vs = window.speechSynthesis.getVoices();
      const v = vs.find((x) => x.lang && x.lang.replace("_", "-") === code) || vs.find((x) => x.lang && x.lang.toLowerCase().startsWith(lang));
      if (lang === "kk" && !v) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = code;
      if (v) u.voice = v;
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  let toastTimer;
  function toast(text, ms) {
    const el = $("#toast");
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
  }

  /* ==========================================================
     Home: sun rays, waveform, hint
     ========================================================== */
  // Sun rays: rotate and "breathe" (each ray changes length); faster while listening
  const RAYS = 36;
  const rayEls = [];
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  (function drawSun() {
    const g = $("#rays");
    const NS = "http://www.w3.org/2000/svg";
    for (let i = 0; i < RAYS; i++) {
      const l = document.createElementNS(NS, "line");
      l.setAttribute("stroke", "currentColor");
      l.setAttribute("stroke-width", "3.2");
      l.setAttribute("stroke-linecap", "round");
      g.appendChild(l); rayEls.push(l);
    }
    const w = $("#wave");
    [14, 26, 38, 22, 44, 30, 18, 40, 24, 34, 16].forEach((h, i) => {
      const b = document.createElement("i");
      b.style.height = h + "px";
      b.style.animationDelay = (i * 0.08) + "s";
      w.appendChild(b);
    });
  })();
  let rot = 0, lastT = 0, energy = 0;
  function drawRays(now) {
    const t = now / 1000, dt = Math.min(0.05, t - lastT || 0); lastT = t;
    energy += ((listening ? 1 : 0) - energy) * Math.min(1, dt * 4);   // smooth idle <-> listening
    rot += dt * (8 + 40 * energy);
    const amp = 6 + 12 * energy, spd = 1.6 + 4 * energy;
    rayEls.forEach((l, i) => {
      const base = i % 2 ? 22 : 34;
      const len = base + amp * Math.sin(t * spd + i * 0.9) + (amp / 2) * Math.sin(t * spd * 0.6 + i * 2.3);
      const a = (i / RAYS) * Math.PI * 2 + rot * Math.PI / 180;
      const r1 = 76, r2 = r1 + Math.max(8, len);
      l.setAttribute("x1", (120 + Math.cos(a) * r1).toFixed(1)); l.setAttribute("y1", (120 + Math.sin(a) * r1).toFixed(1));
      l.setAttribute("x2", (120 + Math.cos(a) * r2).toFixed(1)); l.setAttribute("y2", (120 + Math.sin(a) * r2).toFixed(1));
    });
  }
  function rayLoop(now) {
    if (state.screen === "home" && !document.hidden) drawRays(now);
    requestAnimationFrame(rayLoop);
  }

  const EXAMPLES = {
    ru: ["Вызови такси домой", "Закажи продукты как обычно", "Как доехать до поликлиники?", "Течёт кран, нужен мастер"],
    kk: ["Үйге такси шақыр", "Маған нан мен сүт керек", "Емханаға қалай барамын?", "Кран ағып тұр"]
  };
  let exIdx = 0, exTimer = null;
  const hint = $("#hint");
  function setIdleHint() {
    hint.classList.remove("reply");
    const ex = EXAMPLES[state.lang][exIdx % 4];
    hint.textContent = "";
    hint.append(L("Нажмите и скажите: ", "Басып, айтыңыз: "));
    const q = document.createElement("q");
    q.textContent = ex;
    hint.append(q);
  }
  function cycleHints() {
    clearInterval(exTimer);
    exTimer = setInterval(() => { if (!listening && !hint.classList.contains("reply")) { exIdx++; setIdleHint(); } }, 4500);
  }
  function setReply(text) { hint.classList.add("reply"); hint.textContent = text; }

  /* Text fallback */
  $("#typeToggle").addEventListener("click", () => {
    const f = $("#typeForm");
    f.hidden = !f.hidden;
    if (!f.hidden) $("#typeField").focus();
  });
  $("#typeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = $("#typeField");
    if (f.value.trim()) understand(f.value, false);
    f.value = "";
  });

  /* ==========================================================
     Speech: recognition (RU / KK)
     ========================================================== */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, listenBtn = null;

  // Kazakh recognition (kk-KZ) is missing in Safari and some Chrome builds: they fail with
  // "language-not-supported" or "service-not-allowed". Then we listen with the Russian recognizer
  // (it hears Kazakh words in Cyrillic) and keep the Kazakh interface.
  let kkRecOff = store.get("kkRecOff", false);
  let recFallback = false;
  function recLang() { return state.lang === "kk" && !kkRecOff ? "kk-KZ" : "ru-RU"; }
  function listen(btn, retry) {
    if (!SR) {
      toast(L("Этот браузер не распознаёт речь — напишите текстом (лучше всего Chrome).",
              "Бұл браузер сөзді танымайды — мәтінмен жазыңыз (Chrome жақсы)."), 4200);
      if (state.screen !== "home") go("home");
      $("#typeForm").hidden = false; $("#typeField").focus();
      return;
    }
    if (listening && rec && !retry) { rec.stop(); return; }
    const lang = recLang();
    const fallBack = () => {
      if (lang !== "kk-KZ") return false;
      kkRecOff = true; store.set("kkRecOff", true);
      toast("Бұл браузерде қазақша тану жоқ — қазақша сөйлей беріңіз, орыс тануы арқылы тыңдаймын.", 4500);
      setTimeout(() => listen(btn, true), 150);
      return true;
    };
    try {
      stopSpeech();
      rec = new SR();
      rec.lang = lang;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let finalText = "", heard = false, retrying = false;
      listenBtn = btn;
      rec.onstart = () => {
        listening = true; btn.classList.add("is-listening"); $("#wave").classList.add("on");
        if (state.screen === "home") setReply(L("Слушаю… говорите", "Тыңдап тұрмын… айтыңыз"));
        else setQuote(L("Слушаю…", "Тыңдап тұрмын…"));
      };
      rec.onresult = (e) => {
        heard = true;
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        const live = finalText + interim;
        if (!live) return;
        if (state.screen === "home") setReply("«" + live + "»"); else setQuote("«" + live + "»");
      };
      rec.onerror = (e) => {
        if (!heard && (e.error === "language-not-supported" || e.error === "service-not-allowed") && fallBack()) { retrying = true; return; }
        if (e.error === "not-allowed" || e.error === "service-not-allowed")
          toast(L("Нет доступа к микрофону. Разрешите его в браузере (значок слева от адреса) или напишите текстом.", "Микрофонға рұқсат жоқ. Браузерде рұқсат беріңіз (мекенжай жанындағы белгі) не мәтінмен жазыңыз."), 5000);
        else if (e.error === "audio-capture")
          toast(L("Микрофон не найден. Проверьте, что он подключён.", "Микрофон табылмады. Қосулы екенін тексеріңіз."), 4500);
      };
      rec.onend = () => {
        listening = false; btn.classList.remove("is-listening"); $("#wave").classList.remove("on");
        if (retrying) return;
        if (finalText.trim()) { recFallback = lang === "ru-RU" && state.lang === "kk"; understand(finalText, true); recFallback = false; }
        else if (state.screen === "home") setIdleHint();
        else render();
      };
      rec.start();
    } catch (err) {
      if (!fallBack()) toast(L("Не удалось включить микрофон.", "Микрофон қосылмады."));
    }
  }
  $("#micBtn").addEventListener("click", (e) => listen(e.currentTarget));
  $$("[data-mic]").forEach((b) => b.addEventListener("click", () => listen(b)));

  function setQuote(text) {
    const el = $(`[data-quote="${state.screen}"]`);
    if (el) el.textContent = text;
  }

  /* ==========================================================
     AI assistant: understand a request and route to a category
     ========================================================== */
  function detectLang(text) {
    const s = text.toLowerCase();
    if (/[әғқңөұүһі]/.test(s)) return "kk";
    if (new RegExp("(^|" + NL + ")(маған|керек|шақыр|иә|ия|сәлем|салем|рахмет|рақмет|қайда|үйге|қалай|нан|сүт|барамын|апар)" + END).test(s)) return "kk";
    if (/[а-яё]/.test(s)) return "ru";
    return state.lang;
  }

  const RX = {
    yes: new RegExp("^(да|давай|ага|подтверждаю|конечно|вызывай|заказывай|верно|иә|ия|йә|жарайды|болады|дұрыс|ок|окей|ok)" + END, "i"),
    no: /^(нет|не надо|не нужно|отмена|отмени|стоп|жоқ|керек емес|қажет емес|тоқтат|болдырма)/i,
    help: /(плохо|скор(ая|ую)|помогите|спасите|упал|болит|на помощь|sos|сос|жедел|жаным ауыр|құтқар|құлап|ауырып|көмекке)/i,
    call: /(позвон|набери|созвон|қоңырау|хабарлас)/i,
    son: /(сын|ерлан|ұлым|ұлыма)/i,
    profile: /(мои данные|мой адрес|профил|регистрац|измени(ть)?\s+(мои|имя|адрес|телефон|данн)|деректер|тіркел|мекенжайым)/i,
    homeNav: /(главн|назад|в начало|меню|басты|артқа)/i,
    family: /(настройк|родственник|лимит|баптау|туыс)/i,
    taxi: /(такси|поехать|поеду|отвез|довез|жеткіз|апар|көлік|барғым)/i,
    route: /(маршрут|автобус|как добраться|как доехать|как дойти|остановк|бағыт|қалай бар|аялдама|жол көрсет)/i,
    food: new RegExp("(продукт|еда|покуп|магазин|закажи|хлеб|молок|яйц|кефир|азық|сүт|дүкен|тамақ|айран|(^|" + NL + ")нан" + END + ")", "i"),
    usual: /(как обычно|как всегда|әдеттегідей|әдеттегі)/i,
    thanks: /(спасибо|благодар|рахмет|рақмет)/i
  };
  const findDest = (s) => {
    const hits = Object.keys(DEST).filter((k) => DEST[k].rx.test(s));
    return hits.find((k) => k !== "home") || hits[0] || null;
  };
  const findKind = (s) => Object.keys(KINDS).find((k) => KINDS[k].rx.test(s)) || null;

  function reply(text, screen) {
    speak(text);
    if (state.screen === "home") setReply(text);
    else toast(text);
    if (screen) setTimeout(() => go(screen), state.screen === "home" ? 900 : 0);
  }

  // Restores Kazakh letters in text from the Russian recognizer: «Уйге такси шакыр» → «үйге такси шақыр».
  // The stems are harvested from the command patterns themselves, so every Kazakh keyword is covered.
  const foldKk = (x) => x.replace(/[әғқңөұүһі]/g, (c) => ({ ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и" })[c]);
  let kkStems = null;
  function kazakhify(text) {
    if (!kkStems) {
      const m = new Map();
      const rxs = [].concat(Object.values(RX), Object.values(DEST).map((d) => d.rx), Object.values(KINDS).map((k) => k.rx),
        ITEMS.map((i) => i.rx), CITY_RX.map((c) => c[1])).filter(Boolean);
      rxs.forEach((rx) => rx.source.split(/[|()?:^$\\[\]*+.{}]+/).forEach((tok) => {
        tok = tok.trim().toLowerCase();
        if (tok.length >= 3 && /[әғқңөұүһі]/.test(tok) && /^[а-яёәғқңөұүһі ]+$/.test(tok)) m.set(foldKk(tok), tok);
      }));
      kkStems = [...m.entries()].sort((x, y) => y[0].length - x[0].length);
    }
    let t = text.toLowerCase();
    kkStems.forEach(([f, orig]) => { if (t.includes(f)) t = t.split(f).join(orig); });
    return t;
  }

  function understand(raw, viaVoice) {
    const text = recFallback ? kazakhify(raw.trim()) : raw.trim();
    if (!text) return;
    const lang = detectLang(text);
    // Russian recognizer standing in for Kazakh writes Kazakh words without ә/қ/ң… — keep the Kazakh UI
    if (lang !== state.lang && !(recFallback && lang === "ru")) {
      setLang(lang);
      toast(lang === "kk" ? "Қазақ тіліне ауыстым" : "Перешла на русский язык", 2000);
    }
    const s = text.toLowerCase();
    const quote = "«" + text.replace(/^./, (c) => c.toUpperCase()) + "»";
    const cur = state.screen;

    // 1) Emergency first
    if (RX.help.test(s)) { reply(L("Зову на помощь.", "Көмекке шақырып жатырмын.")); return openHelp(0); }
    if (RX.call.test(s)) {
      const c = state.settings.contacts.findIndex((x) => contactRx(x).test(s));
      reply(L("Звоню.", "Қоңырау шалып жатырмын."));
      return openHelp(Math.max(0, c), true);
    }

    // 1b) City: «я в Астане» / «Астанадамын» switches the city; a request in the same phrase goes on
    const cityHit = findCity(s);
    if (cityHit && (CITY_INTENT.test(s) || s.replace(/[^a-zа-яёәғқңөұүһі]/gi, "").length <= 18)) {
      const more = RX.taxi.test(s) || RX.route.test(s) || RX.food.test(s) || !!findDest(s) || !!findKind(s);
      setCity(cityHit, { silent: more });
      if (!more) return;
      toast(L(`Город: ${cityName()}`, `Қала: ${cityName()}`), 2200);
    }

    // 2) Yes / no on the current screen
    if (cur !== "home" && RX.yes.test(s)) { const b = $(`[data-actions="${cur}"] [data-confirm]`); if (b) return b.click(); }
    if (cur !== "home" && RX.no.test(s)) { reply(L("Хорошо, отменила.", "Жарайды, тоқтаттым.")); return go("home"); }

    // 3) Navigation
    if (RX.profile.test(s)) return reply(L("Открываю ваши данные. Можно всё поменять.", "Деректеріңізді ашамын. Бәрін өзгертуге болады."), "profile");
    if (RX.family.test(s)) return reply(L("Открываю настройки родственника.", "Туыс баптауларын ашамын."), "family");
    if (RX.homeNav.test(s) && !RX.taxi.test(s)) return reply(L("Возвращаюсь на главный экран.", "Басты бетке ораламын."), "home");

    // 4) Categories
    const dest = findDest(s);
    const kind = findKind(s);
    // 4a) an address instead of a usual place: «такси до улицы Абая 150», «Абай көшесі 150-ге такси»
    if ((RX.taxi.test(s) || RX.route.test(s)) && (!dest || dest === "home") && GEOX && looksLikeAddress(s)) {
      const q = addrPart(text);
      if (q.replace(/[^0-9a-zа-яёәғқңөұүһі]/gi, "").length >= 3 && /[a-zа-яёәғқңөұүһі]{3}/i.test(q))
        return askAddress(q, RX.route.test(s) && !RX.taxi.test(s) ? "route" : "taxi", quote);
    }
    if (RX.route.test(s)) {
      state.route.dest = dest || state.route.dest; state.route.quote = quote;
      return reply(L(`Показываю, как добраться: ${DEST[state.route.dest].chip.ru.toLowerCase()}.`, `Қалай жетуге болатынын көрсетемін: ${DEST[state.route.dest].chip.kk.toLowerCase()}.`), "route");
    }
    if (RX.taxi.test(s) || (dest && !RX.food.test(s) && !kind)) {
      if (state.taxi.status === "done" || state.taxi.status === "pending") return reply(L("Поездка уже идёт. Сначала отмените её.", "Сапар жүріп жатыр. Алдымен оны болдырмаңыз."), "taxi");
      Object.assign(state.taxi, { dest: dest || "home", status: "draft", quote });
      const q = taxiQuote(state.taxi.dest);
      // own addresses: price / time differ, so the voice says a fixed phrase (recorded clip) and the screen shows the numbers
      if (q.dyn) return reply(L("Нашла такси. Цена и время — на экране. Вызвать?", "Такси таптым. Бағасы мен уақыты — экранда. Шақырайын ба?"), "taxi");
      return reply(L(`Нашла такси, примерно ${q.price} тенге, приедет через ${q.eta} ${plural(q.eta, ["минуту", "минуты", "минут"])}. Вызвать?`,
                     `Такси таптым, шамамен ${q.price} теңге, ${q.eta} минутта келеді. Шақырайын ба?`), "taxi");
    }
    if (kind) {
      Object.assign(state.services, { kind, status: "draft", quote });
      const k = KINDS[kind];
      return reply(L(`${k.ru}: ${k.when.ru}. Вызвать?`, `${k.kk}: ${k.when.kk}. Шақырайын ба?`), "services");
    }
    if (RX.food.test(s) || RX.usual.test(s)) {
      const items = {};
      ITEMS.forEach((it, i) => { if (it.rx.test(s)) items[i] = 1; });
      const usual = !Object.keys(items).length;
      Object.assign(state.food, { items: usual ? Object.assign({}, USUAL) : items, status: "draft", quote });
      return reply(usual ? L("Собрала как обычно: хлеб, молоко, кефир. Заказать?", "Әдеттегідей жинадым: нан, сүт, айран. Тапсырыс берейін бе?")
                         : L("Собрала корзину. Проверьте и скажите «да».", "Себетті жинадым. Тексеріп, «иә» деңіз."), "food");
    }
    if (RX.thanks.test(s)) return reply(L("Пожалуйста! Обращайтесь.", "Оқасы жоқ! Кез келген уақытта айтыңыз."));

    reply(L("Простите, я не поняла. Скажите иначе, например: «вызови такси домой». Или нажмите «Позвать на помощь».",
            "Кешіріңіз, түсінбедім. Басқаша айтыңыз, мысалы: «үйге такси шақыр». Немесе «Көмекке шақыру» батырмасын басыңыз."));
    if (cur !== "home") render();
  }

  // Clicking the example inside the hint sends it
  hint.addEventListener("click", (e) => { if (e.target.tagName === "Q") understand(e.target.textContent, false); });

  /* ==========================================================
     Limit + relative safety net
     ========================================================== */
  const left = () => Math.max(0, state.settings.limit - state.settings.spent);
  function limitNote(screen, sum) {
    const el = $(`[data-limit="${screen}"]`);
    if (!el) return false;
    const over = sum > left();
    el.classList.toggle("over", over);
    el.textContent = over
      ? L(`Больше месячного лимита: осталось ${money(left())}`, `Айлық лимиттен асады: ${money(left())} қалды`)
      : L(`В пределах месячного лимита ${money(state.settings.limit)}`, `${money(state.settings.limit)} айлық лимит шегінде`);
    return over;
  }

  function addLog(entry) {
    state.log.unshift(Object.assign({ time: Date.now() }, entry));
    save();
  }

  // Send an over-limit order to the first relative for approval.
  function requestApproval(screen, label, sum, onApproved) {
    const c = first();
    const entry = { kind: "approval", ru: `${label.ru} — ${money(sum)}`, kk: `${label.kk} — ${money(sum)}`, status: "pending", screen };
    addLog(entry);
    state[screen].status = "pending";
    pendingApprovals.set(entry.time, () => { entry.status = "ok"; save(); onApproved(); });
    reply(L(`Отправила ${c.short.ru} на подтверждение.`, `${c.short.kk} растауға жібердім.`));
    render();
    // Demo: the relative approves after a few seconds if nobody approves in relative mode first
    setTimeout(() => approve(entry.time, true), 5000);
  }
  const pendingApprovals = new Map();
  function approve(id, auto) {
    const fn = pendingApprovals.get(id);
    if (!fn) return;
    pendingApprovals.delete(id);
    if (auto) toast(L(`${first().name} ${verb(first(), "одобрила")} заказ`, `${first().name} тапсырысты мақұлдады`));
    fn();
    render();
  }

  function requestEnable(service) {
    const c = first();
    addLog({ kind: "enable", ru: `Просит включить: ${SERVICE_NAME[service].ru}`, kk: `Қосуды сұрайды: ${SERVICE_NAME[service].kk}`, status: "pending", service });
    reply(L(`Попросила ${c.short.ru} включить ${SERVICE_NAME[service].ru}.`, `${c.short.kk} ${SERVICE_NAME[service].kk} қосуды сұрадым.`));
    render();
    setTimeout(() => {
      if (state.settings.services[service]) return;
      state.settings.services[service] = true;
      const e = state.log.find((x) => x.kind === "enable" && x.service === service && x.status === "pending");
      if (e) e.status = "ok";
      save();
      toast(L(`${c.name} ${verb(c, "включила")}: ${SERVICE_NAME[service].ru}`, `${c.name} қосты: ${SERVICE_NAME[service].kk}`));
      render();
    }, 4000);
  }

  /* ==========================================================
     Rendering helpers
     ========================================================== */
  function btn(cls, text, onClick, confirmBtn) {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = text;
    if (confirmBtn) b.dataset.confirm = "";
    b.addEventListener("click", onClick);
    return b;
  }
  function box(cls, text) { const d = document.createElement("div"); d.className = cls; d.textContent = text; return d; }
  function chipRow(el, keys, current, label, onPick) {
    el.innerHTML = "";
    keys.forEach((k) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = label(k);
      b.setAttribute("aria-pressed", String(k === current));
      b.addEventListener("click", () => onPick(k));
      el.appendChild(b);
    });
  }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Common action area: disabled service / over limit / confirm / done
  function actions(screen, service, sum, labels, onConfirm, doneText, extra) {
    const a = $(`[data-actions="${screen}"]`);
    a.innerHTML = "";
    const note = $(`[data-limit="${screen}"]`);
    if (note) note.textContent = "";
    const st = state[screen].status;
    if (service && !state.settings.services[service]) {
      a.append(box("wait-box", L(`${first().name} пока не ${verb(first(), "включила")} ${SERVICE_NAME[service].ru}.`, `${first().name} әзірге ${SERVICE_NAME[service].kk} қоспаған.`)));
      const asked = state.log.some((x) => x.kind === "enable" && x.service === service && x.status === "pending");
      a.append(asked ? box("wait-box", L("Запрос отправлен, ждём ответа…", "Сұрау жіберілді, жауап күтудеміз…"))
                     : btn("btn-main alt", L(`Попросить ${first().short.ru} включить`, `${first().short.kk} қосуды сұрау`), () => requestEnable(service)));
      return;
    }
    if (st === "done") { a.append(box("done-box", doneText)); if (extra) a.append(extra); return; }
    if (st === "pending") { a.append(box("wait-box", L(`Ждём подтверждения от ${first().name}…`, `${first().name} растауын күтудеміз…`))); return; }
    const over = limitNote(screen, sum);
    if (over) {
      if (state.settings.askOverLimit)
        a.append(btn("btn-main alt", L(`Отправить ${first().short.ru} на подтверждение`, `${first().short.kk} растауға жіберу`),
          () => requestApproval(screen, labels, sum, onConfirm), true));
      else a.append(box("wait-box", L("Заказ больше лимита. Уменьшите его или позовите на помощь.", "Тапсырыс лимиттен асады. Азайтыңыз не көмекке шақырыңыз.")));
    } else {
      a.append(btn("btn-main", labels.btn, onConfirm, true));
    }
  }

  function finishOrder(screen, sum, logLabel) {
    state[screen].status = "done";
    state.settings.spent += sum;
    if (state.settings.seeOrders) addLog({ kind: "order", ru: logLabel.ru + " — " + money(sum), kk: logLabel.kk + " — " + money(sum), status: "ok" });
    save();
  }

  /* ==========================================================
     «Живая карта»: real streets of the chosen city (routes.js for Almaty,
     routes-<city>.js loaded on demand) on a Leaflet map (map.js).
     The ride / bus simulation runs without the map too: if Leaflet or the
     tiles cannot load, the screens keep the decorative SVG and the texts still update.
     ========================================================== */
  const cityRoutes = () => (KZ ? KZ.routes[state.settings.city] || null : window.ROUTES || null);
  const LM = window.LiveMap || null;
  const GEOX = window.GEO || null;
  // BASE: the city's precomputed demo streets (shared, never mutated).
  // ROUTES: what the screens use — BASE, or a copy with the user's real home / relative / own trip.
  let BASE = cityRoutes();
  let ROUTES = null;
  // the current city's routes: already embedded, or fetched once (routes-<city>.js)
  function ensureRoutes() {
    const id = state.settings.city;
    if (BASE || !KZ) { if (!ROUTES && BASE) ROUTES = buildRoutes(); return Promise.resolve(ROUTES); }
    return KZ.loadRoutes(id).then((r) => {
      if (r && state.settings.city === id && !BASE) { BASE = r; ROUTES = buildRoutes(); render(); }
      return ROUTES;
    });
  }

  /* ---- The user's own points: real home / relative from the profile, own «Откуда / Куда» ---- */
  const ptOf = (g) => (g && g.city === state.settings.city && isFinite(g.lat) && isFinite(g.lng) ? [g.lat, g.lng] : null);
  const homePt = () => (profile().demo ? null : ptOf(profile().homeGeo));
  const kidPt = () => { const c = state.settings.contacts[0]; return c ? ptOf(c.geo) : null; };
  // car leg a → b: the cached street route, or a gentle approximate line while OSRM answers
  const legAsked = {};
  let rebuildTimer = null;
  function leg(a, b) {
    if (!GEOX) return { pts: [a, b], len: Math.round((LM ? LM.measure([a, b]).total : 1000) * 1.3), approx: true };
    const hit = GEOX.cachedRoute(a, b);
    if (hit) return hit;
    const k = a.join() + ";" + b.join();
    if (!legAsked[k]) {
      legAsked[k] = 1;
      GEOX.route(a, b).then((r) => { if (r && !r.approx) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildRoutes, 120); } });
    }
    return GEOX.approx(a, b);
  }
  function mkTaxi(a, b) {
    const main = leg(a, b), pick = leg(GEOX ? GEOX.offset(a, 700, 35) : [a[0] + 0.0055, a[1] + 0.005], a);
    return { len: main.len, pickupLen: pick.len, route: main.pts, pickup: pick.pts, approx: !!(main.approx || pick.approx) };
  }
  // approximate bus trip: the driving path is the bus corridor, short straight walks at both ends,
  // stops every ~550 m, the bus comes in along a short stretch before the first stop
  function mkBus(a, b) {
    const path = leg(a, b), m = LM.measure(path.pts), tot = m.total;
    const cut = tot < 900 ? tot * 0.18 : Math.min(320, tot * 0.12);
    let bus = LM.slice(m, cut, tot - cut);
    if (bus.length < 2) bus = [a, b];
    const bm = LM.measure(bus), stops = [];
    for (let d = 550; d < bm.total - 250; d += 550) stops.push(LM.pointAt(bm, d));
    const h = LM.headingAt(bm, 0);
    const back = GEOX ? GEOX.offset(bus[0], 650, h + 180) : bus[0];
    const walk = (p, q) => Math.round(LM.measure([p, q]).total * 1.25);
    return { len: Math.round(bm.total), walk1Len: walk(a, bus[0]), walk2Len: walk(bus[bus.length - 1], b), stopsCount: stops.length + 1,
      walk1: [a, bus[0]], bus, walk2: [bus[bus.length - 1], b], approach: [back, bus[0]], stops, approx: !!path.approx };
  }
  function buildRoutes() {
    const B = BASE;
    if (!B || !LM) return B || null;
    const home = homePt(), kid = kidPt(), tr = state.trip;
    const cFrom = tr.from ? [tr.from.lat, tr.from.lng] : null, cTo = tr.to ? [tr.to.lat, tr.to.lng] : null;
    if (!home && !kid && !cFrom && !cTo) return B;
    const R = { points: Object.assign({}, B.points), taxi: Object.assign({}, B.taxi), bus: Object.assign({}, B.bus), over: { taxi: {}, bus: {} } };
    if (home) R.points.home = home;
    if (kid) R.points.kid = kid;
    if (cTo) R.points.custom = cTo;
    if (cFrom) R.points.customFrom = cFrom;
    Object.keys(DEST).forEach((k) => {
      const to = R.points[k];
      if (!to) return;
      if (cFrom || home || k === "custom" || (kid && k === "kid")) {
        R.taxi[k] = mkTaxi(cFrom || (k === "home" ? R.points.origin : R.points.home), to);
        R.over.taxi[k] = true;
      }
      if (home || k === "custom" || (kid && k === "kid")) {
        R.bus[k] = mkBus(k === "home" ? R.points.origin : R.points.home, to);
        R.over.bus[k] = true;
      }
    });
    return R;
  }
  // new geometry (profile saved, own trip chosen, a street route arrived): redraw both maps
  function rebuildRoutes() {
    ROUTES = buildRoutes();
    taxiMap.sig = ""; routeMap.sig = "";
    Object.keys(geoCache).forEach((k) => delete geoCache[k]);
    render();
  }

  const DEMO = 8;                       // demo clock: 1 real second ≈ 8 simulated seconds
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clock = (sec) => { const s = Math.max(0, Math.ceil(sec)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const ease = (p) => 0.75 * p + 0.25 * (0.5 - Math.cos(Math.PI * p) / 2);
  const setText = (node, v) => { if (node && node.textContent !== v) node.textContent = v; };
  const placeName = (k) => L(DEST[k].ru.split(" — ")[0], DEST[k].kk.split(" — ")[0]);
  // taxi: an own «Откуда» wins; bus: from home (or from the city's start point when going home)
  const fromPoint = (k) => (state.trip.from && ROUTES.points.customFrom ? ROUTES.points.customFrom : k === "home" ? ROUTES.points.origin : ROUTES.points.home);
  const busFrom = (k) => (k === "home" ? ROUTES.points.origin : ROUTES.points.home);
  const plural = (n, f) => { const a = n % 10, b = n % 100; return f[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 1 : 2]; };
  const geoCache = {};
  const geo = (key, pts) => { const k = state.settings.city + key; return geoCache[k] || (geoCache[k] = LM.measure(pts)); };
  const hasRoutes = () => !!(ROUTES && LM);
  // Price / pickup time: fixed for the demo trips (spoken by recorded clips), from the real distance
  // for the user's own addresses (400 ₸ + 160 ₸/km, rounded to 50; 3–9 min) — then the voice says «на экране»
  function taxiQuote(k) {
    const d = DEST[k], T = ROUTES && ROUTES.taxi[k];
    const dyn = k === "custom" || !!(ROUTES && ROUTES.over && ROUTES.over.taxi[k]);
    if (!dyn || !d) return { price: d ? d.price : 0, eta: d ? d.eta : 5, dyn: false };
    let len = T ? T.len : 0, pl = T ? T.pickupLen : 900;
    if (!T && GEOX && state.trip.to) {
      const f = state.trip.from || profile().homeGeo || { lat: cityOf().center[0], lng: cityOf().center[1] };
      len = GEOX.haversine(f, state.trip.to) * 1.35;
    }
    return { price: Math.max(600, Math.round((400 + 160 * len / 1000) / 50) * 50), eta: clamp(Math.round(2 + pl / 300), 3, 9), dyn: true };
  }
  // stop names: an approximate bus leg has no real stop names
  function stopNames(k) {
    const d = DEST[k], over = ROUTES && ROUTES.over && ROUTES.over.bus[k];
    if (!over) return { from: d.from, stop: d.stop };
    const NEAR_HOME = { ru: "«У дома»", kk: "«Үй жанындағы»" }, NEAR = { ru: "«Рядом с адресом»", kk: "«Мекенжай жанындағы»" };
    return { from: k === "home" ? d.from : homePt() ? NEAR_HOME : d.from, stop: k === "home" ? NEAR_HOME : (k === "custom" || (k === "kid" && kidPt())) ? NEAR : d.stop };
  }
  ROUTES = buildRoutes();

  /* ---- Taxi ride: wait → pickup → arrived → trip → finished ---- */
  function ridePlan(dest) {
    const q = taxiQuote(dest);
    const len = hasRoutes() && ROUTES.taxi[dest] ? ROUTES.taxi[dest].len : q.eta * 900;
    const pickupSim = q.eta * 60, tripSim = Math.max(5, Math.round(len / 400)) * 60;   // ~24 km/h in town
    return { pickupSim, tripSim, pickupMs: clamp(pickupSim / DEMO, 18, 40) * 1000, waitMs: 6000, tripMs: clamp(tripSim / DEMO, 24, 45) * 1000 };
  }
  function ridePhase(now) {
    const s = state.taxi;
    if (s.status !== "done" || !s.ride) return { phase: "wait", p: 0, left: 0 };
    const P = s.ride.plan;
    let t = now - s.ride.t0;
    if (t < P.pickupMs) return { phase: "pickup", p: t / P.pickupMs, left: P.pickupSim * (1 - t / P.pickupMs) };
    t -= P.pickupMs;
    if (t < P.waitMs) return { phase: "arrived", p: t / P.waitMs, left: 0 };
    t -= P.waitMs;
    if (t < P.tripMs) return { phase: "trip", p: t / P.tripMs, left: P.tripSim * (1 - t / P.tripMs) };
    return { phase: "finished", p: 1, left: 0 };
  }
  function onRidePhase(prev, phase) {
    const d = DEST[state.taxi.dest];
    const msg = {
      arrived: L("Серик подъехал. Белая Тойота Камри, номер семьсот семьдесят семь. Выходите не спеша.", "Серік келді. Ақ Тойота Камри, нөмірі жеті жүз жетпіс жеті. Асықпай шығыңыз."),
      trip: L("Поехали. Я скажу, когда приедем.", "Жүрдік. Жеткенде айтамын."),
      finished: L("Приехали. Хорошего дня!", "Жеттік. Күніңіз сәтті өтсін!")
    }[phase];
    if (msg && prev !== "wait") { speak(msg); if (state.screen !== "taxi") toast(msg, 4500); }
    if (state.screen === "taxi") renderTaxi();
    if (phase === "trip" || (phase === "finished" && prev !== "trip")) taxiFit(true);
    void d;
  }
  function taxiLive(now) {
    const s = state.taxi, r = ridePhase(now);
    if (!DEST[s.dest]) return;
    const eta = taxiQuote(s.dest).eta;
    if (r.phase !== s.phase) { const prev = s.phase; s.phase = r.phase; onRidePhase(prev, r.phase); return; }
    if (state.screen !== "taxi") return;
    const row = {
      wait:     [t("taxi.eta"), eta + " мин", L("Ждёт", "Күтуде"), "wait"],
      pickup:   [L("Приедет через", "Келуіне қалды"), clock(r.left), L("Едет к вам", "Сізге келе жатыр"), "live"],
      arrived:  [L("Машина", "Көлік"), L("Уже тут", "Келді"), L("Подъехал", "Келіп тұр"), "here"],
      trip:     [L("Доедем через", "Жетуге қалды"), clock(r.left), L("В пути", "Жолда"), "live"],
      finished: [L("Поездка", "Сапар"), L("На месте", "Жеттік"), L("Приехали", "Жеттік"), "here"]
    }[r.phase];
    const val = $("#taxiEta"), st = $("#taxiStatus");
    setText($("#taxiEtaLbl"), row[0]); setText(val, row[1]);
    val.classList.toggle("word", !/\d/.test(row[1]));
    setText(st, row[2]);
    if (st.className !== "driver-st " + row[3]) st.className = "driver-st " + row[3];
    if (taxiMap.car) LM.tag(taxiMap.car, r.phase === "wait" ? eta + " мин" : r.phase === "pickup" || r.phase === "trip" ? clock(r.left) : "");
  }

  /* ---- Bus on the route screen: approach → at the stop → departs → next one ---- */
  function busPlan(dest, first) {
    const nextSim = (first ? 3 + (DEST[dest].bus % 7) : 12) * 60;
    return { nextSim, approachMs: clamp(nextSim / DEMO, 20, 45) * 1000, dwellMs: 5000, departMs: 9000 };
  }
  function busPhase(now) {
    const s = state.route;
    if (!s.sim || s.sim.dest !== s.dest) s.sim = { dest: s.dest, t0: now, plan: busPlan(s.dest, true) };
    for (;;) {
      const P = s.sim.plan, total = P.approachMs + P.dwellMs + P.departMs;
      let t = now - s.sim.t0;
      if (t >= total) { s.sim = { dest: s.dest, t0: s.sim.t0 + total, plan: busPlan(s.dest, false) }; continue; }
      if (t < P.approachMs) return { phase: "approach", p: t / P.approachMs, left: P.nextSim * (1 - t / P.approachMs) };
      t -= P.approachMs;
      if (t < P.dwellMs) return { phase: "dwell", p: t / P.dwellMs, left: 0 };
      return { phase: "depart", p: (t - P.dwellMs) / P.departMs, left: 0 };
    }
  }
  function routeLive(now) {
    if (state.screen !== "route") return;
    const r = busPhase(now), val = $("#routeNext");
    const txt = r.phase === "approach" ? clock(r.left) : r.phase === "dwell" ? L("Сейчас", "Қазір") : L("Ушёл", "Кетті");
    setText(val, txt);
    val.classList.toggle("word", !/\d/.test(txt));
  }

  /* ---- Map views ---- */
  const maps = {};
  const MAP_EL = { taxi: "#taxiMap", route: "#routeMap" };
  let mapBroken = false;
  const taxiMap = { sig: "", group: null, car: null, parts: null, key: "" };
  const routeMap = { sig: "", group: null, bus: null, parts: null, key: "" };
  const desk = () => window.matchMedia("(min-width: 1024px)").matches;

  function mapLabels(v) {
    v.setLabels({ zoomIn: L("Приблизить", "Жақындату"), zoomOut: L("Отдалить", "Алыстату"),
      fit: L("Показать весь маршрут", "Бүкіл бағытты көрсету"),
      hint: L("Чтобы приблизить, нажмите на карту или «+»", "Жақындату үшін картаны не «+» басыңыз") });
  }
  function mapInsets(v) {
    const top = v.el.closest(".top"), r = v.el.getBoundingClientRect();
    if (!r.height) return;
    let tp = 10, bt = 10;
    [".bar", ".top-kicker"].forEach((sel) => {
      const e = top.querySelector(sel);
      if (e && e.offsetParent) { const q = e.getBoundingClientRect(); if (q.height) tp = Math.max(tp, q.bottom - r.top + 8); }
    });
    const q = top.querySelector(".quote");
    if (q) bt = Math.max(bt, r.bottom - q.getBoundingClientRect().top + 8);
    v.setInsets({ top: Math.round(tp), bottom: Math.round(bt), right: desk() ? 52 : 12, left: 12 });
  }
  function dropMaps() {
    mapBroken = true;
    Object.keys(MAP_EL).forEach((k) => { const top = $(MAP_EL[k]).closest(".top"); top.classList.remove("has-map"); top.classList.add("map-off"); });
  }
  function createMap(screen) {
    const el = $(MAP_EL[screen]), top = el.closest(".top");
    try {
      const shade = top.querySelector(".map-shade");
      const c = cityOf();
      maps[screen] = LM.create(el, {
        bounds: c ? c.bounds : null, center: c ? c.center : null,
        onReady: () => { if (mapBroken) return; top.classList.add("has-map"); setTimeout(() => refreshMap(screen), 700); },
        onFail: dropMaps
      });
      // the shade lives inside the map: over tiles and markers, under the zoom buttons
      if (shade) el.appendChild(shade);
      // the panel grows once the map appears (the quote moves down): fit again at the final size
      if (window.ResizeObserver) {
        let rt;
        new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => refreshMap(screen), 150); }).observe(el);
      }
    } catch (e) { dropMaps(); return; }
    mapLabels(maps[screen]);
    mapInsets(maps[screen]);
    if (screen === "taxi") syncTaxiMap(); else syncRouteMap();
  }
  function refreshMap(screen) {
    const v = maps[screen];
    if (!v || state.screen !== screen) return;
    requestAnimationFrame(() => { v.invalidate(); mapInsets(v); v.refit(false); });
  }
  function mapsOnShow(screen) {
    if (!MAP_EL[screen] || mapBroken || !LM) return;
    Promise.all([LM.load(), ensureRoutes()]).then(([ok]) => {
      if (!ok) { dropMaps(); return; }
      if (state.screen !== screen || !ROUTES) return;
      if (!maps[screen]) createMap(screen);
      refreshMap(screen);
    });
  }
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => refreshMap(state.screen), 180); });

  /* Taxi map: route (casing + marching dots), pickup path, pins, car */
  function taxiFit(animate) {
    const v = maps.taxi;
    if (!v || !ROUTES) return;
    const s = state.taxi, T = ROUTES.taxi[s.dest];
    if (!T) return;
    const pts =(s.phase === "trip" || s.phase === "finished") ? T.route : T.route.concat(T.pickup);
    v.invalidate(); mapInsets(v);
    v.fit(pts.concat([fromPoint(s.dest), ROUTES.points[s.dest]]), animate);
  }
  function syncTaxiMap() {
    const v = maps.taxi;
    if (!v || !ROUTES) return;
    const s = state.taxi, sig = state.settings.city + "|" + s.dest + "|" + state.lang;
    if (sig === taxiMap.sig || !ROUTES.taxi[s.dest]) return;
    const prev = taxiMap.sig ? taxiMap.sig.split("|") : null;
    const prevDest = prev && prev[0] === state.settings.city ? prev[1] : prev ? "" : null;   // "" = other city: fly
    taxiMap.sig = sig; taxiMap.key = "";
    if (taxiMap.group) taxiMap.group.remove();
    const g = taxiMap.group = v.group(), T = ROUTES.taxi[s.dest];
    v.line(g, T.route, "casing"); v.line(g, T.route, "mid");
    taxiMap.parts = { done: v.line(g, [], "done"), todo: v.line(g, T.route, "dots"), pick: v.line(g, T.pickup, "pickup") };
    v.marker(g, fromPoint(s.dest), v.icon.pinA(state.trip.from ? L("Отсюда", "Осы жерден") : L("Вы здесь", "Сіз осындасыз")), 100);
    v.marker(g, ROUTES.points[s.dest], v.icon.pinB(placeName(s.dest)), 200);
    taxiMap.car = v.marker(g, T.pickup[0], v.icon.car(), 500);
    mapLabels(v);
    moveTaxi(Date.now());
    taxiLive(Date.now());
    if (prevDest !== s.dest) taxiFit(prevDest != null);
  }
  function moveTaxi(now) {
    if (!maps.taxi || !taxiMap.car || !ROUTES) return;
    const s = state.taxi, T = ROUTES.taxi[s.dest];
    if (!T) return;
    const pick = geo("p" + s.dest, T.pickup), route = geo("r" + s.dest, T.route);
    const r = ridePhase(now);
    const p = LM.reduce ? Math.floor(r.p * 4) / 4 : r.p;
    const key = r.phase + p.toFixed(4);
    if (key === taxiMap.key) return;
    taxiMap.key = key;
    let pos, head, pickLeft = [], done = [], todo = T.route;
    if (r.phase === "wait") { pos = pick.pts[0]; head = LM.headingAt(pick, 0); pickLeft = T.pickup; }
    else if (r.phase === "pickup") { const dd = pick.total * ease(p); pos = LM.pointAt(pick, dd); head = LM.headingAt(pick, dd); pickLeft = LM.slice(pick, dd, pick.total); }
    else if (r.phase === "arrived") { pos = route.pts[0]; head = LM.headingAt(route, 0); }
    else if (r.phase === "trip") { const dd = route.total * ease(p); pos = LM.pointAt(route, dd); head = LM.headingAt(route, dd); done = LM.slice(route, 0, dd); todo = LM.slice(route, dd, route.total); }
    else { pos = route.pts[route.pts.length - 1]; head = LM.headingAt(route, route.total); done = T.route; todo = []; }
    taxiMap.car.setLatLng(pos);
    LM.rotate(taxiMap.car, head);
    taxiMap.parts.pick.setLatLngs(pickLeft);
    taxiMap.parts.done.setLatLngs(done);
    taxiMap.parts.todo.setLatLngs(todo);
  }

  /* Route map: walk (dotted) → bus line (solid) → walk, stops, live bus */
  function routeSegments(dest) {
    const B = ROUTES.bus[dest], last = B.bus[B.bus.length - 1];
    return [B.walk1.concat([B.bus[0]]), B.bus, [last].concat(B.walk2)];
  }
  function routeFit(animate) {
    const v = maps.route;
    if (!v || !ROUTES) return;
    const s = state.route, B = ROUTES.bus[s.dest];
    if (!B) return;
    const segs = routeSegments(s.dest);
    v.invalidate(); mapInsets(v);
    if (s.focus == null) v.fit(B.walk1.concat(B.bus, B.walk2, B.approach.slice(0, 1)), animate);
    else v.fit(segs[s.focus], animate, s.focus === 1 ? 16.25 : 17);
  }
  function highlightRoute() {
    const v = maps.route, P = routeMap.parts;
    if (!v || !P) return;
    const f = state.route.focus, on = (i) => f == null || f === i;
    P.walk1.setStyle({ opacity: on(0) ? 0.95 : 0.3, weight: f === 0 ? 7 : 5 });
    P.busCase.setStyle({ opacity: on(1) ? 0.72 : 0.25 });
    P.bus.setStyle({ opacity: on(1) ? 1 : 0.3, weight: f === 1 ? 9 : 7 });
    P.walk2.setStyle({ opacity: on(2) ? 0.95 : 0.3, weight: f === 2 ? 7 : 5 });
  }
  function syncRouteMap() {
    const v = maps.route;
    if (!v || !ROUTES) return;
    const s = state.route, sig = state.settings.city + "|" + s.dest + "|" + state.lang;
    if (sig === routeMap.sig || !ROUTES.bus[s.dest]) return;
    const prev = routeMap.sig ? routeMap.sig.split("|") : null;
    const prevDest = prev && prev[0] === state.settings.city ? prev[1] : prev ? "" : null;   // "" = other city: fly
    routeMap.sig = sig; routeMap.key = "";
    if (routeMap.group) routeMap.group.remove();
    const g = routeMap.group = v.group(), B = ROUTES.bus[s.dest], d = DEST[s.dest], nm = stopNames(s.dest);
    routeMap.parts = {
      approach: v.line(g, B.approach, "approach"),
      walk1: v.line(g, B.walk1, "walk"),
      busCase: v.line(g, B.bus, "busCase"),
      bus: v.line(g, B.bus, "bus"),
      walk2: v.line(g, B.walk2, "walk")
    };
    B.stops.forEach((p) => v.marker(g, p, v.icon.stop(), 40));
    v.marker(g, B.bus[0], v.icon.stop(L(nm.from.ru, nm.from.kk)), 60);
    v.marker(g, B.bus[B.bus.length - 1], v.icon.stop(L(nm.stop.ru, nm.stop.kk)), 60);
    v.marker(g, busFrom(s.dest), v.icon.pinA(L("Вы здесь", "Сіз осындасыз")), 100);
    v.marker(g, ROUTES.points[s.dest], v.icon.pinB(placeName(s.dest)), 200);
    routeMap.bus = v.marker(g, B.approach[0], v.icon.bus("№" + d.bus), 500);
    mapLabels(v);
    highlightRoute();
    moveBus(Date.now());
    routeLive(Date.now());
    if (prevDest !== s.dest) routeFit(prevDest != null);
  }
  function moveBus(now) {
    if (!maps.route || !routeMap.bus || !ROUTES) return;
    const s = state.route, B = ROUTES.bus[s.dest];
    if (!B) return;
    const ap = geo("a" + s.dest, B.approach), line = geo("b" + s.dest, B.bus);
    const r = busPhase(now);
    const p = LM.reduce ? Math.floor(r.p * 4) / 4 : r.p;
    const key = r.phase + p.toFixed(4);
    if (key === routeMap.key) return;
    routeMap.key = key;
    let pos, left = [];
    if (r.phase === "approach") { const dd = ap.total * ease(p); pos = LM.pointAt(ap, dd); left = LM.slice(ap, dd, ap.total); }
    else if (r.phase === "dwell") pos = B.bus[0];
    else pos = LM.pointAt(line, Math.min(line.total, 1500) * p);
    routeMap.bus.setLatLng(pos);
    const elx = routeMap.bus.getElement();
    if (elx) elx.classList.toggle("is-gone", r.phase === "depart" && p > 0.8);
    routeMap.parts.approach.setLatLngs(left);
  }

  function focusStep(i, text) {
    const s = state.route;
    s.focus = s.focus === i ? null : i;
    $$("#routeSteps li").forEach((li, j) => {
      li.classList.toggle("is-active", j === s.focus);
      const b = li.querySelector("button");
      if (b) b.setAttribute("aria-pressed", String(j === s.focus));
    });
    if (s.focus != null) speak(text);
    highlightRoute();
    routeFit(true);
  }

  /* Ticks: texts + phase changes 4×/s; markers every frame (or in steps with reduced motion) */
  setInterval(() => {
    const now = Date.now();
    taxiLive(now); routeLive(now);
    if (reduceMotion && !document.hidden) { if (state.screen === "taxi") moveTaxi(now); if (state.screen === "route") moveBus(now); }
  }, 250);
  if (!reduceMotion) {
    const frame = () => {
      if (!document.hidden) { const now = Date.now(); if (state.screen === "taxi") moveTaxi(now); else if (state.screen === "route") moveBus(now); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ==========================================================
     Screens
     ========================================================== */
  function renderHome() {
    ["taxi", "food", "services"].forEach((k) => {
      const on = state.settings.services[k];
      $(`.tile[data-go="${k}"]`).classList.toggle("is-off", !on);
      const lock = $(`[data-lock="${k}"]`);
      lock.hidden = on; lock.textContent = L("выкл.", "өшір.");
    });
    $('.family-link[data-go="family"] .mini-av').textContent = first() ? first().av : "?";
    $("#meAv").textContent = (userName().charAt(0) || "?").toUpperCase();
  }

  // «Едем домой» / «Едем по адресу»
  const chipTo = (k) => (k === "custom" ? { ru: "по адресу", kk: "мекенжайға" } : { ru: DEST[k].chip.ru.toLowerCase(), kk: DEST[k].chip.kk });
  // small note under the addresses: the home pin is the city's demo point until the address is found on the map
  function approxNote(node, uses) {
    const pf = profile();
    const show = uses && !pf.demo && !!pf.home && !homePt();
    node.hidden = !show;
    if (show) node.textContent = L("Точка дома на карте примерная — уточните адрес в «Мои данные».", "Картадағы үй нүктесі шамамен — мекенжайды «Менің деректерім» бөлімінде нақтылаңыз.");
  }
  function renderTaxi() {
    const s = state.taxi;
    if (!DEST[s.dest]) s.dest = "home";
    const d = DEST[s.dest], q = taxiQuote(s.dest);
    if (s.status !== "done") { s.ride = null; s.phase = "wait"; }
    const locked = s.status === "done" || s.status === "pending";
    $('[data-quote="taxi"]').textContent = s.quote || L("Скажите, куда поехать", "Қайда бару керегін айтыңыз");
    $("#taxiFrom").textContent = state.trip.from ? state.trip.from.label : s.dest === "home" ? L(ORIGIN.ru, ORIGIN.kk) : L(HOME_SHORT.ru, HOME_SHORT.kk);
    $("#taxiTo").textContent = L(d.ru, d.kk);
    $$("#taxiAddr [data-trip-edit]").forEach((b) => { b.disabled = locked; });
    $("#taxiReset").hidden = locked || !(state.trip.from || state.trip.to);
    approxNote($("#taxiNote"), !state.trip.from || s.dest === "home");
    $("#taxiPrice").textContent = "≈" + money(q.price);
    chipRow($("#taxiDest"), Object.keys(DEST), s.dest, (k) => L(DEST[k].chip.ru, DEST[k].chip.kk), (k) => {
      if (locked) return;
      s.dest = k; s.quote = null; editors.taxi.close(); renderTaxi();
    });
    const to = chipTo(s.dest);
    const label = { ru: "Такси: " + to.ru, kk: "Такси: " + to.kk, btn: L("Да, вызвать", "Иә, шақыру") };
    const doneText = {
      arrived: L("Серик подъехал: белая Camry, 777 AKA 01. Выходите не спеша", "Серік келді: ақ Camry, 777 AKA 01. Асықпай шығыңыз"),
      trip: L(`Едем ${to.ru}. Можно отдыхать`, `${s.dest === "custom" ? "Мекенжайға" : d.chip.kk} бара жатырмыз. Демала беріңіз`),
      finished: L("Приехали! Хорошего дня", "Жеттік! Күніңіз сәтті өтсін")
    }[s.phase] || L(`Такси вызвано — Серик будет через ${q.eta} мин`, `Такси шақырылды — Серік ${q.eta} минутта келеді`);
    const refund = () => { state.settings.spent = Math.max(0, state.settings.spent - (s.paid != null ? s.paid : q.price)); s.paid = null; };
    const extra = s.phase === "trip" ? null
      : s.phase === "finished" ? btn("btn-sub", L("Новая поездка", "Жаңа сапар"), () => { s.status = "draft"; s.paid = null; renderTaxi(); taxiFit(true); })
      : btn("btn-sub", L("Отменить поездку", "Сапарды болдырмау"), () => { s.status = "draft"; refund(); save(); renderTaxi(); taxiFit(true); });
    actions("taxi", "taxi", q.price, label, () => {
      finishOrder("taxi", q.price, label);
      s.paid = q.price;
      editors.taxi.close();
      s.ride = { t0: Date.now(), plan: ridePlan(s.dest) };
      s.phase = "pickup";
      // own addresses: the numbers are on screen, the phrase stays fixed so the recorded voice can say it
      speak(q.dyn ? L("Такси вызвано. Время подачи — на экране.", "Такси шақырылды. Келу уақыты — экранда.")
        : L(`Такси вызвано. Серик приедет через ${q.eta} ${plural(q.eta, ["минуту", "минуты", "минут"])}.`, `Такси шақырылды. Серік ${q.eta} минутта келеді.`));
      renderTaxi();
    }, doneText, extra);
    syncTaxiMap();
    taxiLive(Date.now());
  }

  function foodSum() {
    return Object.entries(state.food.items).reduce((a, [i, q]) => a + ITEMS[i].price * q, 0);
  }
  function renderFood() {
    const s = state.food;
    if (!s.items) s.items = Object.assign({}, USUAL);
    $('[data-quote="food"]').textContent = s.quote || L("Скажите, что купить", "Не алу керегін айтыңыз");
    const list = $("#foodList");
    list.innerHTML = "";
    const keys = Object.keys(s.items);
    const locked = s.status !== "draft";
    if (!keys.length) list.append(el("div", "empty", esc(L("Корзина пуста — добавьте продукты ниже", "Себет бос — төменнен қосыңыз"))));
    keys.forEach((i) => {
      const it = ITEMS[i], q = s.items[i];
      const row = el("div", "row row-food");
      row.append(el("span", "food-pic", pic("food", it.art, L(it.ru, it.kk))));
      row.append(el("div", "row-txt", `<b>${esc(L(it.ru, it.kk))}</b><small>${money(it.price)}</small>`));
      if (!locked) {
        const qty = el("div", "qty");
        const minus = btn("", "−", () => { if (--s.items[i] <= 0) delete s.items[i]; renderFood(); });
        minus.setAttribute("aria-label", L("Меньше", "Азайту"));
        const plus = btn("", "+", () => { s.items[i]++; renderFood(); });
        plus.setAttribute("aria-label", L("Больше", "Көбейту"));
        qty.append(minus, el("span", "", String(q)), plus);
        row.append(qty);
      } else row.append(el("span", "row-price", "× " + q));
      list.append(row);
    });
    const add = $("#foodAdd");
    add.innerHTML = "";
    add.hidden = locked;
    if (!locked) ITEMS.forEach((it, i) => {
      if (s.items[i]) return;
      const card = btn("food-card", "", () => { s.items[i] = 1; renderFood(); });
      card.innerHTML = `<span class="food-card-pic">${pic("food", it.art, "")}</span><b>${esc(L(it.ru, it.kk))}</b><small>${money(it.price)}</small><span class="food-card-add" aria-hidden="true">+</span>`;
      card.setAttribute("aria-label", L("Добавить: ", "Қосу: ") + L(it.ru, it.kk) + ", " + money(it.price));
      add.append(card);
    });
    const total = keys.length ? foodSum() + DELIVERY : 0;
    $("#foodTotal").textContent = money(total);
    const label = { ru: "Продукты", kk: "Азық-түлік", btn: L("Да, заказать", "Иә, тапсырыс беру") };
    if (!keys.length && s.status === "draft") { $('[data-actions="food"]').innerHTML = ""; $('[data-limit="food"]').textContent = ""; return; }
    actions("food", "food", total, label, () => {
      finishOrder("food", total, label);
      speak(L("Заказ принят, привезут примерно через сорок минут.", "Тапсырыс қабылданды, шамамен қырық минутта әкеледі."));
      renderFood();
    }, L("Заказ принят — привезут через ~40 мин", "Тапсырыс қабылданды — ~40 минутта әкеледі"),
    btn("btn-sub", L("Новый заказ", "Жаңа тапсырыс"), () => { s.status = "draft"; s.items = Object.assign({}, USUAL); renderFood(); }));
  }

  function renderRoute() {
    const s = state.route;
    if (!DEST[s.dest]) s.dest = "clinic";
    const d = DEST[s.dest], nm = stopNames(s.dest);
    $('[data-quote="route"]').textContent = s.quote || L("Скажите, куда нужно добраться", "Қайда бару керегін айтыңыз");
    $("#routeFrom").textContent = s.dest === "home" ? L(ORIGIN.ru, ORIGIN.kk) : L(HOME_SHORT.ru, HOME_SHORT.kk);
    $("#routeTo").textContent = L(d.ru, d.kk);
    $("#routeReset").hidden = !state.trip.to;
    approxNote($("#routeNote"), true);
    $("#routeBus").textContent = "№" + d.bus;
    chipRow($("#routeDest"), Object.keys(DEST), s.dest, (k) => L(DEST[k].chip.ru, DEST[k].chip.kk), (k) => { s.dest = k; s.quote = null; s.focus = null; editors.route.close(); renderRoute(); });
    // minutes on foot (elderly pace ~60 m/min) and bus stops come from the real street geometry
    const B = hasRoutes() ? ROUTES.bus[s.dest] : null;
    const w1 = B ? Math.max(1, Math.round(B.walk1Len / 60)) : 3;
    const w2 = B ? Math.max(1, Math.round(B.walk2Len / 60)) : 2;
    const stops = B ? B.stopsCount : 3 + (d.bus % 5);
    const ride = B ? Math.max(3, Math.round(B.len / 280)) : stops * 4;
    const MIN = ["минуту", "минуты", "минут"];
    const steps = [
      L(`Пешком ${w1} ${plural(w1, MIN)} до остановки ${nm.from.ru}`, `${nm.from.kk} аялдамасына жаяу ${w1} минут`),
      L(`Автобус №${d.bus}, ${stops} ${plural(stops, ["остановка", "остановки", "остановок"])} (~${ride} мин)`, `№${d.bus} автобус, ${stops} аялдама (~${ride} мин)`),
      L(`Выйти на остановке ${nm.stop.ru}, ${w2} ${plural(w2, MIN)} пешком`, `${nm.stop.kk} аялдамасында түсіп, жаяу ${w2} минут`)
    ];
    const ol = $("#routeSteps");
    ol.innerHTML = "";
    steps.forEach((x, i) => {
      const li = el("li", s.focus === i ? "is-active" : "");
      const b = btn("step-btn", x, () => focusStep(i, x));
      b.setAttribute("aria-pressed", String(s.focus === i));
      b.title = L("Показать на карте и озвучить", "Картада көрсету және айту");
      b.append(el("span", "step-pin", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>'));
      li.append(b);
      ol.append(li);
    });
    const a = $('[data-actions="route"]');
    a.innerHTML = "";
    a.append(btn("btn-main", L("Озвучить маршрут", "Бағытты айту"), () => speakSeq(steps)));
    a.append(btn("btn-sub", L("Не хочу ждать — вызвать такси", "Күткім келмейді — такси шақыру"), () => {
      Object.assign(state.taxi, { dest: s.dest, status: "draft", quote: null }); go("taxi");
    }));
    syncRouteMap();
    routeLive(Date.now());
  }

  /* ==========================================================
     Own «Откуда / Куда»: tap a row → type or dictate an address (live suggestions in the city),
     «Моё местоположение», «Дом» or one of the usual places. A typed destination becomes DEST.custom.
     ========================================================== */
  const NEAR_ADDR = { ru: "«Рядом с адресом»", kk: "«Мекенжай жанындағы»" };
  function setCustomTo(r) {
    const tail = r.district ? " — " + r.district : "";
    DEST.custom = { rx: /(?!)/, custom: true, ru: r.label + tail, kk: r.label + tail, chip: { ru: "Свой адрес", kk: "Өз мекенжайым" },
      price: 0, eta: 5, bus: 10 + Math.abs(Math.round(r.lat * 997 + r.lng * 991)) % 80, from: DEST.clinic.from, stop: NEAR_ADDR };
    state.trip.to = { lat: r.lat, lng: r.lng, label: r.label, city: state.settings.city };
    if (state.taxi.status === "draft") state.taxi.dest = "custom";
    state.route.dest = "custom"; state.route.focus = null;
    rebuildRoutes();
  }
  function setCustomFrom(r) {
    state.trip.from = { lat: r.lat, lng: r.lng, label: r.label, city: state.settings.city };
    rebuildRoutes();
  }
  function clearTrip() {
    state.trip = { from: null, to: null };
    delete DEST.custom;
    if (state.taxi.dest === "custom") state.taxi.dest = "home";
    if (state.route.dest === "custom") state.route.dest = "clinic";
    if (typeof editors !== "undefined") { editors.taxi.close(); editors.route.close(); }
  }
  function resetTrip() {
    if (state.taxi.status === "done" || state.taxi.status === "pending") return;
    clearTrip();
    rebuildRoutes();
    toast(L("Вернула обычные адреса", "Әдеттегі мекенжайлар қайтарылды"));
  }

  function tripEditor(screen) {
    const box = $(`#${screen}Edit`), input = $(`#${screen}EditInput`), list = $(`#${screen}EditSug`),
      status = $(`#${screen}EditStatus`), quick = $(`#${screen}EditQuick`), lbl = $(`#${screen}EditLbl`);
    let which = "to";
    const setStatus = (txt, cls) => { status.textContent = txt || ""; status.hidden = !txt; status.className = "geo-status" + (cls ? " " + cls : ""); };
    const sugg = GEOX ? GEOX.suggester((res) => show(res)) : null;
    function show(res) {
      list.innerHTML = "";
      if (!res) return setStatus("");
      if (res.error === "offline") return setStatus(L("Нет интернета — поиск адреса недоступен. Выберите место ниже.", "Интернет жоқ — мекенжай іздеу қолжетімсіз. Төменнен орын таңдаңыз."), "warn");
      if (res.error && !res.list.length) return setStatus(L("Карта не ответила. Попробуйте ещё раз или выберите место ниже.", "Карта жауап бермеді. Қайталап көріңіз не төменнен орын таңдаңыз."), "warn");
      if (!res.list.length) return setStatus(L(`В городе ${cityName()} такой адрес не нашёлся. Проверьте улицу и номер дома.`, `${cityName()} қаласында мұндай мекенжай табылмады. Көше мен үй нөмірін тексеріңіз.`), "warn");
      setStatus(L("Выберите нужный адрес:", "Керек мекенжайды таңдаңыз:"));
      res.list.forEach((r) => list.append(sugRow(r, () => choose(r))));
    }
    function choose(r) {
      close();
      if (which === "from") { setCustomFrom(r); speak(L("Хорошо. Откуда ехать — отметила на карте.", "Жарайды. Қай жерден шығатыныңызды картада белгіледім.")); }
      else { setCustomTo(r); speak(L("Нашла адрес. Проверьте на карте.", "Мекенжайды таптым. Картадан тексеріңіз.")); }
      render();
    }
    function preset(k) {
      close();
      if (which === "from") {
        if (k === "home" && !state.trip.from) { render(); return; }
        if (!ROUTES || !ROUTES.points[k]) return;
        const p = ROUTES.points[k];
        setCustomFrom({ lat: p[0], lng: p[1], label: k === "home" ? L(HOME_SHORT.ru, HOME_SHORT.kk) : L(DEST[k].ru, DEST[k].kk) });
      } else {
        state[screen].dest = k; state[screen].quote = null;
        if (screen === "route") state.route.focus = null;
        render();
      }
    }
    function locate() {
      if (!navigator.geolocation) return setStatus(L("Этот браузер не умеет определять место. Напишите адрес.", "Бұл браузер орынды анықтай алмайды. Мекенжайды жазыңыз."), "warn");
      setStatus(L("Определяю, где вы…", "Қай жерде екеніңізді анықтап жатырмын…"));
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const p = [+pos.coords.latitude.toFixed(6), +pos.coords.longitude.toFixed(6)];
        const c = cityOf();
        if (GEOX && c && !GEOX.inBounds(p, c.bounds))
          return setStatus(L(`Похоже, вы сейчас не в городе ${cityName()}. Напишите адрес или смените город.`, `${cityName()} қаласында емес сияқтысыз. Мекенжайды жазыңыз не қаланы ауыстырыңыз.`), "warn");
        const r = GEOX ? await GEOX.reverse(p[0], p[1]) : null;
        const here = L("Моё местоположение", "Менің орным");
        which = "from";
        choose({ lat: p[0], lng: p[1], label: r && r.label ? here + " · " + r.label : here });
      }, () => setStatus(L("Не удалось узнать, где вы. Разрешите доступ к геопозиции или напишите адрес.", "Орныңызды анықтау мүмкін болмады. Геолокацияға рұқсат беріңіз не мекенжайды жазыңыз."), "warn"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    }
    function renderQuick() {
      quick.innerHTML = "";
      const add = (text, fn, cls) => { const b = btn("chip" + (cls ? " " + cls : ""), text, fn); quick.append(b); };
      if (which === "from") add(L("Моё местоположение", "Менің орным"), locate, "chip-gps");
      add(L("Дом", "Үй"), () => preset("home"));
      ["clinic", "kid", "market"].forEach((k) => add(L(DEST[k].chip.ru, DEST[k].chip.kk), () => preset(k)));
    }
    input.addEventListener("input", () => {
      const v = input.value.trim();
      list.innerHTML = "";
      setStatus(v.replace(/[^0-9a-zа-яёәғқңөұүһі]/gi, "").length >= 3 && sugg ? L("Ищу…", "Іздеп жатырмын…") : "");
      if (sugg) sugg(v, state.settings.city);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    $(`#${screen}EditClose`).addEventListener("click", close);
    function open(w, pre) {
      which = w;
      box.hidden = false;
      lbl.textContent = w === "from" ? L("Откуда поедем?", "Қайдан шығамыз?") : screen === "taxi" ? L("Куда поехать?", "Қайда барамыз?") : L("Куда нужно добраться?", "Қайда бару керек?");
      input.placeholder = L("Улица и дом, например: Абая 150", "Көше мен үй, мысалы: Абай 150");
      $$(`#${screen}Addr [data-trip-edit]`).forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.tripEdit === w)));
      renderQuick();
      list.innerHTML = ""; setStatus("");
      input.value = pre && pre.query ? pre.query : "";
      if (pre && pre.res) show(pre.res);
      if (!pre) input.focus();
      box.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    }
    function close() {
      box.hidden = true; list.innerHTML = ""; setStatus("");
      $$(`#${screen}Addr [data-trip-edit]`).forEach((b) => b.setAttribute("aria-expanded", "false"));
    }
    return { open, close, get isOpen() { return !box.hidden; } };
  }
  var editors = { taxi: tripEditor("taxi"), route: tripEditor("route") };
  $$("[data-trip-edit]").forEach((b) => b.addEventListener("click", () => {
    const screen = b.closest("[data-screen]").dataset.screen, ed = editors[screen];
    if (ed.isOpen && b.getAttribute("aria-expanded") === "true") ed.close(); else ed.open(b.dataset.tripEdit);
  }));
  $("#taxiReset").addEventListener("click", resetTrip);
  $("#routeReset").addEventListener("click", resetTrip);

  // «такси до улицы Абая 150», «отвези на проспект Достык 5», «Абай көшесі 150-ге такси»
  const STREET_RX = /(улиц|ул\.|(^|\s)ул\s|проспект|просп|пр\.|пр-т|микрорайон|мкр|переул|бульвар|шоссе|көше|даңғыл|шағынауд|к-сі|тас жолы)/i;
  const looksLikeAddress = (s) => STREET_RX.test(s) || (/\d/.test(s) && !/(минут|час|сағат|человек|адам|тенге|теңге|₸)/i.test(s));
  const CMD_WORDS = new Set(("пожалуйста вызови вызовите вызвать закажи закажите заказать такси машину отвези отвезите довези довезите подвези подвезите " +
    "поехать поеду едем хочу мне меня нужно надо можно до на в во к ко по адресу адрес маршрут как доехать добраться дойти проехать автобус автобусом " +
    "покажи покажите скажи шақыр шақырыңыз шақырыңызшы апар апарыңыз апарыңызшы жеткіз жеткізіңіз барғым келеді қалай барамын бару барам жол көрсет " +
    "көрсетіңіз бағыт бағытын маған керек өтінемін мекенжай мекенжайға дейін").split(" "));
  function addrPart(text) {
    return text.split(/\s+/).filter((w) => !CMD_WORDS.has(w.toLowerCase().replace(/[.,!?«»"]/g, ""))).join(" ").replace(/^[,.\s]+|[,.!?\s]+$/g, "");
  }
  function askAddress(q, screen, quote) {
    if (screen === "taxi" && (state.taxi.status === "done" || state.taxi.status === "pending"))
      return reply(L("Поездка уже идёт. Сначала отмените её.", "Сапар жүріп жатыр. Алдымен оны болдырмаңыз."), "taxi");
    const wait = L("Ищу адрес…", "Мекенжайды іздеп жатырмын…");
    if (state.screen === "home") setReply(wait); else toast(wait);
    GEOX.search(q, state.settings.city).then((res) => {
      state[screen].quote = quote;
      const list = res.list || [], good = list.filter((r) => r.good);
      const sure = good.length === 1 || (good.length > 1 && good.every((r) => GEOX.haversine(r, good[0]) < 400));
      if (sure) {
        setCustomTo(good[0]);
        if (screen === "taxi") Object.assign(state.taxi, { dest: "custom", status: "draft" });
        return reply(screen === "taxi" ? L("Нашла такси. Цена и время — на экране. Вызвать?", "Такси таптым. Бағасы мен уақыты — экранда. Шақырайын ба?")
          : L("Нашла адрес. Проверьте на карте.", "Мекенжайды таптым. Картадан тексеріңіз."), screen);
      }
      reply(res.error && !list.length ? L("Нет связи с картой — не могу найти адрес. Выберите место из списка.", "Картамен байланыс жоқ — мекенжайды таба алмаймын. Тізімнен орын таңдаңыз.")
        : list.length ? L("Уточните адрес — выберите из списка.", "Мекенжайды нақтылаңыз — тізімнен таңдаңыз.")
        : L("Не нашла такой адрес. Скажите или напишите его иначе.", "Мұндай мекенжай табылмады. Басқаша айтып не жазып көріңіз."), screen);
      setTimeout(() => editors[screen].open("to", { query: q, res }), state.screen === "home" ? 1000 : 60);
    });
  }

  function renderServices() {
    const s = state.services, k = KINDS[s.kind];
    $('[data-quote="services"]').textContent = s.quote || L("Скажите, что случилось", "Не болғанын айтыңыз");
    const kinds = $("#servKinds");
    kinds.innerHTML = "";
    Object.keys(KINDS).forEach((key) => {
      const b = el("button", "kind", `${esc(L(KINDS[key].ru, KINDS[key].kk))}<small>${esc(L(KINDS[key].d.ru, KINDS[key].d.kk))}</small>`);
      b.type = "button";
      b.setAttribute("aria-pressed", String(key === s.kind));
      b.addEventListener("click", () => { if (s.status !== "draft") return; s.kind = key; s.quote = null; renderServices(); });
      kinds.append(b);
    });
    const st = STAFF[s.kind];
    const prof = $("#servStaff");
    const yrs = (n) => L(`${n} ${plural(n, ["год", "года", "лет"])}`, `${n} жыл`);
    prof.innerHTML = `
      <div class="staff-head">
        <span class="staff-pic">${pic("staff", s.kind, "")}</span>
        <div class="staff-id">
          <small>${esc(L(k.ru, k.kk))}</small>
          <h3>${esc(L(st.name.ru, st.name.kk))}</h3>
          <span class="staff-rate"><b>★ ${st.rating.toFixed(1)}</b> · ${st.reviews} ${esc(L("отзывов", "пікір"))}</span>
          <span class="staff-check">${esc(L("Документы проверены", "Құжаттары тексерілген"))}</span>
        </div>
      </div>
      <div class="staff-stats">
        <div><b>${esc(yrs(st.exp))}</b><small>${esc(L("опыт работы", "тәжірибе"))}</small></div>
        <div><b>${st.jobs.toLocaleString("ru-RU")}</b><small>${esc(L("выполнено заказов", "орындалған тапсырыс"))}</small></div>
      </div>
      <p class="staff-bio">${esc(L(st.bio.ru, st.bio.kk))}</p>
      <div class="staff-tags">${L(st.tags.ru, st.tags.kk).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
      <blockquote class="staff-review">${esc(L(st.review.ru, st.review.kk))}</blockquote>`;
    const info = $("#servInfo");
    info.innerHTML = "";
    [[L("Когда", "Қашан"), L(k.when.ru, k.when.kk)], [L(k.priceLbl.ru, k.priceLbl.kk), money(k.price)]]
      .forEach(([a, b]) => info.append(el("div", "row", `<div class="row-txt"><small>${esc(a)}</small><b>${esc(b)}</b></div>`)));
    const label = { ru: k.ru, kk: k.kk, btn: L("Да, вызвать мастера", "Иә, шеберді шақыру") };
    actions("services", "services", k.price, label, () => {
      finishOrder("services", k.price, label);
      speak(L("Записала. Специалист позвонит перед приходом.", "Жаздым. Маман келер алдында қоңырау шалады."));
      renderServices();
    }, L(`Записано: ${k.when.ru}. Позвонят заранее`, `Жазылды: ${k.when.kk}. Алдын ала қоңырау шалады`),
    btn("btn-sub", L("Отменить", "Болдырмау"), () => { s.status = "draft"; state.settings.spent -= k.price; save(); renderServices(); }));
    if (!state.settings.services.services) $('[data-limit="services"]').textContent = "";
  }

  function toggleRow(title, sub, on, onChange) {
    const row = el("div", "row");
    row.append(el("div", "row-txt", `<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}`));
    const sw = document.createElement("button");
    sw.type = "button"; sw.className = "switch";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(on));
    sw.setAttribute("aria-label", title);
    sw.addEventListener("click", () => onChange(!on));
    row.append(sw);
    return row;
  }

  function renderFamily() {
    $("#famAv").textContent = (userName().charAt(0) || "?").toUpperCase();
    const pf = profile();
    const sum = $("#famProfile");
    sum.innerHTML = "";
    const role = roleOf(), me = state.settings.contacts[0] && state.settings.contacts[0].me ? state.settings.contacts[0] : null;
    const who = L(ROLES[role].ru, ROLES[role].kk) + (me ? (me.org ? ` «${me.org}»` : "") + " — " + me.name : "");
    const fr = $("#famRole");
    fr.hidden = role === "self" || !me;
    if (!fr.hidden) fr.innerHTML = `<b>${esc(role === "staff" ? L("Вы — сотрудник центра ухода", "Сіз — күтім орталығының қызметкерісіз") : L("Вы — опекун", "Сіз — қамқоршысыз"))}</b>` +
      `<span>${esc(L(`Здесь вы управляете помощником для: ${pf.name}. Вы — первый в списке звонков.`, `Мұнда сіз мына адамның көмекшісін басқарасыз: ${pf.name}. Қоңырау тізімінде сіз біріншісіз.`))}</span>`;
    [[L("Имя", "Аты"), pf.name], [L("Город", "Қала"), cityName(pf.city)], [L("Адрес", "Мекенжай"), L(DEST.home.ru, DEST.home.kk).replace(/^(Дом|Үй) — /, "")],
     [L("Кто заполнил", "Кім толтырды"), who]]
      .forEach(([a, b]) => sum.append(el("div", "row", `<div class="row-txt"><small>${esc(a)}</small><b>${esc(b)}</b></div>`)));
    if (pf.demo) sum.append(el("p", "pf-demo-note", esc(L("Сейчас стоят демо-данные. Заполните свои — это займёт минуту.", "Қазір демо-деректер тұр. Өзіңіздікін толтырыңыз — бір минут."))));
    sum.append(btn("pill-btn", L("Изменить данные", "Деректерді өзгерту"), () => go("profile")));
    const st = state.settings;
    const cl = $("#famContacts");
    cl.innerHTML = "";
    st.contacts.forEach((c, i) => {
      const row = el("div", "row");
      row.append(el("span", "av av-" + c.color, esc(c.av)));
      row.append(el("div", "row-txt", `<b>${esc(L(c.ru, c.kk))}</b><small>${esc(c.phone)}</small>`));
      const tag = btn("row-tag" + (i ? " second" : ""), i ? L("Второй", "Екінші") : L("Первый", "Бірінші"), () => {
        st.contacts.reverse();
        if (st.profile) { st.profile.contacts = st.profile.contacts.filter((x) => x && x.name).reverse(); }
        st.contacts = buildContacts(profile()); applyProfile(); save(); renderFamily();
        toast(L("Порядок звонков изменён", "Қоңырау реті өзгертілді"));
      });
      tag.title = L("Поменять порядок", "Ретін ауыстыру");
      row.append(tag);
      cl.append(row);
    });

    const sv = $("#famServices");
    sv.innerHTML = "";
    [["taxi", L("Такси", "Такси"), L("Яндекс Go, inDrive", "Яндекс Go, inDrive")],
     ["food", L("Продукты", "Азық-түлік"), L("Доставка", "Жеткізу")],
     ["services", L("Бытовые услуги", "Тұрмыстық қызметтер"), L("Мастера, уборка", "Шеберлер, тазалау")]]
      .forEach(([k, a, b]) => sv.append(toggleRow(a, b, st.services[k], (v) => { st.services[k] = v; save(); renderFamily(); })));

    const sf = $("#famSafety");
    sf.innerHTML = "";
    sf.append(toggleRow(L("Сверх лимита — ко мне на подтверждение", "Лимиттен асса — маған растауға"), L("Иначе такой заказ не оформится", "Әйтпесе тапсырыс берілмейді"), st.askOverLimit, (v) => { st.askOverLimit = v; save(); renderFamily(); }));
    sf.append(toggleRow(L(`Видеть заказы: ${userName()}`, `Тапсырыстарды көру: ${userName()}`), L(`Только если ${userName()} не против`, `Тек ${userName()} келіссе ғана`), st.seeOrders, (v) => { st.seeOrders = v; save(); renderFamily(); }));
    sf.append(el("div", "row", `<div class="row-txt"><b>${esc(L("«Позвать на помощь»", "«Көмекке шақыру»"))}</b><small>${esc(L("Звоним по порядку контактов, затем оператору и в 103", "Байланыстар ретімен, сосын операторға және 103-ке"))}</small></div>`));

    $("#famLimit").textContent = money(st.limit);
    $("#famSpent").textContent = L(`Потрачено ${money(st.spent)} · осталось ${money(left())}`, `Жұмсалды ${money(st.spent)} · қалды ${money(left())}`);
    $("#limitVal").textContent = money(st.limit);

    const lg = $("#famLog");
    lg.innerHTML = "";
    if (!state.log.length) lg.append(el("div", "empty", esc(L("Пока запросов нет", "Әзірге өтініш жоқ"))));
    state.log.slice(0, 8).forEach((x) => {
      const row = el("div", "row");
      const time = new Date(x.time).toLocaleTimeString(state.lang === "kk" ? "kk-KZ" : "ru-RU", { hour: "2-digit", minute: "2-digit" });
      row.append(el("div", "row-txt", `<b>${esc(L(x.ru, x.kk))}</b><small>${esc(time)}</small>`));
      if (x.status === "pending" && pendingApprovals.has(x.time)) row.append(btn("mini-btn", L("Одобрить", "Мақұлдау"), () => approve(x.time)));
      else if (x.status === "pending" && x.kind === "enable") row.append(btn("mini-btn", L("Включить", "Қосу"), () => { st.services[x.service] = true; x.status = "ok"; save(); renderFamily(); }));
      else if (x.status === "ok") row.append(el("span", "log-ok", "✓"));
      lg.append(row);
    });
  }
  $("#limitEdit").addEventListener("click", () => { const b = $("#limitBox"); b.hidden = !b.hidden; });
  $$("[data-step]").forEach((b) => b.addEventListener("click", () => {
    const st = state.settings;
    st.limit = Math.min(100000, Math.max(5000, st.limit + +b.dataset.step));
    save(); renderFamily();
  }));

  /* ==========================================================
     City: overview of Kazakhstan + list (family card, picker on taxi / route).
     The list works without the map library; the overview is a plain SVG.
     ========================================================== */
  function setCity(id, opts) {
    opts = opts || {};
    const c = cityOf(id);
    if (!c) return;
    if (id !== state.settings.city) {
      // a ride under way belongs to the old city: cancel it and give the money back
      const tx = state.taxi;
      if (tx.status === "done" && tx.phase !== "finished") state.settings.spent = Math.max(0, state.settings.spent - (tx.paid != null ? tx.paid : taxiQuote(tx.dest).price));
      if (tx.status !== "pending") Object.assign(tx, { status: "draft", ride: null, phase: "wait" });
      tx.quote = null;
      Object.assign(state.route, { sim: null, focus: null, quote: null });
      state.settings.city = id; save();
      // own «Откуда / Куда» belong to the old city
      clearTrip();
      cityTexts(id);
      BASE = cityRoutes();
      ROUTES = buildRoutes();
      Object.keys(maps).forEach((k) => maps[k].setCity(c.bounds));
      ensureRoutes();
      render();
    }
    if (!opts.silent) reply(L(`Хорошо, город — ${c.name.ru}. Адреса и маршруты обновила.`, `Жақсы, қала — ${c.name.kk}. Мекенжайлар мен бағыттарды жаңарттым.`));
  }

  const SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }
  // Kazakhstan outline (Overture divisions, pre-projected in cities.js) with tappable city dots
  function kzOverview(box, onPick) {
    const O = KZ && KZ.outline;
    if (!O) { box.hidden = true; return; }
    const cur = state.settings.city;
    box.innerHTML = "";
    const svg = svgEl("svg", { viewBox: `0 0 ${O.w} ${O.h}`, class: "kz-svg", role: "img", "aria-label": L(`Карта Казахстана, выбран город ${cityName()}`, `Қазақстан картасы, таңдалған қала: ${cityName()}`) }, box);
    svgEl("path", { d: O.d, class: "kz-shadow", transform: "translate(7 10)" }, svg);
    svgEl("path", { d: O.d, class: "kz-land" }, svg);
    const pins = svgEl("g", { class: "kz-pins" }, svg);
    CITY_IDS.filter((id) => id !== cur).concat([cur]).forEach((id) => {
      const c = cityOf(id);
      if (!c) return;
      const on = id === cur, [x, y] = c.xy, [dx, dy, anchor] = c.label;
      const g = svgEl("g", { class: "kz-pin" + (on ? " on" : ""), transform: `translate(${x} ${y})` }, pins);
      g.addEventListener("click", () => onPick(id));
      svgEl("circle", { r: 44, class: "kz-hit" }, g);
      if (on) svgEl("circle", { r: 16, class: "kz-halo" }, g);
      svgEl("circle", { r: on ? 15 : 10, class: "kz-dot" }, g);
      const tx = svgEl("text", { x: dx, y: dy, "text-anchor": anchor, class: "kz-name" }, g);
      tx.textContent = L(c.name.ru, c.name.kk);
    });
  }
  function cityList(box, onPick) {
    box.innerHTML = "";
    CITY_IDS.forEach((id) => {
      const c = cityOf(id);
      if (!c) return;
      const nm = L(c.name.ru, c.name.kk);
      const b = btn("city-btn" + (nm.length > 11 ? " long" : ""), nm, () => onPick(id));
      b.setAttribute("aria-pressed", String(id === state.settings.city));
      box.append(b);
    });
  }
  function renderCity() {
    const name = cityName();
    $$("[data-city-name]").forEach((e) => setText(e, name));
    const tm = $("#taxiMap"), rm = $("#routeMap");
    if (tm) tm.setAttribute("aria-label", L(`Карта поездки: ${name}`, `Сапар картасы: ${name}`));
    if (rm) rm.setAttribute("aria-label", L(`Карта маршрута автобуса: ${name}`, `Автобус бағытының картасы: ${name}`));
    if (state.screen === "family") {
      const pick = (id) => setCity(id);
      kzOverview($("#famCity [data-kz]"), pick);
      cityList($("#famCity [data-city-list]"), pick);
      const d = DEST.home;
      setText($("#famCityNote"), L(`${name}: ${d.ru.split(", кв.")[0]}. Такси, маршруты и остановки — по улицам этого города.`,
        `${name}: ${d.kk.replace(/, [^,]*-пәтер$/, "")}. Такси, бағыттар мен аялдамалар — осы қаланың көшелерімен.`));
    }
    if (!$("#cityOverlay").hidden) renderCityPicker();
  }

  // compact picker on the taxi / route screens
  let cityFocus = null;
  function renderCityPicker() {
    const pick = (id) => { closeCityPicker(); setCity(id); };
    kzOverview($("#cityOverlay [data-kz]"), pick);
    cityList($("#cityOverlay [data-city-list]"), pick);
  }
  function openCityPicker() {
    cityFocus = document.activeElement;
    $("#cityOverlay").hidden = false;
    renderCityPicker();
    const b = $('#cityOverlay .city-btn[aria-pressed="true"]') || $("#cityClose");
    b.focus();
  }
  function closeCityPicker() {
    $("#cityOverlay").hidden = true;
    if (cityFocus && cityFocus.focus) cityFocus.focus();
  }
  $$("[data-city-open]").forEach((b) => b.addEventListener("click", openCityPicker));
  $("#cityClose").addEventListener("click", closeCityPicker);
  $("#cityOverlay").addEventListener("click", (e) => { if (e.target.id === "cityOverlay") closeCityPicker(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#cityOverlay").hidden) closeCityPicker(); });

  function render() {
    renderHome();
    ({ taxi: renderTaxi, food: renderFood, route: renderRoute, services: renderServices, family: renderFamily, profile: renderProfile }[state.screen] || (() => {}))();
    renderCity();
  }

  /* ==========================================================
     "Позвать на помощь": relatives in order → operator → 103
     ========================================================== */
  let helpIdx = 0, helpTimer = null, lastFocus = null;
  function helpChain() {
    return state.settings.contacts.map((c) => ({ name: L(c.ru, c.kk), short: L(c.short.ru, c.short.kk), phone: c.phone, av: c.av, color: c.color }))
      .concat([{ name: L("Оператор INDEPENDENT", "INDEPENDENT операторы"), short: L("оператору", "операторға"), phone: L("живой человек, 24/7", "тірі адам, 24/7"), av: "☎", color: "mint" }]);
  }
  function openHelp(start, single) {
    lastFocus = document.activeElement;
    helpIdx = start || 0;
    $("#helpOverlay").hidden = false;
    if (!single) addLog({ kind: "help", ru: "Нажала «Позвать на помощь»", kk: "«Көмекке шақыру» басты", status: "ok" });
    renderHelp();
    $("#helpClose").focus();
  }
  function renderHelp() {
    const chain = helpChain();
    const c = chain[helpIdx];
    const av = $("#helpAv");
    av.className = "av av-lg av-" + c.color; av.textContent = c.av;
    $("#helpTitle").textContent = L("Звоним ", "Қоңырау: ") + c.short;
    $("#helpText").textContent = c.phone + " · " + L("имитация звонка", "қоңырау имитациясы");
    const steps = $("#helpSteps");
    steps.innerHTML = "";
    chain.forEach((x, i) => {
      const d = el("div", "help-step" + (i === helpIdx ? " now" : i < helpIdx ? " skip" : ""), `${i + 1}. ${esc(x.name)}<i>${i === helpIdx ? esc(L("звоним…", "қоңырау…")) : i < helpIdx ? esc(L("не ответил", "жауап жоқ")) : ""}</i>`);
      steps.append(d);
    });
    $("#helpNext").hidden = helpIdx >= chain.length - 1;
    speak(L("Звоню " + c.short, c.short + " қоңырау шалып жатырмын"));
    clearTimeout(helpTimer);
    if (helpIdx < chain.length - 1) helpTimer = setTimeout(nextHelp, 9000);
  }
  function nextHelp() { const n = helpChain().length; if (helpIdx < n - 1) { helpIdx++; renderHelp(); } }
  function closeHelp() {
    clearTimeout(helpTimer);
    $("#helpOverlay").hidden = true;
    stopSpeech();
    if (state.screen === "home") setIdleHint();
    if (state.screen === "family") renderFamily();
    if (lastFocus) lastFocus.focus();
  }
  $$("#helpBtn, [data-help]").forEach((b) => b.addEventListener("click", () => openHelp(0)));
  $("#helpNext").addEventListener("click", nextHelp);
  $("#helpClose").addEventListener("click", closeHelp);
  $("#help103").addEventListener("click", () => {
    clearTimeout(helpTimer);
    $("#helpTitle").textContent = L("Вызываем скорую 103", "Жедел жәрдем 103 шақырылуда");
    $("#helpText").textContent = L(`В рабочей версии — звонок 103 и SMS ${first().short.ru} с вашим адресом.`, `Жұмыс нұсқасында — 103-ке қоңырау және ${first().short.kk} мекенжайыңызбен SMS.`);
    speak($("#helpTitle").textContent);
  });
  $("#helpOverlay").addEventListener("click", (e) => { if (e.target.id === "helpOverlay") closeHelp(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#helpOverlay").hidden) closeHelp(); });

  /* ==========================================================
     Address fields with the real map: live suggestions (Nominatim, bounded to the city),
     «Мы нашли: … — верно?» before going on, a mini preview of the found point.
     Without the network the text is kept and the map uses the city's demo point.
     ========================================================== */
  const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>';
  function sugRow(r, onPick) {
    const b = el("button", "geo-row");
    b.type = "button";
    b.innerHTML = `<span class="geo-row-ico">${PIN_SVG}</span><span class="geo-row-txt"><b>${esc(r.label)}</b>${r.district ? `<small>${esc(r.district)}</small>` : ""}${r.approx ? `<small class="geo-approx">${esc(L("дом на карте не отмечен — точка на улице", "үй картада белгіленбеген — нүкте көшеде"))}</small>` : ""}</span>`;
    b.addEventListener("click", () => onPick(r));
    return b;
  }
  // a small static map with the found point (when Leaflet is available), otherwise just the text
  function miniMap(box, g) {
    if (!box) return;
    if (!LM || mapBroken) { box.remove(); return; }
    LM.load().then((ok) => {
      if (!ok || !box.isConnected) { box.remove(); return; }
      try { LM.mini(box, [g.lat, g.lng], g.label); } catch (e) { box.remove(); }
    });
  }
  const GEO_MSG = {
    offline: () => L("Нет связи с картой. Адрес сохраним текстом, точку на карте уточним позже.", "Картамен байланыс жоқ. Мекенжайды мәтінмен сақтаймыз, нүктені кейін нақтылаймыз."),
    error: () => L("Карта сейчас не отвечает. Адрес сохраним текстом, точку уточним позже.", "Карта қазір жауап бермейді. Мекенжайды мәтінмен сақтаймыз, нүктені кейін нақтылаймыз."),
    none: (city) => L(`В городе ${city} такой адрес не нашёлся. Проверьте улицу и номер дома — или оставьте как написано: точка дома на карте будет примерной.`,
      `${city} қаласында мұндай мекенжай табылмады. Көше мен үй нөмірін тексеріңіз — не жазылғандай қалдырыңыз: картадағы үй нүктесі шамамен болады.`)
  };
  function addrField(o) {
    const st = { geo: null, text: "", skip: false, busy: false };
    o.box.innerHTML = '<p class="geo-status" aria-live="polite" hidden></p><div class="geo-sug"></div><div class="geo-found" hidden></div>';
    const status = o.box.querySelector(".geo-status"), list = o.box.querySelector(".geo-sug"), found = o.box.querySelector(".geo-found");
    const setStatus = (txt, cls) => { status.textContent = txt || ""; status.hidden = !txt; status.className = "geo-status" + (cls ? " " + cls : ""); };
    const cityId = () => o.city() || state.settings.city;
    const sugg = GEOX ? GEOX.suggester((res) => { if (!st.geo && !st.busy) showList(res); }) : null;
    function showList(res) {
      list.innerHTML = "";
      if (!res) return setStatus("");
      if (res.error) return setStatus(GEO_MSG[res.error === "offline" ? "offline" : "error"](), "warn");
      if (!res.list.length) return setStatus(L("Пока ничего не нашлось — допишите улицу и номер дома.", "Әзірге ештеңе табылмады — көше мен үй нөмірін толық жазыңыз."));
      setStatus(L("Нажмите на свой адрес:", "Мекенжайыңызды басыңыз:"));
      res.list.forEach((r) => list.append(sugRow(r, () => pick(r))));
    }
    function pick(r) {
      const p = GEOX ? GEOX.parse(o.input.value, (cityOf(cityId()) || {}).rx) : null;
      if (p && p.flat && o.flat && !o.flat.value) o.flat.value = p.flat;
      st.geo = { lat: r.lat, lng: r.lng, label: r.label, district: r.district || "", city: cityId() };
      o.input.value = r.label; st.text = r.label; st.skip = false;
      list.innerHTML = ""; setStatus("");
      confirmed(st.geo);
    }
    function confirmed(g) {
      found.hidden = false; found.className = "geo-found ok";
      found.innerHTML = `<div class="geo-mini"></div><p class="geo-ok"><span class="geo-tick" aria-hidden="true">✓</span><span>${esc(L("Точка на карте:", "Картадағы нүкте:"))} <b>${esc(g.label)}</b>${g.district ? `<small>${esc(g.district)}</small>` : ""}</span></p>`;
      miniMap(found.querySelector(".geo-mini"), g);
    }
    function keep() { st.skip = true; st.geo = null; st.text = o.input.value.trim(); found.hidden = true; setStatus(""); if (o.proceed) o.proceed(); }
    function panel(html, buttons) {
      found.hidden = false; found.className = "geo-found ask";
      found.innerHTML = html;
      const row = el("div", "geo-btns");
      buttons.forEach((b) => row.append(b));
      found.append(row);
    }
    function ask(res) {
      const r = res.list[0];
      panel(`<p class="geo-q">${esc(L("Мы нашли:", "Таптық:"))} <b>${esc(r.label)}</b>${r.district ? `<small>${esc(r.district)}</small>` : ""}${r.approx ? `<small class="geo-approx">${esc(L("дом на карте не отмечен — точка на улице", "үй картада белгіленбеген — нүкте көшеде"))}</small>` : ""}<span class="geo-q-end">${esc(L("Верно?", "Дұрыс па?"))}</span></p><div class="geo-mini"></div>`,
        [btn("btn-main geo-yes", L("Да, верно", "Иә, дұрыс"), () => { pick(r); if (o.proceed) o.proceed(); }),
         btn("btn-sub", L("Оставить как написано", "Жазғанымдай қалдыру"), keep)]);
      miniMap(found.querySelector(".geo-mini"), r);
      if (res.list.length > 1) {
        found.append(el("p", "geo-more", esc(L("Или выберите другой:", "Немесе басқасын таңдаңыз:"))));
        res.list.slice(1).forEach((x) => found.append(sugRow(x, () => { pick(x); if (o.proceed) o.proceed(); })));
      }
      speak(L("Нашла адрес. Проверьте на карте.", "Мекенжайды таптым. Картадан тексеріңіз."));
    }
    o.input.addEventListener("input", () => {
      const v = o.input.value.trim();
      if (st.geo && v !== st.text) st.geo = null;
      st.skip = false;
      if (!st.geo) {
        found.hidden = true;
        setStatus(v.replace(/[^0-9a-zа-яёәғқңөұүһі]/gi, "").length >= 3 && sugg ? L("Ищу на карте…", "Картадан іздеп жатырмын…") : "");
        if (sugg) sugg(v, cityId());
      }
    });
    const api = {
      load(g, text, approx) {
        st.geo = g && g.lat ? Object.assign({}, g) : null; st.text = text || ""; st.skip = !st.geo && !!text && !!approx;
        list.innerHTML = ""; setStatus(""); found.hidden = true;
        if (st.geo) confirmed(st.geo);
      },
      value() { const v = o.input.value.trim(); return st.geo && st.geo.city === cityId() && v && v === st.text ? { lat: st.geo.lat, lng: st.geo.lng, label: st.geo.label, city: st.geo.city } : null; },
      skipped() { return st.skip && o.input.value.trim() === st.text; },
      // true: go on; false: we are searching or asking «верно?»
      ready() {
        const v = o.input.value.trim();
        if (!v || api.skipped() || api.value() || !GEOX) return true;
        if (st.busy) return false;
        st.busy = true; list.innerHTML = ""; found.hidden = true;
        setStatus(L("Ищу адрес на карте…", "Мекенжайды картадан іздеп жатырмын…"));
        GEOX.search(v, cityId()).then((res) => {
          st.busy = false; setStatus("");
          if (o.input.value.trim() !== v) return;
          if (res.error && !res.list.length) {
            panel(`<p class="geo-q warn">${esc(GEO_MSG[res.error === "offline" ? "offline" : "error"]())}</p>`, [btn("btn-main", L("Продолжить", "Жалғастыру"), keep)]);
          } else if (!res.list.length) {
            panel(`<p class="geo-q warn">${esc(GEO_MSG.none(cityName(cityId())))}</p>`, [btn("btn-sub", L("Оставить как написано", "Жазғанымдай қалдыру"), keep)]);
            speak(L("Не нашла такой адрес. Проверьте улицу и номер дома.", "Мұндай мекенжай табылмады. Көше мен үй нөмірін тексеріңіз."));
          } else ask(res);
          found.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
        });
        return false;
      }
    };
    return api;
  }

  /* ==========================================================
     Profile screen: 5-step registration on first run (who fills it in → name → city → address → contacts),
     one form for later edits
     ========================================================== */
  const PF_STEPS = 5;
  let pfStep = 0, pfDraft = null;
  const onboarding = () => !state.settings.profile;
  const pfForm = $("#pfForm");
  const fld = (n) => pfForm.elements[n];
  const pfRole = () => (pfDraft && pfDraft.role) || "self";
  const homeAddr = addrField({ input: fld("home"), box: $("#pfHomeGeo"), flat: fld("flat"), city: () => $("#pfCity").value, proceed: () => pfForm.requestSubmit() });
  const c0Addr = addrField({ input: fld("c0addr"), box: $("#pfC0Geo"), city: () => $("#pfCity").value, proceed: () => pfForm.requestSubmit() });
  function fillRelSelects() {
    $$("[data-rel-select]", pfForm).forEach((sel) => {
      const v = sel.value;
      const keys = Object.keys(REL).filter((k) => !(k === "centre" && sel.dataset.relSelect === "guardian"));
      sel.innerHTML = keys.map((k) => `<option value="${k}">${esc(L(REL[k].ru.nom, REL[k].kk.nom))}</option>`).join("");
      if (v) sel.value = v;
    });
    const cs = $("#pfCity"), cv = cs.value;
    cs.innerHTML = CITY_IDS.filter((id) => cityOf(id)).map((id) => `<option value="${id}">${esc(cityName(id))}</option>`).join("");
    if (cv) cs.value = cv;
  }
  function pfLoad() {
    const pf = state.settings.profile || Object.assign({}, DEMO_PROFILE, { role: null, name: "", home: "", flat: "", demo: false, lang: state.lang, city: state.settings.city,
      contacts: [{ name: "", rel: "daughter", phone: "", addr: "" }, { name: "", rel: "son", phone: "" }] });
    const role = pf.role || (state.settings.profile ? "self" : null);
    fillRelSelects();
    fld("name").value = pf.name || "";
    $("#pfCity").value = pf.city || state.settings.city;
    fld("home").value = pf.home || ""; fld("flat").value = pf.flat || "";
    homeAddr.load(pf.homeGeo, pf.home, pf.homeApprox);
    const cs = pf.contacts.slice();
    const me = cs[0] && cs[0].me ? cs[0] : null;
    ["gName", "gPhone", "sOrg", "sName", "sPhone", "c0name", "c0phone", "c0addr", "c1name", "c1phone"].forEach((n) => { fld(n).value = ""; });
    fld("gRel").value = "daughter";
    if (me && role === "guardian") { fld("gName").value = me.name || ""; fld("gRel").value = me.rel || "other"; fld("gPhone").value = me.phone || ""; }
    if (me && role === "staff") { fld("sOrg").value = me.org || ""; fld("sName").value = me.name || ""; fld("sPhone").value = me.phone || ""; }
    [0, 1].forEach((i) => {
      const c = (me && i === 0 ? null : cs[i]) || { name: "", rel: i ? "son" : "daughter", phone: "" };
      fld(`c${i}name`).value = c.name || ""; fld(`c${i}rel`).value = c.rel || "other"; fld(`c${i}phone`).value = c.phone || "";
    });
    fld("c0addr").value = (cs[0] && cs[0].addr) || "";
    c0Addr.load(cs[0] && cs[0].geo, fld("c0addr").value, false);
    pfDraft = { lang: pf.lang || state.lang, role };
  }
  function pfRead() {
    const v = (n) => (fld(n) && fld(n).value || "").trim().replace(/\s+/g, " ");
    const role = pfRole();
    const contacts = [0, 1].map((i) => ({ name: v(`c${i}name`), rel: fld(`c${i}rel`).value, phone: v(`c${i}phone`), addr: v(`c${i}addr`) }));
    // guardian / care-centre employee: they are the first to call — typed once, on the first step
    if (role === "guardian") contacts[0] = { name: v("gName"), rel: fld("gRel").value, phone: v("gPhone"), addr: v("c0addr"), me: true };
    if (role === "staff") contacts[0] = { name: v("sName"), rel: "centre", org: v("sOrg"), phone: v("sPhone"), addr: v("c0addr"), me: true };
    const g0 = c0Addr.value();
    if (g0 && contacts[0].addr) contacts[0].geo = g0;
    const homeGeo = homeAddr.value();
    return {
      role, name: v("name"), lang: pfDraft.lang, city: $("#pfCity").value, home: v("home"), flat: v("flat"),
      homeGeo, homeApprox: !homeGeo && !!v("home"),
      contacts: contacts.filter((c) => c.name)
    };
  }
  const digits = (n) => /\d{6,}/.test((fld(n).value || "").replace(/\D/g, ""));
  function pfCheck(step) {
    const d = pfRead(), role = pfRole(), all = step == null;
    const err = (m, n) => { const e = $("#pfError"); e.textContent = m; e.hidden = false; if (n && fld(n)) fld(n).focus(); return false; };
    $("#pfError").hidden = true;
    if (all || step === 0) {
      if (!pfDraft.role) return err(L("Выберите, кто заполняет данные.", "Деректерді кім толтыратынын таңдаңыз."));
      if (role === "guardian") {
        if (!fld("gName").value.trim()) return err(L("Напишите ваше имя — вам будем звонить первым.", "Атыңызды жазыңыз — алдымен сізге қоңырау шаламыз."), "gName");
        if (!digits("gPhone")) return err(L("Проверьте ваш телефон — нужно не меньше 6 цифр.", "Телефоныңызды тексеріңіз — кемінде 6 сан."), "gPhone");
      }
      if (role === "staff") {
        if (!fld("sOrg").value.trim()) return err(L("Напишите название центра ухода.", "Күтім орталығының атауын жазыңыз."), "sOrg");
        if (!fld("sName").value.trim()) return err(L("Напишите ваше имя.", "Атыңызды жазыңыз."), "sName");
        if (!digits("sPhone")) return err(L("Проверьте рабочий телефон — нужно не меньше 6 цифр.", "Жұмыс телефонын тексеріңіз — кемінде 6 сан."), "sPhone");
      }
    }
    if ((all || step === 1) && !d.name) return err(role === "self" ? L("Напишите или скажите, как к вам обращаться.", "Сізге қалай жүгінетінімізді жазыңыз не айтыңыз.") : L("Напишите, как зовут подопечного.", "Қамқордағы адамның атын жазыңыз."), "name");
    if (all || step === 3) {
      if (!d.home) return err(L("Укажите улицу и дом — сюда приедут такси и курьер.", "Көше мен үйді көрсетіңіз — такси мен курьер осында келеді."), "home");
      if (!homeAddr.ready()) return false;
    }
    if (all || step === 4) {
      if (role === "self") {
        if (!fld("c0name").value.trim()) return err(L("Укажите хотя бы одного близкого человека.", "Кем дегенде бір жақыныңызды көрсетіңіз."), "c0name");
        if (!digits("c0phone")) return err(L("Проверьте телефон близкого — нужно не меньше 6 цифр.", "Жақыныңыздың телефонын тексеріңіз — кемінде 6 сан."), "c0phone");
      }
      if (!c0Addr.ready()) return false;
    }
    return true;
  }
  function pfSave(data) {
    const st = state.settings;
    const cityChanged = data.city && data.city !== st.city;
    st.profile = data;
    st.contacts = buildContacts(data);
    if (data.lang && data.lang !== state.lang) setLang(data.lang);
    if (cityChanged) setCity(data.city, { silent: true }); else cityTexts(st.city);
    save(); applyLang();
    rebuildRoutes();
  }
  // texts of the wizard depend on who fills it in
  function pfTexts(role, ob) {
    const self = role === "self";
    const T = {
      pfS1: self ? L("О вас", "Өзіңіз туралы") : L("Подопечный", "Қамқордағы адам"),
      pfNameLbl: self ? L("Как к вам обращаться?", "Сізге қалай жүгінейік?") : L("Как зовут подопечного?", "Қамқордағы адамның аты кім?"),
      pfNameHint: self ? L("Например: Айгуль апа или Серик ага", "Мысалы: Әйгүл апа не Серік аға") : L("Так помощник будет к нему обращаться, например: Айгуль апа", "Көмекші оған осылай жүгінеді, мысалы: Әйгүл апа"),
      pfS2: self ? L("Ваш город", "Сіздің қалаңыз") : L("Город подопечного", "Қамқордағы адамның қаласы"),
      pfCityLbl: self ? L("Где вы живёте?", "Қай қалада тұрасыз?") : L("Где живёт подопечный?", "Ол қай қалада тұрады?"),
      pfS3: self ? L("Ваш адрес", "Сіздің мекенжайыңыз") : L("Адрес подопечного", "Қамқордағы адамның мекенжайы"),
      pfC1T: self ? L("Первый, кому звонить", "Бірінші қоңырау шалатын адам") : role === "staff" ? L("Первым звоним в центр ухода", "Алдымен күтім орталығына қоңырау шаламыз") : L("Первым звоним вам", "Алдымен сізге қоңырау шаламыз"),
      pfCaddrLbl: self ? L("Адрес (чтобы ездить в гости) — необязательно", "Мекенжайы (қонаққа бару үшін) — міндетті емес")
        : role === "staff" ? L("Адрес центра — необязательно", "Орталықтың мекенжайы — міндетті емес") : L("Ваш адрес (чтобы ездить в гости) — необязательно", "Сіздің мекенжайыңыз (қонаққа бару үшін) — міндетті емес")
    };
    Object.keys(T).forEach((id) => setText($("#" + id), T[id]));
    const v = (n) => fld(n).value.trim();
    const relNom = (k) => L((REL[k] || REL.other).ru.nom, (REL[k] || REL.other).kk.nom);
    const me = $("#pfMe");
    me.hidden = self;
    if (role === "guardian") me.textContent = [v("gName"), relNom(fld("gRel").value), v("gPhone")].filter(Boolean).join(" · ");
    if (role === "staff") me.textContent = [v("sOrg") ? "«" + v("sOrg") + "»" : "", v("sName"), v("sPhone")].filter(Boolean).join(" · ");
    $$(".pf-c0own", pfForm).forEach((x) => { x.hidden = !self; });
    $$("[data-pf-helper]", pfForm).forEach((x) => { x.hidden = x.dataset.pfHelper !== (pfDraft && pfDraft.role); });
    $$("[data-pf-role]", pfForm).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.pfRole === (pfDraft && pfDraft.role))));
    $("#pfTitle").textContent = ob ? (self || !pfDraft.role ? L("Давайте познакомимся", "Танысайық") : L("Настроим помощник для подопечного", "Қамқордағы адамға көмекшіні баптайық")) : L("Ваши данные", "Сіздің деректеріңіз");
    $("#pfLead").textContent = ob
      ? (self || !pfDraft.role ? L("Пять коротких шагов — и помощник будет знать ваш адрес и близких.", "Бес қысқа қадам — көмекші мекенжайыңыз бен жақындарыңызды біледі.")
        : L("Пять коротких шагов — и помощник будет знать адрес подопечного и кому звонить.", "Бес қысқа қадам — көмекші қамқордағы адамның мекенжайын және кімге қоңырау шалу керегін біледі."))
      : L("Измените что нужно и нажмите «Сохранить».", "Керегін өзгертіп, «Сақтау» басыңыз.");
  }
  function renderProfile() {
    const ob = onboarding();
    if (!pfDraft) pfLoad();
    fillRelSelects();
    const role = pfRole();
    $("#pfKicker").textContent = ob ? L(`Регистрация · шаг ${pfStep + 1} из ${PF_STEPS}`, `Тіркелу · ${pfStep + 1}/${PF_STEPS} қадам`)
      : L("Мои данные · ", "Менің деректерім · ") + L(ROLES[role].ru, ROLES[role].kk);
    pfTexts(role, ob);
    $$("#pfDots i").forEach((d, i) => d.classList.toggle("on", i <= pfStep));
    $("#pfDots").hidden = !ob;
    $$(".pf-step", pfForm).forEach((f) => { f.hidden = ob && +f.dataset.pfStep !== pfStep; });
    $("#pfPrev").hidden = !ob || pfStep === 0;
    $("#pfNext").textContent = !ob ? L("Сохранить", "Сақтау") : pfStep < PF_STEPS - 1 ? L("Далее", "Келесі") : L("Готово", "Дайын");
    $("#pfDemo").hidden = !ob;
    $$("[data-pf-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pfLang === pfDraft.lang)));
    document.body.classList.toggle("is-onboarding", ob);
  }
  $$("[data-pf-lang]").forEach((b) => b.addEventListener("click", () => {
    pfDraft.lang = b.dataset.pfLang;
    if (onboarding()) setLang(pfDraft.lang); else renderProfile();
  }));
  $$("[data-pf-role]").forEach((b) => b.addEventListener("click", () => {
    const prev = pfDraft.role;
    pfDraft.role = b.dataset.pfRole;
    // a guardian who becomes «self» keeps their data as the first contact
    if (pfDraft.role === "self" && prev === "guardian" && !fld("c0name").value.trim()) {
      fld("c0name").value = fld("gName").value; fld("c0rel").value = fld("gRel").value; fld("c0phone").value = fld("gPhone").value;
    }
    $("#pfError").hidden = true;
    renderProfile();
    const f = $(`[data-pf-helper="${pfDraft.role}"] input`);
    if (f && !f.value) f.focus();
  }));
  pfForm.addEventListener("input", (e) => { if (/^(g|s)[A-Z]/.test(e.target.name || "")) pfTexts(pfRole(), onboarding()); });
  pfForm.addEventListener("change", (e) => { if (e.target.name === "gRel") pfTexts(pfRole(), onboarding()); });
  $("#pfPrev").addEventListener("click", () => { pfStep = Math.max(0, pfStep - 1); $("#pfError").hidden = true; renderProfile(); });
  pfForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (onboarding()) {
      if (!pfCheck(pfStep)) return;
      if (pfStep < PF_STEPS - 1) { pfStep++; renderProfile(); window.scrollTo(0, 0); const f = $(`[data-pf-step="${pfStep}"] input:not([type=hidden]), [data-pf-step="${pfStep}"] select`); if (f && f.offsetParent) f.focus(); return; }
      const data = pfRead();
      pfSave(data);
      pfDraft = null; pfStep = 0;
      if (data.role === "self") {
        go("home");
        // spoken without the name (pre-recorded clip), shown with it
        setTimeout(() => { reply(L("Готово! Теперь просто скажите, что нужно.", "Дайын! Енді не керегін айтыңыз.")); toast(L(`Добро пожаловать, ${userName()}!`, `Қош келдіңіз, ${userName()}!`)); }, 400);
      } else {
        // guardian / care-centre employee: straight to the settings they manage
        go("family");
        setTimeout(() => { speak(L("Готово! Настройки подопечного — в режиме родственника.", "Дайын! Қамқордағы адамның баптаулары — туыс режимінде.")); toast(L(`Готово! Вы управляете помощником: ${userName()}`, `Дайын! Сіз басқаратын көмекші: ${userName()}`), 4500); }, 400);
      }
      return;
    }
    if (!pfCheck()) return;
    pfSave(pfRead());
    pfDraft = null;
    toast(L("Данные сохранены", "Деректер сақталды"));
    speak(L("Данные сохранены.", "Деректер сақталды."));
    go("home");
  });
  $("#pfDemo").addEventListener("click", () => {
    pfSave(Object.assign({}, DEMO_PROFILE, { lang: state.lang, city: state.settings.city, contacts: DEMO_PROFILE.contacts.map((c) => Object.assign({}, c)) }));
    pfDraft = null; pfStep = 0; go("home");
  });
  // dictation into a field: «Сказать голосом» next to names and addresses
  $$("[data-dictate]").forEach((b) => b.addEventListener("click", () => {
    const input = fld(b.dataset.dictate) || document.getElementById(b.dataset.dictate);
    if (!SR) { toast(L("Голосовой ввод недоступен в этом браузере — напишите текстом.", "Бұл браузерде дауыспен енгізу жоқ — мәтінмен жазыңыз.")); input.focus(); return; }
    const run = (lang) => {
      try {
        const r = new SR();
        r.lang = lang; r.interimResults = true; r.maxAlternatives = 1;
        let got = false;
        b.classList.add("is-listening");
        r.onresult = (e) => { got = true; let t2 = ""; for (let i = 0; i < e.results.length; i++) t2 += e.results[i][0].transcript; input.value = t2.trim().replace(/^./, (c) => c.toUpperCase()).replace(/[.。]$/, ""); };
        r.onerror = (e) => {
          if (!got && lang === "kk-KZ" && (e.error === "language-not-supported" || e.error === "service-not-allowed")) { kkRecOff = true; store.set("kkRecOff", true); b.classList.remove("is-listening"); run("ru-RU"); }
          else if (e.error === "not-allowed") toast(L("Нет доступа к микрофону.", "Микрофонға рұқсат жоқ."));
        };
        r.onend = () => { b.classList.remove("is-listening"); if (got) input.dispatchEvent(new Event("input", { bubbles: true })); };
        stopSpeech();
        r.start();
      } catch (err) { b.classList.remove("is-listening"); }
    };
    run(recLang());
  }));

  /* ==========================================================
     Init
     ========================================================== */
  applyLang();
  show(onboarding() ? "profile" : (location.hash.slice(1) || "home"));
  cycleHints();
  if (reduceMotion) drawRays(0); else requestAnimationFrame(rayLoop);
  // fetch the map library in the background, so the taxi / route maps open instantly
  if (LM) setTimeout(() => { LM.load(); ensureRoutes(); }, 1200);

  /* ---------------- Micro-interactions ---------------- */
  const RIPPLE = ".tile, .help-btn, .btn-main, .btn-sub, .chip, .pill-btn, .kind, .quote, .dnav-help, .btn-light, .btn-red, .mini-btn, .step";
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(RIPPLE);
    if (!b || reduceMotion) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2;
    const sp = document.createElement("span");
    sp.className = "ripple";
    sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    b.appendChild(sp);
    sp.addEventListener("animationend", () => sp.parentNode && sp.parentNode.removeChild(sp));
  });
  if (!reduceMotion && window.matchMedia("(hover: hover)").matches) {
    // tiles lean slightly toward the cursor
    $$(".tile").forEach((tile) => {
      tile.addEventListener("pointermove", (e) => {
        const r = tile.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        tile.style.transform = `perspective(600px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateY(-4px) scale(1.035)`;
      });
      tile.addEventListener("pointerleave", () => { tile.style.transform = ""; });
    });
    // soft light follows the cursor on dark panels
    $$(".top").forEach((top) => top.addEventListener("pointermove", (e) => {
      const r = top.getBoundingClientRect();
      top.style.setProperty("--mx", (e.clientX - r.left) + "px");
      top.style.setProperty("--my", (e.clientY - r.top) + "px");
    }));
  }
  if ("speechSynthesis" in window) { try { window.speechSynthesis.getVoices(); } catch (e) { /* ignore */ } }
})();
