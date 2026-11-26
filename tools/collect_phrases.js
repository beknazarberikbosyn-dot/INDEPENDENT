// Collects every phrase the assistant speaks, in RU and KK, by driving the site with Playwright.
// Usage: python3 -m http.server 8765 &   then   node tools/collect_phrases.js > tools/phrases.json
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:8765/";
const CMDS = {
  ru: ["Вызови такси домой", "Такси в поликлинику", "Отвези к дочери", "Такси на базар",
       "Как доехать домой", "Как доехать до поликлиники", "Автобус к дочери", "Как добраться до базара",
       "Течёт кран", "Не работает розетка", "Нужна уборка", "Сломалась дверь, нужен мастер",
       "Закажи продукты как обычно", "Купи хлеб и молоко", "Спасибо", "Абракадабра",
       "Открой настройки", "Позвони дочке", "Позвони сыну", "Мне плохо"],
  kk: ["Үйге такси шақыр", "Емханаға такси", "Қызыма апар", "Базарға такси",
       "Үйге қалай барамын", "Емханаға қалай барамын", "Қызыма автобус", "Базарға қалай барамын",
       "Кран ағып тұр", "Розетка бұзылды", "Тазалау керек", "Есік бұзылды, шебер керек",
       "Әдеттегідей азық-түлік", "Маған нан мен сүт керек", "Рақмет", "Абракадабра",
       "Баптауларды аш", "Қызыма қоңырау шал", "Ұлыма қоңырау шал", "Жүрегім ауырып тұр"]
};

(async () => {
  const browser = await chromium.launch();
  const seen = new Map();
  for (const lang of ["ru", "kk"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.route(/cdnjs|cartocdn|fonts\.g/, (r) => r.abort());
    await p.clock.install();
    await p.addInitScript((lng) => {
      window.__voiceLog = [];
      try {
        if (!sessionStorage.getItem("seeded")) {
          sessionStorage.setItem("seeded", "1");
          localStorage.clear();
          localStorage.setItem("ind2.lang", JSON.stringify(lng));
        }
      } catch (e) { /* ignore */ }
    }, lang);
    const log = async () => (await p.evaluate(() => window.__voiceLog.splice(0))).forEach((x) => {
      const k = x.lang + "|" + x.text;
      if (!seen.has(k)) seen.set(k, x);
    });
    const tick = (ms) => p.clock.runFor(ms);
    const home = async () => { await p.evaluate(() => { location.hash = ""; }); await tick(300); };
    const say = async (text) => {
      await home();
      await p.evaluate((t) => {
        const f = document.getElementById("typeForm"); f.hidden = false;
        document.getElementById("typeField").value = t;
        f.requestSubmit();
      }, text);
      await tick(1500);
      await p.evaluate((l) => localStorage.setItem("ind2.lang", JSON.stringify(l)), lang);
    };
    const clickConfirm = async (screen) => {
      await p.evaluate((s) => { const b = document.querySelector(`[data-actions="${s}"] [data-confirm]`); if (b) b.click(); }, screen);
      await tick(1000);
    };

    await p.goto(BASE); await tick(1000);
    // Services disabled first: request to enable
    await say(CMDS[lang][8]);
    await p.evaluate(() => { const b = document.querySelector('[data-actions="services"] .btn-main'); if (b) b.click(); });
    await tick(6000);
    for (const c of CMDS[lang]) {
      if (/такси|апар|Отвези/i.test(c)) {
        await say(c); await clickConfirm("taxi");
        for (let i = 0; i < 40; i++) await tick(5000);   // whole ride: pickup, arrived, trip, finished
        await log(); continue;
      }
      await say(c);
      if (/кран|розетк|уборк|двер|Тазала|Есік/i.test(c)) { await clickConfirm("services"); await tick(7000); }
      if (/продукт|хлеб|азық|нан/i.test(c)) { await clickConfirm("food"); await tick(7000); }
      if (/доехать|добраться|Автобус|барамын|автобус/i.test(c)) {
        const n = await p.evaluate(() => document.querySelectorAll("#routeSteps .step-btn").length);
        for (let i = 0; i < n; i++) { await p.evaluate((j) => document.querySelectorAll("#routeSteps .step-btn")[j].click(), i); await tick(600); }
        await p.evaluate(() => { const b = document.querySelector('[data-actions="route"] .btn-main'); if (b) b.click(); });
        await tick(600);
      }
      if (/плохо|ауырып|Позвони|қоңырау/i.test(c)) {
        for (let i = 0; i < 4; i++) { await p.evaluate(() => { const b = document.getElementById("helpNext"); if (b && !b.hidden) b.click(); }); await tick(500); }
        await p.evaluate(() => document.getElementById("help103").click()); await tick(500);
        await p.evaluate(() => document.getElementById("helpClose").click()); await tick(300);
      }
      await log();
    }
    // "no" on a sub-screen, over-limit approval, language switch
    await say(CMDS[lang][0]);
    await p.evaluate(() => { const f = document.getElementById("typeForm"); f.hidden = false; });
    await p.evaluate((t) => { location.hash = "taxi"; }, null); await tick(300);
    await p.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("ind2.settings") || "{}"); s.spent = 19900;
      localStorage.setItem("ind2.settings", JSON.stringify(s));
    });
    await p.reload(); await tick(1000);
    await p.evaluate(() => { location.hash = "food"; }); await tick(500);
    await clickConfirm("food"); await tick(7000);
    await p.evaluate(() => { location.hash = ""; }); await tick(300);
    await p.evaluate((l) => { const b = [...document.querySelectorAll('[data-lang]')].find((x) => x.dataset.lang !== l); b.click(); }, lang);
    await tick(300);
    await p.evaluate((l) => { const b = [...document.querySelectorAll('[data-lang]')].find((x) => x.dataset.lang === l); b.click(); }, lang);
    await tick(300);
    await log();
    await ctx.close();
  }
  await browser.close();
  const out = [...seen.values()].sort((a, b) => (a.lang + a.text).localeCompare(b.lang + b.text));
  process.stdout.write(JSON.stringify(out, null, 1) + "\n");
})();
