/* ————————————————————————————————————————————————
   Fasset Prime — Trade (J8–J13). Rebuilt 2026-09-03 to the OpenFX
   structure in Prime's skin, per Hamis/Maks after the sandbox
   walk-through (full findings: ux-declutter skill, Benchmarks).

   THE OBJECT — one centered column, everything else subordinate:
   · "You buy" card over "You sell" card, a round swap button between.
     Warm-paper hosted surfaces (--surface-2), never OpenFX's dark
     cards. These are form controls, not stat boxes: the boxed-number
     ban covers display KPIs, not the input object.
   · the limit lives INSIDE the input as its placeholder ("Up to
     2,040,000"), not as standing copy. One quiet meta line under the
     object carries the tier label (Gold, by volume — never a rate).
   · ONE full-width button that morphs in place: Get firm quote →
     Execute at 3.6818 → (expired) Refresh quote. The object never
     jumps to a different screen shape.
   · on quote the sell card fills FIRM via per-digit assembly, a rate
     sentence appears ("1 USDT = 3.6818 AED") and Prime's lock bar
     runs under it — the lock ceremony (M3) survives the rebuild:
     arrival draw-in, linear un-eased drain, amber under 5s, the
     redemption drain on execute. It is still this screen's one
     saturated fill.
   · trade history below: Purchased · Sold · Rate (as a sentence) ·
     Status · Placed. A row opens the shared TRADE DETAILS drawer
     (flat def-list + legs card with the rate chip between them +
     Repeat), the same grammar OpenFX reuses from every list.
   · failures unchanged in substance: expired (refresh in place),
     armable upstream reprice (old rate struck, explicit re-accept),
     over-limit → the desk, GTR variant. Nothing fills silently at
     another price.

   Transient state lives in the screen-local Q object and survives
   re-renders; a webhook can never lose a running lock. Data API:
   makeQuote · placeOrder · sendToDesk · fundOrder · settleOrder ·
   deskBooksOverLimit.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;   // skeleton runs once per app load
  var lockRaf = null;       // the lock's animation frame
  var Q = null;             // screen-local state, survives re-renders
  var EXEC_MS = 900;        // the redemption window the fill drains across

  var FIATS = [
    { cur: "AED", pair: "USDT/AED" },
    { cur: "USD", pair: "USDT/USD" },
    { cur: "EUR", pair: "USDT/EUR" },
    { cur: "BHD", pair: "USDT/BHD" }
  ];

  // ————— foundation primitives (graceful floor, never re-implemented) —————
  function ccy(cur, opts) {
    if (UI.ccy) return UI.ccy(cur, opts);
    return opts && opts.label === false ? "" : UI.esc(cur);
  }
  function digits(el, text, stagger) {
    if (!el) return;
    if (UI.digits) UI.digits(el, text, { stagger: stagger });
    else el.textContent = text;
  }
  function settleFlash(el) { if (el && UI.settleFlash) UI.settleFlash(el); }
  function repaint(el, html) {
    if (!el) return;
    if (UI.repaint) UI.repaint(el, html);
    else el.innerHTML = html;
  }

  function parseAmt(s) { var a = parseFloat(String(s || "").replace(/,/g, "")); return a > 0 ? a : 0; }
  function rate4(r) { return Number(r).toFixed(4); }

  function fiat() { return Q.buyCur === "USDT" ? Q.sellCur : Q.buyCur; }
  function pairId() { return "USDT/" + fiat(); }
  function side() { return Q.buyCur === "USDT" ? "buy" : "sell"; }
  function buyingUSDT() { return Q.buyCur === "USDT"; }

  // fiats in the client's pinned order (dashboard rates row shares it)
  function orderedFiats() {
    var by = {};
    FIATS.forEach(function (f) { by[f.pair] = f; });
    var out = (Data.state.pairOrder || []).map(function (id) { return by[id]; }).filter(Boolean);
    return out.length ? out : FIATS;
  }
  function fiatLive(f) { return !f.never && Data.railLive(f.cur); }

  function initQ() {
    var t = Data.state.trades[0] || null;
    var f = t && Data.railLive(Data.fiatOf(t.pair)) ? Data.fiatOf(t.pair) : "AED";
    var buyU = !t || t.side === "buy";
    Q = {
      buyCur: buyU ? "USDT" : f,
      sellCur: buyU ? f : "USDT",
      amt: t ? UI.fmtNum(buyU ? t.assetAmt : t.fiatAmt, 0) : "",
      prefilledFrom: t ? t.id : null,
      amtNum: 0, fiatFirm: 0, notional: 0, ref: 0, rate: 0, newRate: 0, expiresAt: 0,
      state: "idle", booked: null,
      justQuoted: false, justRepriced: false, justBooked: false,
      execFrom: 1, execStart: 0,
      gtr: false, gtrSent: false, armReprice: false
    };
  }

  // ————— the lock: width driven by the clock, never by an easing curve —————

  function stopLock() { if (lockRaf) cancelAnimationFrame(lockRaf); lockRaf = null; }

  function lockFraction() {
    return Math.max(0, Math.min(1, (Q.expiresAt - Date.now()) / (Data.LOCK_SECS * 1000)));
  }

  function startLock() {
    stopLock();
    var tick = function () {
      var fill = document.getElementById("tqLockFill");
      if (!fill || Q.state !== "quoted") { lockRaf = null; return; }
      var left = Q.expiresAt - Date.now();
      if (left <= 0) { lockRaf = null; Q.state = "expired"; renderPanel(); return; }
      fill.style.width = (Math.min(1, left / (Data.LOCK_SECS * 1000)) * 100) + "%";
      var lock = document.getElementById("tqLock");
      if (lock) lock.classList.toggle("low", left <= 5000);
      var secs = document.getElementById("tqLockSecs");
      if (secs) secs.textContent = "Locked for " + Math.ceil(left / 1000) + " s.";
      lockRaf = requestAnimationFrame(tick);
    };
    lockRaf = requestAnimationFrame(tick);
  }

  function startExecDrain() {
    stopLock();
    var tick = function () {
      var fill = document.getElementById("tqLockFill");
      if (!fill || Q.state !== "executing") { lockRaf = null; return; }
      var p = Math.min(1, (Date.now() - Q.execStart) / EXEC_MS);
      fill.style.width = (Q.execFrom * (1 - p) * 100) + "%";
      if (p >= 1) { lockRaf = null; return; }
      lockRaf = requestAnimationFrame(tick);
    };
    lockRaf = requestAnimationFrame(tick);
  }

  // ————— quote actions —————

  function getQuote() {
    var raw = parseAmt(Q.amt);
    if (!raw) { UI.toast("Enter an amount first.", "blocked"); return; }
    if (Data.state.stale) { UI.toast("Rate feed interrupted. Nothing quotes on a stale price.", "blocked"); return; }
    var provisional = buyingUSDT() ? raw : raw / Data.refRate(pairId());
    var notional = Data.notionalAED(pairId(), provisional);
    if (notional > Data.LIMIT_AED) { Q.amtNum = provisional; Q.notional = notional; Q.state = "overlimit"; renderPanel(); return; }
    var q = Data.makeQuote(pairId(), side(), provisional);
    Q.ref = q.ref; Q.rate = q.rate; Q.expiresAt = q.expiresAt;
    if (buyingUSDT()) {
      Q.amtNum = raw;
      Q.fiatFirm = raw * Q.rate;
    } else {
      // the client typed the fiat they receive; the USDT leg firms to match
      Q.amtNum = raw / Q.rate;
      Q.fiatFirm = raw;
    }
    Q.notional = Data.notionalAED(pairId(), Q.amtNum);
    Q.state = "quoted";
    Q.justQuoted = true;
    renderPanel();
  }

  function execute() {
    Q.execFrom = lockFraction();
    Q.execStart = Date.now();
    stopLock();
    Q.state = "executing";
    renderPanel();
    setTimeout(function () {
      if (Q.state !== "executing") return;
      if (Q.armReprice) {
        Q.armReprice = false;
        Q.newRate = Q.rate + (side() === "buy" ? 1 : -1) * 0.0031;
        Q.state = "repriced";
        Q.justRepriced = true;
        renderPanel();
        return;
      }
      book(Q.rate);
    }, EXEC_MS);
  }

  function book(rate) {
    var t = Data.placeOrder({ pair: pairId(), side: side(), amtNum: Q.amtNum, notional: Q.notional }, rate);
    Q.booked = t;
    Q.state = "placed";
    Q.justBooked = true;
    renderPanel();
  }

  function repeat(t) {
    if (!Data.railLive(Data.fiatOf(t.pair))) {
      UI.toast(t.pair + " opens the moment the " + Data.fiatOf(t.pair) + " rail is live.", "blocked");
      return;
    }
    var buyU = t.side === "buy";
    Q.buyCur = buyU ? "USDT" : Data.fiatOf(t.pair);
    Q.sellCur = buyU ? Data.fiatOf(t.pair) : "USDT";
    Q.amt = UI.fmtNum(buyU ? t.assetAmt : t.fiatAmt, 0);
    Q.prefilledFrom = t.id;
    getQuote();
    UI.toast("Prefilled from " + t.id + ". Fetching a fresh quote.", "note");
  }

  // ————— the object —————

  function maxLegText() {
    var perUSDT = Data.notionalAED(pairId(), 1);
    var maxU = perUSDT ? Data.LIMIT_AED / perUSDT : 0;
    var maxLeg = buyingUSDT() ? maxU : maxU * Data.refRate(pairId());
    return "Up to " + UI.fmtNum(maxLeg, 0);
  }

  function selHtml(leg) {
    var cur = leg === "buy" ? Q.buyCur : Q.sellCur;
    if (cur === "USDT") {
      return '<span class="tx-cur">' + ccy("USDT") + "</span>";
    }
    var lock = Q.state !== "idle" ? " disabled" : "";
    return '<select class="select tx-sel" id="txFiatSel" aria-label="Currency"' + lock + ">" +
      orderedFiats().map(function (f) {
        return '<option value="' + f.cur + '"' + (f.cur === cur ? " selected" : "") +
          (fiatLive(f) ? "" : " disabled") + ">" + f.cur + (fiatLive(f) ? "" : " · soon") + "</option>";
      }).join("") + "</select>";
  }

  function sellDisplay() {
    var raw = parseAmt(Q.amt);
    if (Q.state === "quoted" || Q.state === "executing") {
      var firm = buyingUSDT() ? Q.fiatFirm : Q.amtNum;
      return UI.moneyHero(Q.sellCur, firm, { dp: buyingUSDT() ? 2 : 0 });
    }
    if (!raw) return '<span class="faint">0.00</span>';
    var est = buyingUSDT() ? raw * Data.refRate(pairId()) : raw / Data.refRate(pairId());
    return UI.money(Q.sellCur, est, { dp: buyingUSDT() ? 2 : 0 });
  }

  function objectHtml(mode) {
    var S = Data.state;
    var idle = mode === "idle";
    var firm = mode === "quoted" || mode === "executing";
    return '<div class="tx-object">' +
      '<div class="tx-card">' +
        '<div class="tx-row1"><span class="tx-label">You buy</span>' + selHtml("buy") + "</div>" +
        '<input class="tx-amt" id="txAmt" inputmode="decimal" autocomplete="off" placeholder="' +
          UI.esc(maxLegText()) + '" value="' + UI.esc(Q.amt) + '"' + (idle ? "" : " readonly") + ">" +
        '<div class="tx-row3"><span></span><span>Balance ' + UI.money(Q.buyCur, S.bal[Q.buyCur] || 0) + "</span></div>" +
      "</div>" +
      '<div class="tx-swap-row"><button class="tx-swap" id="txSwap" type="button" aria-label="Swap"' + (idle ? "" : " disabled") + ">" + icon("swap", 15) + "</button></div>" +
      '<div class="tx-card">' +
        '<div class="tx-row1"><span class="tx-label">You sell</span>' + selHtml("sell") + "</div>" +
        '<div class="tx-amt tx-amt-out' + (firm ? "" : " est") + '" id="txSellAmt">' + sellDisplay() + "</div>" +
        '<div class="tx-row3"><span id="txSellNote">' + (firm ? "firm at your locked rate" : "estimate at market reference") + "</span>" +
          "<span>Balance " + UI.money(Q.sellCur, S.bal[Q.sellCur] || 0) + "</span></div>" +
      "</div>" +
    "</div>";
  }

  function lockHtml(pct, secsText, arriving) {
    return '<div class="tq-lock' + (arriving ? " arriving" : "") + '" id="tqLock">' +
      '<div class="tq-lock-bar"><i class="tq-lock-fill" id="tqLockFill" style="width:' + pct.toFixed(3) + '%"></i></div>' +
      '<div class="tq-lock-secs" id="tqLockSecs" aria-live="polite" aria-atomic="true">' + UI.esc(secsText) + "</div></div>";
  }

  function metaLine() {
    if (Q.gtr) return '<p class="freshline tx-meta">Priced by the desk · quoted by your relationship manager</p>';
    return '<p class="freshline tx-meta">Gold tier by 30-day volume · self-serve limit ' +
      UI.money("AED", Data.LIMIT_AED, { dp: 0 }) + ' per trade <span class="tag">illustrative figures</span></p>';
  }

  function coverage() {
    var payCur = side() === "buy" ? fiat() : "USDT";
    var payAmt = side() === "buy" ? Q.fiatFirm : Q.amtNum;
    var short = Math.max(0, payAmt - (Data.state.bal[payCur] || 0));
    return short <= 0
      ? "Your " + payCur + " balance covers this. It funds and books the moment you execute."
      : UI.money(payCur, short) + " short. Executing still places it and holds this rate while you fund it.";
  }

  // ————— panel states —————

  function headline(txt) { return '<div class="section-head" id="tqHead"><h2>' + UI.esc(txt) + "</h2></div>"; }

  function gtrHtml() {
    if (!Q.gtrSent) {
      return headline("Desk pricing") +
        '<p class="tq-statement">Your account is priced by the desk. Request rates and a relationship manager will contact you.</p>' +
        '<div class="tq-actions"><button class="btn btn-primary btn-lg" id="tqGtrGo" type="button">Request rates</button></div>';
    }
    return headline("With the desk") +
      '<div class="note note-info tq-note">Request submitted. The desk will contact you.</div>' +
      '<div class="tq-actions"><button class="btn btn-secondary" id="tqGtrDone" type="button">Done</button></div>';
  }

  function panelHtml() {
    var S = Data.state;
    if (Q.gtr) return gtrHtml();
    if (Q.state === "desk_sent" && !S.deskRequest) Q.state = "idle";
    if (!Data.railLive(fiat())) { Q.buyCur = "USDT"; Q.sellCur = "AED"; }

    if (Q.state === "idle") {
      return (S.stale ? '<div class="note note-warning tq-note" style="margin-bottom:16px">Rate feed interrupted, so nothing quotes on a stale price. Try again in a moment.</div>' : "") +
        objectHtml("idle") +
        metaLine() +
        '<button class="btn btn-primary btn-lg tx-cta" id="txGo" type="button">Get firm quote</button>' +
        '<p class="freshline mt-12" style="text-align:center">Firm for your exact size, locked for ' + Data.LOCK_SECS + " seconds.</p>";
    }

    if (Q.state === "quoted") {
      var left = Math.max(0, Q.expiresAt - Date.now());
      return objectHtml("quoted") +
        '<div class="tx-quote-row"><span class="tx-rate-line">1 USDT = <span id="tqRateNum">' + rate4(Q.rate) + "</span> " + UI.esc(fiat()) + "</span>" +
        lockHtml(lockFraction() * 100, "Locked for " + Math.ceil(left / 1000) + " s.", Q.justQuoted) + "</div>" +
        '<p class="freshline mt-8">' + coverage() + "</p>" +
        '<button class="btn btn-primary btn-lg tx-cta" id="tqExec" type="button">Execute at ' + rate4(Q.rate) + "</button>" +
        '<div class="tx-under"><button class="link" id="tqCancel" type="button">Cancel</button></div>';
    }

    if (Q.state === "expired") {
      return objectHtml("expired") +
        '<div class="tx-quote-row"><span class="tx-rate-line faint">Quote expired · nothing was executed</span></div>' +
        '<button class="btn btn-primary btn-lg tx-cta" id="tqRefresh" type="button">Refresh quote</button>' +
        '<div class="tx-under"><button class="link" id="tqCancel" type="button">Start over</button></div>';
    }

    if (Q.state === "executing") {
      return objectHtml("executing") +
        '<div class="tx-quote-row"><span class="tx-rate-line">1 USDT = ' + rate4(Q.rate) + " " + UI.esc(fiat()) + "</span>" +
        lockHtml(Q.execFrom * 100, "Redeeming your locked rate.", false) + "</div>" +
        '<button class="btn btn-primary btn-lg tx-cta" disabled type="button">Executing</button>' +
        '<p class="freshline mt-12" style="text-align:center">If the connection drops, nothing books twice.</p>';
    }

    if (Q.state === "repriced") {
      var delta = Q.newRate - Q.rate;
      return headline("The price has changed") +
        '<div class="tq-rate-row"><span class="tq-rate struck">' + rate4(Q.rate) + "</span>" +
          '<span class="tq-rate" id="tqRateNew">' + rate4(Q.newRate) + "</span>" +
          '<span class="tq-ref">' + (delta >= 0 ? "+" : "") + delta.toFixed(4) + " against your locked rate</span></div>" +
        '<div class="note note-error tq-note mt-16">Your trade did not execute. The rate moved first, so nothing was booked. Accept the new rate or decline.</div>' +
        '<div class="tq-actions"><button class="btn btn-primary btn-lg" id="tqAccept" type="button">Accept ' + rate4(Q.newRate) + "</button>" +
          '<button class="btn btn-secondary" id="tqDecline" type="button">Decline</button></div>' +
        '<p class="freshline mt-16">Declining leaves you exactly where you started.</p>';
    }

    if (Q.state === "placed") {
      var t = Q.booked;
      var head = t.state === "awaiting" ? "Order placed · awaiting funding"
        : t.state === "settling" ? "Funded · booked at your locked rate" : "Completed";
      var note = t.state === "awaiting"
        ? '<div class="note note-warning tq-note mt-16">Your rate is locked. ' + UI.money(t.payCur, t.needed) +
          ' still needed within 24 hours. <button class="link" id="tqDeposit" type="button">View your deposit details</button></div>'
        : t.state === "settling"
        ? '<div class="note note-info tq-note mt-16">Funds release within 30 minutes.</div>'
        : '<div class="note note-positive tq-note mt-16">Completed. The proceeds are in your available balance.</div>';
      return headline(head) + orderSummary(t) + note +
        '<div class="tq-actions">' +
          (t.state === "awaiting" ? "" : '<button class="btn btn-primary" id="tqRepeatLast" type="button">Repeat</button>') +
          '<button class="btn btn-secondary" id="tqDone" type="button">Done</button></div>';
    }

    if (Q.state === "overlimit") {
      return headline("Above your self-serve limit") +
        '<p class="tq-statement">This trade is ' + UI.money("AED", Q.notional) + ". Your limit is " +
          UI.money("AED", Data.LIMIT_AED, { dp: 0 }) + " per trade. The desk books it for you.</p>" +
        '<div class="tq-actions"><button class="btn btn-primary btn-lg" id="tqDesk" type="button">Send to the desk</button>' +
          '<button class="btn btn-secondary" id="tqCancel" type="button">Adjust the amount</button></div>';
    }

    if (Q.state === "desk_sent") {
      var r = Data.state.deskRequest;
      return headline("With the desk") +
        '<div class="note note-info tq-note">Request DR-' + UI.esc(r.id) + " created for " + (r.side === "buy" ? "buy " : "sell ") +
          UI.fmtNum(r.amt, 0) + " USDT, " + UI.money("AED", r.notional) + ". The desk will contact you.</div>" +
        '<div class="tq-actions"><button class="btn btn-secondary" id="tqDone" type="button">Done</button></div>';
    }

    return "";
  }

  function orderSummary(t) {
    return '<div class="def-group">' +
      '<div class="def-row"><span class="def-label">Order</span><span class="def-value strong">' + UI.esc(t.id) + "</span></div>" +
      '<div class="def-row"><span class="def-label">Side</span><span class="def-value">' + (t.side === "buy" ? "Buy" : "Sell") + " USDT · " + UI.esc(t.pair) + "</span></div>" +
      '<div class="def-row"><span class="def-label">Locked rate</span><span class="def-value strong" id="tqBookedRate">' + rate4(t.rate) + "</span></div>" +
      '<div class="def-row"><span class="def-label">USDT</span><span class="def-value">' + UI.money("USDT", t.assetAmt, { dp: 0 }) + "</span></div>" +
      '<div class="def-row"><span class="def-label">' + UI.esc(Data.fiatOf(t.pair)) + '</span><span class="def-value">' + UI.money(Data.fiatOf(t.pair), t.fiatAmt) + "</span></div>" +
      '<div class="def-row"><span class="def-label">Placed</span><span class="def-value">' + UI.esc(UI.fmtTs(t.ts)) + "</span></div>" +
      "</div>";
  }

  // ————— the shared trade details drawer (OpenFX grammar, Prime skin) —————
  // Opened from any history row here; History (the archive) has its own
  // richer lifecycle view and keeps it.

  function tradeStatus(t) {
    if (t.state === "settled") return UI.statusDot("positive", "Completed");
    if (t.state === "failed") return UI.statusDot("error", "Failed");
    if (t.state === "settling") return UI.statusDot("info", "Processing");
    return UI.statusDot("warning", "Awaiting funding");
  }

  // details open through the shared drawer (js/details.js)

  // ————— trade history: the simple table —————

  function historyHtml() {
    var rows = Data.state.trades.slice(0, 6).map(function (t) {
      var f = Data.fiatOf(t.pair);
      var buyU = t.side === "buy";
      return {
        key: t.id,
        clickable: true,
        cells: [
          '<span class="cell-main">' + ccy(buyU ? "USDT" : f, { label: false }) +
            '<span class="txh-amt">' + (buyU ? UI.money("USDT", t.assetAmt, { dp: 0 }) : UI.money(f, t.fiatAmt)) + "</span></span>",
          '<span class="txh-amt sub">' + (buyU ? UI.money(f, t.fiatAmt) : UI.money("USDT", t.assetAmt, { dp: 0 })) + "</span>",
          '<span class="date">1 USDT = ' + rate4(t.rate) + " " + UI.esc(f) + "</span>",
          tradeStatus(t),
          '<span class="date">' + UI.esc(UI.fmtTs(t.ts)) + (t.byDesk ? " · desk" : "") + "</span>"
        ]
      };
    });
    return UI.table({
      // identity capped, spacer takes the surplus, the cluster stays adjacent
      cols: [
        { label: "Purchased", w: "minmax(0, 220px)" },
        { spacer: true },
        { label: "Sold", w: "190px" },
        { label: "Rate", w: "195px" },
        { label: "Status", w: "150px" },
        { label: "Placed", w: "135px" }
      ],
      rows: rows,
      empty: "No trades yet."
    });
  }

  function wireHist() {
    var host = document.getElementById("txHist");
    if (!host) return;
    host.querySelectorAll(".row.clickable").forEach(function (r) {
      if (r.__txWired) return;
      r.__txWired = true;
      r.addEventListener("click", function () {
        var t = Data.state.trades.filter(function (x) { return x.id === r.getAttribute("data-key"); })[0];
        if (t && window.Details) Details.open("trade", t);
      });
    });
  }

  // ————— panel render + wiring —————

  function renderPanel() {
    var p = document.getElementById("tqPanel");
    if (!p) return;
    stopLock();
    p.innerHTML = panelHtml();

    var byId = function (id) { return p.querySelector("#" + id); };

    // the ceremony: one assembly, one arrival, one settle, each once
    if (Q.state === "quoted" && Q.justQuoted) {
      digits(byId("tqRateNum"), rate4(Q.rate), 18);
      var lock = byId("tqLock");
      if (lock) {
        var fill = byId("tqLockFill");
        if (fill) fill.addEventListener("animationend", function () { lock.classList.remove("arriving"); });
      }
      Q.justQuoted = false;
    }
    if (Q.state === "repriced" && Q.justRepriced) {
      digits(byId("tqRateNew"), rate4(Q.newRate), 18);
      Q.justRepriced = false;
    }
    if (Q.state === "placed" && Q.justBooked) {
      digits(byId("tqBookedRate"), rate4(Q.booked.rate), 18);
      settleFlash(p.querySelector("#tqHead h2"));
      Q.justBooked = false;
    }

    var amt = byId("txAmt");
    if (amt && Q.state === "idle") {
      amt.addEventListener("input", function () {
        Q.amt = amt.value;
        var out = byId("txSellAmt");
        if (out) out.innerHTML = sellDisplay();
      });
      amt.addEventListener("keydown", function (e) { if (e.key === "Enter") getQuote(); });
    }
    var swap = byId("txSwap");
    if (swap) swap.addEventListener("click", function () {
      if (Q.state !== "idle") return;
      var b = Q.buyCur;
      Q.buyCur = Q.sellCur;
      Q.sellCur = b;
      renderPanel();
    });
    var sel = byId("txFiatSel");
    if (sel) sel.addEventListener("change", function () {
      if (Q.buyCur === "USDT") Q.sellCur = sel.value; else Q.buyCur = sel.value;
      renderPanel();
    });

    var on = function (id, fn) { var b = byId(id); if (b) b.addEventListener("click", fn); };
    on("txGo", getQuote);
    on("tqExec", execute);
    on("tqRefresh", getQuote);
    on("tqCancel", function () { Q.state = "idle"; renderPanel(); });
    on("tqAccept", function () { book(Q.newRate); });
    on("tqDecline", function () { Q.state = "idle"; renderPanel(); });
    on("tqDone", function () { Q.state = "idle"; renderPanel(); });
    on("tqRepeatLast", function () { repeat(Q.booked); });
    on("tqDeposit", function () {
      var b = App.screen("balance");
      if (b && b.setCur && Q.booked) b.setCur(Q.booked.payCur || fiat());
      App.go("balance");
    });
    on("tqDesk", function () { Data.sendToDesk({ pair: pairId(), side: side(), amtNum: Q.amtNum, notional: Q.notional }); Q.state = "desk_sent"; renderPanel(); });
    on("tqGtrGo", function () {
      Q.gtrSent = true;
      renderPanel();
      Data.notify("Rate request sent to the desk", "A relationship manager will contact you.", "trade");
    });
    on("tqGtrDone", function () { Q.gtrSent = false; renderPanel(); });

    if (Q.state === "quoted") startLock();
    if (Q.state === "executing") startExecDrain();
  }

  // ————— render —————

  function skeletonHtml() {
    return '<div class="section"><div class="tx-wrap">' +
      UI.skel("100%", "110px") +
      '<div class="mt-8">' + UI.skel("100%", "110px") + "</div>" +
      '<div class="mt-16">' + UI.skel("100%", "44px") + "</div>" +
      '</div><div class="mt-32">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      "</div>";
  }

  function render(el) {
    if (!Q) initQ();

    if (!loadedOnce) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 360);
      return;
    }
    renderBody(el);
  }

  function renderBody(el) {
    var canAct = Data.state.role !== "viewer";
    var h = "";

    h += '<div class="section"><div class="tx-wrap" id="tqPanel"></div></div>';

    h += '<div class="section"><div class="section-head"><h2>Trade history</h2></div>' +
      '<div id="txHist">' + historyHtml() + "</div></div>";

    h += '<div class="section"><div class="demo-strip">' +
      '<span class="freshline">Demo · quote failure states and order lifecycle pushes.</span>' +
      '<button class="db-btn' + (Q.armReprice ? " armed" : "") + '" id="tqArm" type="button">Arm: next execute fails upstream (price changed)</button>' +
      '<button class="db-btn" id="tqFf" type="button">Fast-forward the lock to expiry</button>' +
      '<button class="db-btn" id="tqFund" type="button">Webhook: funding arrives</button>' +
      '<button class="db-btn" id="tqSettle" type="button">Fast-forward: settlement window elapses</button>' +
      '<button class="db-btn' + (Q.gtr ? " on" : "") + '" id="tqGtr" type="button">Toggle: GTR account (desk pricing)</button>' +
      (Data.state.deskRequest ? '<button class="db-btn" id="tqDeskBook" type="button">Desk books the over-limit trade</button>' : "") +
      "</div></div>";

    el.insertAdjacentHTML("beforeend", h);

    if (!canAct) {
      var p = el.querySelector("#tqPanel");
      p.innerHTML = '<div class="section-head"><h2>Quotes</h2></div>' +
        '<p class="tq-statement">Placing orders is for admins and traders. Rates and history stay visible to you.</p>';
    } else {
      renderPanel();
    }

    wireHist();

    var on = function (id, fn) { var b = el.querySelector("#" + id); if (b) b.addEventListener("click", fn); };
    on("tqArm", function () {
      Q.armReprice = !Q.armReprice;
      el.querySelector("#tqArm").classList.toggle("armed", Q.armReprice);
      UI.toast(Q.armReprice ? "Armed. The next execute will be rejected upstream." : "Disarmed.", "note");
    });
    on("tqFf", function () {
      if (Q.state === "quoted") Q.expiresAt = Date.now() + 1200;
      else UI.toast("Get a quote first, then fast-forward its lock.", "blocked");
    });
    on("tqFund", function () { if (!Data.fundOrder()) UI.toast("No order awaiting funding.", "blocked"); });
    on("tqSettle", function () { if (!Data.settleOrder()) UI.toast("Nothing settling. Fund and book an order first.", "blocked"); });
    on("tqGtr", function () {
      Q.gtr = !Q.gtr; Q.gtrSent = false; Q.state = "idle";
      var b = el.querySelector("#tqGtr");
      if (b) b.classList.toggle("on", Q.gtr);
      if (canAct) renderPanel();
    });
    on("tqDeskBook", function () { Data.deskBooksOverLimit(); });
  }

  App.registerScreen("trade", {
    title: "Trade",
    subtitle: "A firm, executable rate for your exact size, locked while you commit",
    zone: "app",
    prefill: function (t) { repeat(t); },
    render: render,
    // protect a running lock: nothing here rebuilds the panel from a webhook.
    // History and the cards' balance lines patch in place; a full render
    // happens only on prefs/all (role, rails, theme-adjacent changes).
    onData: function (scope) {
      if (scope === "prefs" || scope === "all") return false;
      if (scope === "notifs") return true;
      if (scope === "pins") { if (Q && Q.state === "idle") renderPanel(); return true; }
      var host = document.getElementById("txHist");
      if (scope === "trades" && host) {
        repaint(host, historyHtml());
        wireHist();
        requestAnimationFrame(wireHist);
        if (Q && (Q.state === "placed" || Q.state === "idle")) renderPanel();
        return true;
      }
      // deposits, withdrawals, journey, ib, team, whitelist: balances may have
      // moved; refresh the idle object, never a running lock
      if (Q && Q.state === "idle") renderPanel();
      return true;
    }
  });
})();
