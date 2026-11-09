/* ==========================================================
   INDEPENDENT — prototype logic
   - UI language (RU / KK), text size, high contrast
   - Voice assistant demo: Web Speech API (recognition + TTS)
     with a rule-based intent engine for RU and KK speech
   - Family Freedom Settings wired into the assistant
   All orders, calls and payments are simulated.
   ========================================================== */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------------- Safe storage ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ind." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ind." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  /* ---------------- State ---------------- */
  const state = {
    lang: store.get("lang", "ru"),
    size: store.get("size", "1"),
    contrast: store.get("contrast", false),
    sound: store.get("sound", true),
    pending: null,        // action waiting for "yes/no" or for a missing detail
    spent: 4200,          // already spent this week (demo)
    settings: Object.assign({
      home: "ул. Абая, 10",
      clinic: "Городская поликлиника №4",
      kid: "мкр. Самал-2, 25",
      cKid: "+7 701 000 00 00",
      cSon: "+7 702 000 00 00",
      limit: 25000,
      consSOS: true,
      consOrders: false,
      consLocation: false,
      consMemory: true
    }, store.get("settings", {}))
  };

  const money = (n) => n.toLocaleString("ru-RU").replace(/ /g, " ") + " ₸";

  /* ==========================================================
     UI: language, text size, contrast
     ========================================================== */
  function t(key) {
    const d = window.I18N[state.lang] || window.I18N.ru;
    return d[key] != null ? d[key] : (window.I18N.ru[key] || key);
  }

  function applyLang() {
    document.documentElement.lang = state.lang === "kk" ? "kk" : "ru";
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    $$("[data-lang]").forEach((b) => {
      const on = b.dataset.lang === state.lang;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on);
    });
    renderChips();
  }

  function applySize() {
    document.documentElement.dataset.size = state.size;
    $$("[data-size]").forEach((b) => {
      const on = b.dataset.size === state.size;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on);
    });
  }

  function applyContrast() {
    if (state.contrast) document.documentElement.dataset.contrast = "high";
    else delete document.documentElement.dataset.contrast;
    $("#contrastBtn").setAttribute("aria-pressed", state.contrast);
  }

  $$("[data-lang]").forEach((b) => b.addEventListener("click", () => {
    if (state.lang === b.dataset.lang) return;
    state.lang = b.dataset.lang; store.set("lang", state.lang);
    applyLang();
    replyLang = state.lang;
    say(L(
      "Хорошо, теперь говорим по-русски. Чем помочь?",
      "Жақсы, енді қазақша сөйлесеміз. Немен көмектесейін?"
    ));
  }));
  $$("[data-size]").forEach((b) => b.addEventListener("click", () => {
    state.size = b.dataset.size; store.set("size", state.size); applySize();
  }));
  $("#contrastBtn").addEventListener("click", () => {
    state.contrast = !state.contrast; store.set("contrast", state.contrast); applyContrast();
  });

  /* ==========================================================
     Assistant: language helpers
     ========================================================== */
  // Pick text by language. `lang` defaults to the language of the current reply.
  let replyLang = state.lang;
  function L(ru, kk, lang) { return (lang || replyLang) === "kk" ? kk : ru; }

  // Detect whether an utterance is Kazakh (specific letters or common words)
  // JS \b is ASCII-only, so word boundaries for Cyrillic are built by hand
  const LET = "a-zа-яёәғқңөұүһі";
  const NL = "[^" + LET + "]";
  const END = "(?![" + LET + "])";

  function detectLang(text) {
    const s = text.toLowerCase();
    if (/[әғқңөұүһі]/.test(s)) return "kk";
    if (new RegExp("(^|" + NL + ")(маған|керек|шақыр|бар|жоқ|иә|ия|сәлем|салем|рахмет|рақмет|қайда|үйге|қалай|нан|сүт)" + END).test(s)) return "kk";
    if (/[а-яё]/.test(s)) return "ru";
    return state.lang;
  }

  /* ==========================================================
     Assistant: chat rendering
     ========================================================== */
  const chat = $("#chat");

  function scrollChat() { chat.scrollTop = chat.scrollHeight; }

  function addMsg(text, who, via) {
    const el = document.createElement("div");
    el.className = "msg msg-" + who;
    el.textContent = text;
    if (via) {
      const v = document.createElement("span");
      v.className = "via"; v.textContent = via;
      el.appendChild(v);
    }
    chat.appendChild(el); scrollChat();
    return el;
  }

  function addTyping() {
    const el = document.createElement("div");
    el.className = "msg msg-bot";
    el.innerHTML = '<span class="typing" aria-label="…"><i></i><i></i><i></i></span>';
    chat.appendChild(el); scrollChat();
    return el;
  }

  // card: { title, icon, rows: [[k, v]], total, kind: 'done'|'warn', confirm: true }
  function addCard(card) {
    const el = document.createElement("div");
    el.className = "msg-card" + (card.kind ? " " + card.kind : "");
    const h = document.createElement("h4");
    h.textContent = (card.icon ? card.icon + " " : "") + card.title;
    el.appendChild(h);
    if (card.rows && card.rows.length) {
      const dl = document.createElement("dl");
      card.rows.forEach(([k, v]) => {
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = v;
        dl.append(dt, dd);
      });
      el.appendChild(dl);
    }
    if (card.total) {
      const tot = document.createElement("div");
      tot.className = "total";
      tot.innerHTML = "<span></span><span></span>";
      tot.children[0].textContent = card.total[0];
      tot.children[1].textContent = card.total[1];
      el.appendChild(tot);
    }
    if (card.confirm) {
      const a = document.createElement("div");
      a.className = "card-actions";
      const yes = document.createElement("button");
      yes.className = "btn btn-yes"; yes.textContent = L("Да, заказать", "Иә, тапсырыс беру");
      const no = document.createElement("button");
      no.className = "btn btn-no"; no.textContent = L("Нет", "Жоқ");
      yes.addEventListener("click", () => handle(L("Да", "Иә"), "tap"));
      no.addEventListener("click", () => handle(L("Нет", "Жоқ"), "tap"));
      a.append(yes, no);
      el.appendChild(a);
    }
    chat.appendChild(el); scrollChat();
    return el;
  }

  function disableOldConfirms() {
    $$(".card-actions", chat).forEach((a) => a.remove());
  }

  /* ---------------- Speech synthesis ---------------- */
  function speak(text, lang) {
    if (!state.sound || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const code = lang === "kk" ? "kk-KZ" : "ru-RU";
      u.lang = code;
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang === code) ||
                voices.find((x) => x.lang && x.lang.startsWith(lang === "kk" ? "kk" : "ru"));
      if (v) u.voice = v;
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  function say(text, lang) {
    addMsg(text, "bot");
    speak(text, lang || replyLang);
  }

  const soundBtn = $("#soundBtn");
  soundBtn.setAttribute("aria-pressed", state.sound);
  soundBtn.addEventListener("click", () => {
    state.sound = !state.sound; store.set("sound", state.sound);
    soundBtn.setAttribute("aria-pressed", state.sound);
    if (!state.sound && "speechSynthesis" in window) window.speechSynthesis.cancel();
  });

  /* ==========================================================
     Assistant: intent engine
     ========================================================== */
  const RX = {
    yes: new RegExp("^(да|давай|ага|угу|подтверждаю|конечно|заказывай|верно|иә|ия|йә|жарайды|болады|дұрыс|ok|ок|окей)" + END, "i"),
    no: /^(нет|не надо|не нужно|отмена|отмени|стоп|жоқ|керек емес|қажет емес|тоқтат|болдырма)/i,
    sos: /(плохо|скор(ая|ую)|помогите|спасите|упал|болит сердце|sos|сос|жедел|жаным ауыр|құтқар|құлап|жүрегім)/i,
    operator: /(оператор|человек|живой|живого|адаммен|адам шақыр|маман|тірі)/i,
    call: /(позвон|набери|созвон|связаться с|қоңырау|хабарлас|звонок)/i,
    taxi: /(такси|поехать|поеду|отвез|довез|жеткіз|апар|көлік|барғым)/i,
    route: /(маршрут|автобус|как добраться|как доехать|остановк|навигац|бағыт|қалай бар|аялдама|жол көрсет)/i,
    pharmacy: /(аптек|лекарств|таблет|дәрі|дәріхана)/i,
    groceries: new RegExp("(продукт|хлеб|молок|магазин|покупк|яйц|кефир|азық|сүт|дүкен|тамақ|жұмыртқа|айран|(^|" + NL + ")нан" + END + ")", "i"),
    cleaning: /(уборк|убрать|убраться|клининг|помыть|тазала|жинау|жинап)/i,
    master: /(мастер|сантехник|электрик|кран|теч[её]т|протека|розетк|сломал|не работает|починит|шебер|бұзыл|ағып|жөнде)/i,
    hello: /(привет|здравств|добрый|сәлем|салем|ассалау|қайырлы)/i,
    help: /(что ты умеешь|что умеешь|помощь|не істей аласың|не істейсің|көмек керек)/i,
    thanks: /(спасибо|благодар|рахмет|рақмет|сау бол)/i
  };

  const DEST = [
    { key: "home",   rx: /(дом|домой|үй)/i,                                          ru: "Дом",           kk: "Үй" },
    { key: "clinic", rx: /(поликлиник|больниц|врач|клиник|емхана|аурухана|дәрігер)/i, ru: "Поликлиника",   kk: "Емхана" },
    { key: "kid",    rx: /(доч|айгерим|айгерім|қызым|қызыма|қызға)/i,               ru: "Дочь Айгерим",  kk: "Қызы Айгерім" },
    { key: "market", rx: /(рын(ок|ку)|базар)/i,                                       ru: "Зелёный базар", kk: "Көк базар", addr: "Зелёный базар" }
  ];

  function findDest(text) {
    // the most specific match wins; "home" only if nothing else
    const hits = DEST.filter((d) => d.rx.test(text));
    return hits.find((d) => d.key !== "home") || hits[0] || null;
  }
  function destAddr(d) { return d.addr || state.settings[d.key] || d.ru; }
  function destName(d) { return L(d.ru, d.kk); }

  const ITEMS = [
    { rx: new RegExp("(хлеб|(^|" + NL + ")нан" + END + ")", "i"),               ru: "Хлеб",          kk: "Нан",        price: 250 },
    { rx: /(молок|сүт)/i,              ru: "Молоко 1 л",    kk: "Сүт 1 л",    price: 520 },
    { rx: /(кефир|айран)/i,            ru: "Кефир",         kk: "Айран",      price: 480 },
    { rx: /(яйц|жұмыртқа)/i,           ru: "Яйца, 10 шт",   kk: "Жұмыртқа, 10 дана", price: 900 },
    { rx: /(сахар|қант)/i,             ru: "Сахар 1 кг",    kk: "Қант 1 кг",  price: 560 },
    { rx: /(чай|шай)/i,                ru: "Чай",           kk: "Шай",        price: 1300 },
    { rx: /(масл|сары май)/i,          ru: "Масло",         kk: "Сары май",   price: 1400 },
    { rx: /(картош|картоп)/i,          ru: "Картофель 2 кг", kk: "Картоп 2 кг", price: 600 },
    { rx: /(яблок|алма)/i,             ru: "Яблоки 1 кг",   kk: "Алма 1 кг",  price: 750 },
    { rx: /(мяс|сиыр)/i,          ru: "Говядина 1 кг", kk: "Сиыр еті 1 кг", price: 3800 },
    { rx: /(курин|курица|тауық)/i,     ru: "Курица",        kk: "Тауық",      price: 2200 },
    { rx: /(рис|күріш)/i,              ru: "Рис 1 кг",      kk: "Күріш 1 кг", price: 700 }
  ];
  const USUAL_BASKET = [0, 1, 2]; // "as usual": bread, milk, kefir

  function rand(a, b) { return Math.round(a + Math.random() * (b - a)); }

  function handle(rawText, via) {
    const text = (rawText || "").trim();
    if (!text) return;
    replyLang = detectLang(text);
    addMsg(text, "user", via === "voice" ? L("🎤 голосом", "🎤 дауыспен") : null);
    disableOldConfirms();
    const typing = addTyping();
    setTimeout(() => { typing.remove(); respond(text); renderChips(); }, 650);
  }

  function respond(text) {
    const s = text.toLowerCase();
    const p = state.pending;

    // 1) Emergency always first
    if (RX.sos.test(s)) { state.pending = null; return doSOS(); }
    if (RX.operator.test(s)) { state.pending = null; return doOperator(); }

    // 2) Waiting for confirmation?
    if (p && p.type === "confirm") {
      if (RX.yes.test(s)) { state.pending = null; return p.onYes(); }
      if (RX.no.test(s))  { state.pending = null; return say(L("Хорошо, отменила. Что-нибудь ещё?", "Жарайды, тоқтаттым. Тағы не керек?")); }
    }
    // 3) Waiting for a missing detail (e.g. destination)?
    if (p && p.type === "askDest") {
      const d = findDest(s);
      if (d) { state.pending = null; return p.kind === "route" ? doRoute(d) : doTaxi(d); }
    }

    // 4) Intents
    if (RX.call.test(s)) return doCall(s);
    if (RX.route.test(s)) { const d = findDest(s); return d ? doRoute(d) : askDest("route"); }
    if (RX.taxi.test(s))  { const d = findDest(s); return d ? doTaxi(d)  : askDest("taxi"); }
    if (RX.pharmacy.test(s)) return doPharmacy();
    if (RX.groceries.test(s)) return doGroceries(s);
    if (RX.cleaning.test(s)) return doCleaning();
    if (RX.master.test(s)) return doMaster(s);
    if (RX.thanks.test(s)) return say(L("Пожалуйста! Обращайтесь в любое время.", "Оқасы жоқ! Кез келген уақытта айтыңыз."));
    if (RX.hello.test(s) || RX.help.test(s)) return doHelp();

    // A bare place name: assume taxi
    const d = findDest(s);
    if (d) return doTaxi(d);

    return say(L(
      "Простите, я не совсем поняла. Скажите по-другому — например, «вызови такси домой». Или нажмите «Позвать человека».",
      "Кешіріңіз, толық түсінбедім. Басқаша айтып көріңіз — мысалы, «үйге такси шақыр». Немесе «Адамды шақыру» батырмасын басыңыз."
    ));
  }

  function confirm(onYes) { state.pending = { type: "confirm", onYes }; }

  function askDest(kind) {
    state.pending = { type: "askDest", kind };
    say(L("Куда нужно поехать? Например: домой, в поликлинику, к дочери, на базар.",
          "Қайда бару керек? Мысалы: үйге, емханаға, қызыңызға, базарға."));
  }

  function overLimit(sum) { return state.spent + sum > state.settings.limit; }
  function limitWarn(sum) {
    const left = Math.max(0, state.settings.limit - state.spent);
    addCard({
      kind: "warn", icon: "⚠️",
      title: L("Сумма больше недельного лимита", "Сома апталық лимиттен асады"),
      rows: [
        [L("Заказ", "Тапсырыс"), money(sum)],
        [L("Осталось до лимита", "Лимитке дейін қалды"), money(left)]
      ]
    });
    say(L("Этот заказ превышает лимит, который вы установили. Могу убрать часть позиций или позвать оператора.",
          "Бұл тапсырыс сіз белгілеген лимиттен асады. Кейбір тауарларды алып тастай аламын немесе операторды шақырайын."));
  }
  function privacyLine(kind) {
    const s = state.settings;
    if (kind === "trip") return s.consLocation ? L("Айгерим увидит, где вы едете — вы это разрешили.", "Айгерім сапарыңызды көреді — сіз рұқсат бердіңіз.")
                                               : L("Поездку видите только вы.", "Сапарды тек сіз көресіз.");
    return s.consOrders ? L("Заказ появится в истории, которую видят близкие.", "Тапсырыс жақындарыңыз көретін тарихта шығады.")
                        : L("Заказ видите только вы.", "Тапсырысты тек сіз көресіз.");
  }

  /* ---------------- Actions ---------------- */
  function doHelp() {
    say(L(
      "Здравствуйте, Роза апа! Я могу вызвать такси, подсказать автобус, заказать продукты или лекарства, вызвать мастера или уборку, позвонить близким. Просто скажите, что нужно.",
      "Сәлеметсіз бе, Роза апа! Мен такси шақыра аламын, автобус бағытын айтамын, азық-түлік не дәрі-дәрмек, шебер не тазалау шақырамын, жақындарыңызға қоңырау шаламын. Не керегін айтыңыз."
    ));
  }

  function doTaxi(d) {
    // Demo assumption: when going home, the user is at the clinic
    const from = d.key === "home" ? state.settings.clinic : state.settings.home;
    const price = rand(1200, 2200);
    const eta = rand(4, 9);
    if (overLimit(price)) return limitWarn(price);
    addCard({
      icon: "🚕", title: L("Такси", "Такси"),
      rows: [
        [L("Откуда", "Қайдан"), from],
        [L("Куда", "Қайда"), destName(d) + " — " + destAddr(d)],
        [L("Подача", "Келеді"), L(eta + " мин", eta + " мин")],
        [L("Оплата", "Төлем"), L("наличными водителю", "жүргізушіге қолма-қол")]
      ],
      total: [L("Примерно", "Шамамен"), money(price)],
      confirm: true
    });
    say(L(`Нашла такси до места «${destName(d)}», примерно ${price} тенге, приедет через ${eta} минут. Заказать?`,
          `«${destName(d)}» дейін такси таптым, шамамен ${price} теңге, ${eta} минутта келеді. Тапсырыс берейін бе?`));
    confirm(() => {
      state.spent += price;
      addCard({
        kind: "done", icon: "✅", title: L("Такси заказано", "Такси шақырылды"),
        rows: [
          [L("Водитель", "Жүргізуші"), L("Нурлан", "Нұрлан")],
          [L("Машина", "Көлік"), L("белая Toyota Camry", "ақ Toyota Camry")],
          [L("Номер", "Нөмірі"), "777 ABC 02"],
          [L("Приедет через", "Келеді"), eta + L(" мин", " минутта")]
        ]
      });
      say(L(`Готово. Белая Тойота, водитель Нурлан, будет через ${eta} минут. ${privacyLine("trip")}`,
            `Дайын. Ақ Тойота, жүргізуші Нұрлан, ${eta} минутта келеді. ${privacyLine("trip")}`));
    });
  }

  function doRoute(d) {
    const bus = [12, 32, 37, 63, 92][rand(0, 4)];
    const stops = rand(3, 7);
    const wait = rand(3, 11);
    addCard({
      icon: "🚌", title: L("Маршрут на автобусе", "Автобус бағыты"),
      rows: [
        [L("Куда", "Қайда"), destName(d) + " — " + destAddr(d)],
        [L("Автобус", "Автобус"), "№" + bus],
        [L("Остановка", "Аялдама"), L("«Абая» — 3 минуты пешком", "«Абай» — жаяу 3 минут")],
        [L("Ехать", "Жол"), L(stops + " остановок, ~" + stops * 4 + " мин", stops + " аялдама, ~" + stops * 4 + " мин")],
        [L("Ближайший", "Келесісі"), L("через " + wait + " мин", wait + " минуттан кейін")]
      ]
    });
    say(L(`Автобус номер ${bus} от остановки «Абая», ${stops} остановок. Ближайший через ${wait} минут. Если не хочется ждать — скажите «вызови такси».`,
          `«Абай» аялдамасынан ${bus}-нөмірлі автобус, ${stops} аялдама. Келесісі ${wait} минуттан кейін. Күткіңіз келмесе — «такси шақыр» деңіз.`));
  }

  function doGroceries(s) {
    let picked = ITEMS.filter((it) => it.rx.test(s));
    let usual = false;
    if (!picked.length) {
      if (!state.settings.consMemory) {
        return say(L("Что именно купить? Например: хлеб, молоко, яйца.",
                     "Нақты не алу керек? Мысалы: нан, сүт, жұмыртқа."));
      }
      picked = USUAL_BASKET.map((i) => ITEMS[i]);
      usual = true;
    }
    const delivery = 500;
    const sum = picked.reduce((a, it) => a + it.price, 0) + delivery;
    if (overLimit(sum)) return limitWarn(sum);
    addCard({
      icon: "🛒", title: L("Продукты — магазин «Достық» у дома", "Азық-түлік — үй жанындағы «Достық» дүкені"),
      rows: picked.map((it) => [L(it.ru, it.kk), money(it.price)])
        .concat([[L("Доставка", "Жеткізу"), money(delivery) + L(", ~40 мин", ", ~40 мин")]]),
      total: [L("Итого", "Барлығы"), money(sum)],
      confirm: true
    });
    say(usual
      ? L(`Заказать как обычно: хлеб, молоко и кефир, с доставкой ${sum} тенге?`,
          `Әдеттегідей тапсырыс берейін бе: нан, сүт және айран, жеткізумен ${sum} теңге?`)
      : L(`Собрала корзину на ${sum} тенге с доставкой. Заказать?`,
          `Себетті жеткізумен ${sum} теңгеге жинадым. Тапсырыс берейін бе?`));
    confirm(() => {
      state.spent += sum;
      addCard({ kind: "done", icon: "✅", title: L("Заказ принят", "Тапсырыс қабылданды"),
        rows: [[L("Привезут", "Әкеледі"), L("примерно через 40 минут", "шамамен 40 минуттан кейін")],
               [L("Адрес", "Мекенжай"), state.settings.home],
               [L("Оплата", "Төлем"), L("курьеру при получении", "алған кезде курьерге")]] });
      say(L(`Заказ принят, привезут примерно через 40 минут. ${privacyLine("order")}`,
            `Тапсырыс қабылданды, шамамен 40 минутта әкеледі. ${privacyLine("order")}`));
    });
  }

  function doPharmacy() {
    addCard({
      icon: "💊", title: L("Аптека рядом с домом", "Үй жанындағы дәріхана"),
      rows: [
        [L("Доставка", "Жеткізу"), L("~50 мин, 600 ₸", "~50 мин, 600 ₸")],
        [L("Как заказать", "Қалай"), L("фармацевт перезвонит и уточнит список", "фармацевт қайта қоңырау шалып, тізімді нақтылайды")]
      ],
      confirm: true
    });
    say(L("Чтобы не ошибиться с лекарствами, фармацевт сам перезвонит вам и уточнит, что нужно. Соединить?",
          "Дәріден қателеспеу үшін фармацевт өзі сізге қоңырау шалып, не керегін нақтылайды. Қоссам ба?"));
    confirm(() => {
      addCard({ kind: "done", icon: "✅", title: L("Заявка в аптеку отправлена", "Дәріханаға өтінім жіберілді"),
        rows: [[L("Звонок", "Қоңырау"), L("в течение 10 минут", "10 минут ішінде")]] });
      say(L("Готово. Фармацевт позвонит в течение десяти минут.", "Дайын. Фармацевт он минут ішінде қоңырау шалады."));
    });
  }

  function doCleaning() {
    const price = 9000;
    if (overLimit(price)) return limitWarn(price);
    addCard({
      icon: "🧹", title: L("Уборка квартиры — «Таза Үй»", "Пәтер тазалау — «Таза Үй»"),
      rows: [
        [L("Когда", "Қашан"), L("завтра в 10:00", "ертең сағат 10:00-де")],
        [L("Длительность", "Ұзақтығы"), L("около 3 часов", "шамамен 3 сағат")],
        [L("Адрес", "Мекенжай"), state.settings.home]
      ],
      total: [L("Стоимость", "Бағасы"), money(price)],
      confirm: true
    });
    say(L(`Уборка завтра в десять утра, ${price} тенге. Записать?`, `Тазалау ертең таңғы оныда, ${price} теңге. Жазып қойайын ба?`));
    confirm(() => {
      state.spent += price;
      addCard({ kind: "done", icon: "✅", title: L("Уборка заказана", "Тазалауға жазылдыңыз"),
        rows: [[L("Мастер", "Маман"), L("Гульнара, позвонит за час", "Гүлнара, бір сағат бұрын қоңырау шалады")]] });
      say(L(`Записала. Гульнара позвонит за час до прихода. ${privacyLine("order")}`,
            `Жаздым. Гүлнара келерден бір сағат бұрын қоңырау шалады. ${privacyLine("order")}`));
    });
  }

  function doMaster(s) {
    let kind = L("Мастер на все руки", "Әмбебап шебер");
    if (/(кран|теч|протек|труб|унитаз|ағып|құбыр)/i.test(s)) kind = L("Сантехник", "Сантехник");
    else if (/(розетк|свет|электр|лампоч|жарық|розетка)/i.test(s)) kind = L("Электрик", "Электрик");
    const fee = 3000;
    if (overLimit(fee)) return limitWarn(fee);
    addCard({
      icon: "🔧", title: kind,
      rows: [
        [L("Когда", "Қашан"), L("сегодня, 15:00–17:00", "бүгін, 15:00–17:00")],
        [L("Мастер", "Шебер"), L("Серик, рейтинг 4.9", "Серік, рейтингі 4.9")],
        [L("Адрес", "Мекенжай"), state.settings.home]
      ],
      total: [L("Выезд и осмотр", "Келу және қарау"), money(fee)],
      confirm: true
    });
    say(L(`${kind} может приехать сегодня с трёх до пяти. Выезд ${fee} тенге, работу мастер назовёт на месте. Вызвать?`,
          `${kind} бүгін үштен беске дейін келе алады. Келу ${fee} теңге, жұмыс бағасын шебер орнында айтады. Шақырайын ба?`));
    confirm(() => {
      state.spent += fee;
      addCard({ kind: "done", icon: "✅", title: L("Мастер вызван", "Шебер шақырылды"),
        rows: [[L("Приедет", "Келеді"), L("сегодня 15:00–17:00", "бүгін 15:00–17:00")]] });
      say(L("Мастер вызван. Он позвонит перед приездом.", "Шебер шақырылды. Келер алдында қоңырау шалады."));
    });
  }

  function doCall(s) {
    const son = /(сын|ерлан|ұлым|ұлыма|ұлыма)/i.test(s);
    const who = son ? L("Ерлану", "Ерланға") : L("Айгерим", "Айгерімге");
    const num = son ? state.settings.cSon : state.settings.cKid;
    say(L(`Звоню ${who}.`, `${who} қоңырау шалып жатырмын.`));
    showOverlay(L("Звоним " + who + "…", who + " қоңырау шалынуда…"), num + "  ·  " + L("(имитация звонка)", "(қоңырау имитациясы)"), false);
  }

  function doOperator() {
    say(L("Соединяю с оператором. Это живой человек, он поможет.", "Операторға қосып жатырмын. Ол — тірі адам, көмектеседі."));
    showOverlay(L("Соединяем с оператором", "Операторға қосылуда"),
      L("Оператор Алия ответит примерно через минуту. Она видит, о чём вы говорили с помощником, — повторять не нужно.",
        "Оператор Әлия шамамен бір минутта жауап береді. Ол көмекшімен не туралы сөйлескеніңізді көреді — қайталаудың қажеті жоқ."), false);
  }

  function doSOS() {
    const notify = state.settings.consSOS;
    say(L("Вызываю срочную помощь. Оставайтесь на месте, я рядом.", "Шұғыл көмек шақырып жатырмын. Орныңыздан қозғалмаңыз, мен осындамын."));
    showOverlay(L("Вызываем помощь", "Көмек шақырылуда"),
      L("В рабочей версии: звонок в скорую 103 / 112 и оператору. ", "Жұмыс нұсқасында: жедел жәрдем 103 / 112 және операторға қоңырау. ") +
      (notify ? L("Айгерим и Ерлан получат сообщение и ваш адрес.", "Айгерім мен Ерлан хабарлама мен мекенжайыңызды алады.")
              : L("Близким сообщение не отправляется — вы это отключили.", "Жақындарға хабарлама жіберілмейді — сіз мұны өшірдіңіз.")),
      true);
  }

  /* ---------------- Overlay ---------------- */
  const overlay = $("#overlay");
  let lastFocus = null;
  function showOverlay(title, text, sos) {
    lastFocus = document.activeElement;
    $("#overlayTitle").textContent = title;
    $("#overlayText").textContent = text;
    $("#overlayPulse").classList.toggle("sos", !!sos);
    $("#overlayClose").textContent = t("overlay.close");
    overlay.hidden = false;
    $("#overlayClose").focus();
  }
  function hideOverlay() { overlay.hidden = true; if (lastFocus) lastFocus.focus(); }
  $("#overlayClose").addEventListener("click", hideOverlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) hideOverlay(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) hideOverlay(); });

  $("#operatorBtn").addEventListener("click", () => handle(L("Позови оператора", "Операторды шақыр", state.lang), "tap"));
  $("#sosBtn").addEventListener("click", () => { replyLang = state.lang; doSOS(); });

  /* ---------------- Suggestion chips ---------------- */
  function renderChips() {
    const box = $("#chips");
    box.innerHTML = "";
    let list;
    const kk = state.lang === "kk";
    if (state.pending && state.pending.type === "confirm") {
      list = kk ? ["Иә", "Жоқ"] : ["Да", "Нет"];
    } else if (state.pending && state.pending.type === "askDest") {
      list = kk ? ["Үйге", "Емханаға", "Қызыма", "Базарға"] : ["Домой", "В поликлинику", "К дочери", "На базар"];
    } else {
      list = kk
        ? ["Емханаға такси шақыр", "Маған нан мен сүт керек", "Кран ағып тұр", "Қызыма қоңырау шал"]
        : ["Вызови такси в поликлинику", "Закажи продукты как обычно", "Как доехать до базара?", "Течёт кран, нужен мастер"];
    }
    list.forEach((txt) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = txt;
      b.addEventListener("click", () => handle(txt, "tap"));
      box.appendChild(b);
    });
  }

  /* ---------------- Text input ---------------- */
  $("#textForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = $("#textField");
    handle(f.value, "text");
    f.value = "";
  });

  /* ---------------- Speech recognition ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $("#micBtn");
  const micHint = $("#micHint");
  let rec = null, listening = false;

  function setHint(key) { micHint.dataset.i18n = key; micHint.textContent = t(key); }

  micBtn.addEventListener("click", () => {
    if (!SR) { setHint("demo.noMic"); $("#textField").focus(); return; }
    if (listening && rec) { rec.stop(); return; }
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      rec = new SR();
      rec.lang = state.lang === "kk" ? "kk-KZ" : "ru-RU";
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let finalText = "";
      rec.onstart = () => { listening = true; micBtn.classList.add("is-listening"); setHint("demo.listening"); };
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        micHint.textContent = (finalText + interim) || t("demo.listening");
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") setHint("demo.noMic");
      };
      rec.onend = () => {
        listening = false; micBtn.classList.remove("is-listening");
        setHint("demo.hint");
        if (finalText.trim()) handle(finalText, "voice");
      };
      rec.start();
    } catch (err) { setHint("demo.noMic"); }
  });

  /* ==========================================================
     Family Freedom Settings form
     ========================================================== */
  const textFields = ["home", "clinic", "kid", "cKid", "cSon"];
  const fieldIds = { home: "addrHome", clinic: "addrClinic", kid: "addrKid", cKid: "cKid", cSon: "cSon" };
  const checks = ["consSOS", "consOrders", "consLocation", "consMemory"];
  const note = $("#settingsNote");
  let noteTimer;

  function flashSaved() {
    store.set("settings", state.settings);
    note.textContent = t("fam.saved"); note.classList.add("flash");
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.textContent = t("fam.note"); note.classList.remove("flash"); }, 2200);
  }

  textFields.forEach((k) => {
    const el = document.getElementById(fieldIds[k]);
    el.value = state.settings[k];
    el.addEventListener("input", () => { state.settings[k] = el.value.trim() || state.settings[k]; flashSaved(); });
  });
  checks.forEach((k) => {
    const el = document.getElementById(k);
    el.checked = !!state.settings[k];
    el.addEventListener("change", () => { state.settings[k] = el.checked; flashSaved(); });
  });
  const range = $("#limitRange"), out = $("#limitOut");
  range.value = state.settings.limit; out.textContent = money(+range.value);
  range.addEventListener("input", () => { state.settings.limit = +range.value; out.textContent = money(+range.value); flashSaved(); });

  $("#settingsForm").addEventListener("submit", (e) => e.preventDefault());

  /* ---------------- Partner form ---------------- */
  $("#partnerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    e.target.hidden = true;
    $("#partnerOk").hidden = false;
  });

  /* ---------------- Init ---------------- */
  applySize();
  applyContrast();
  applyLang();
  replyLang = state.lang;
  addMsg(L(
    "Сәлеметсіз бе, Роза апа! Я ваш помощник. Скажите, что нужно — по-казахски или по-русски.",
    "Сәлеметсіз бе, Роза апа! Мен сіздің көмекшіңізбін. Не керегін айтыңыз — қазақша немесе орысша."
  ), "bot");
  if ("speechSynthesis" in window) { try { window.speechSynthesis.getVoices(); } catch (e) { /* ignore */ } }
})();
