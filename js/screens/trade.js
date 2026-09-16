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
   · ONE full-width button that morphs in place: Get quote →
     Execute at 3.6818 → (expired) Refresh quote. The object never
     jumps to a different screen shape.
   · on quote the sell card fills FIRM via per-digit assembly, a rate
     sentence appears ("1 USDT = 3.6818 AED") and Prime's lock bar
     runs under it — the lock ceremony (M3) survives the rebuild:
     arrival draw-in, linear un-eased drain, amber under 5s, the
     redemption drain on execute. It is still this screen's one
     saturated fill.
   · trade history below: Purchased · Sold · Rate (as a sentence) ·
     Status · Date. A row opens the shared TRADE DETAILS drawer
     (flat def-list + legs card with the rate chip between them +
     Repeat), the same grammar OpenFX reuses from every list.
   · failures unchanged in substance: expired (refresh in place),
     armable upstream reprice (old rate struck, explicit re-accept),
     over-limit → the desk, GTR variant. Nothing fills silently at
     another price.

   Transient state lives in the screen-local Q object and survives
   re-renders; a webhook can never lose a running lock. Data API:
   makeQuote · placeOrder · fundOrder · settleOrder. Over-limit is an
   offline RM conversation (2026-09-03), not an in-app request.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;   // skeleton runs once per app load
  var lockRaf = null;       // the lock's animation frame
  var Q = null;             // screen-local state, survives re-renders
  var EXEC_MS = 900;        // the redemption window the fill drains across
  var fundIv = null;        // the funding countdown's interval

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
      entry: "buy",             // which card the client typed into — either works
      amt: t ? UI.fmtNum(buyU ? t.assetAmt : t.fiatAmt, 0) : "",
      prefilledFrom: t ? t.id : null,
      amtNum: 0, fiatFirm: 0, notional: 0, ref: 0, rate: 0, newRate: 0, expiresAt: 0,
      state: "idle", booked: null,
      justQuoted: false, justRepriced: false, justBooked: false,
      execFrom: 1, execStart: 0,
      gtr: false, gtrSent: false, armReprice: false
    };
  }

  function curOf(side) { return side === "buy" ? Q.buyCur : Q.sellCur; }
  function entryCur() { return curOf(Q.entry); }

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

  // over-limit as a live fact under the input, not a screen you land on after
  // tapping (Hamis, 15 Sep). Returns the AED notional of what is typed, or 0.
  function typedNotional() {
    var raw = parseAmt(Q.amt);
    if (!raw) return 0;
    var usdt = entryCur() === "USDT" ? raw : raw / Data.refRate(pairId());
    return Data.notionalAED(pairId(), usdt);
  }
  function overLimit() { return typedNotional() > Data.LIMIT_AED; }

  function limitNoteHtml() {
    if (!overLimit()) return "";
    return '<p class="tx-limit-note" id="txLimitNote">Above your ' +
      UI.money("AED", Data.LIMIT_AED, { dp: 0 }) + " limit for a single trade. " +
      "Contact your relationship manager to trade more than this.</p>";
  }

  function getQuote() {
    var raw = parseAmt(Q.amt);
    if (!raw) { UI.toast("Enter an amount first.", "blocked"); return; }
    if (Data.state.stale) { UI.toast("Rate feed interrupted. Nothing quotes on a stale price.", "blocked"); return; }
    var typedUSDT = entryCur() === "USDT";
    var provisional = typedUSDT ? raw : raw / Data.refRate(pairId());
    var notional = Data.notionalAED(pairId(), provisional);
    if (notional > Data.LIMIT_AED) return;
    var q = Data.makeQuote(pairId(), side(), provisional);
    Q.ref = q.ref; Q.rate = q.rate; Q.expiresAt = q.expiresAt;
    if (typedUSDT) {
      Q.amtNum = raw;
      Q.fiatFirm = raw * Q.rate;
    } else {
      // the client typed the fiat leg; the USDT leg firms to match
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
    Q.entry = "buy";
    Q.amt = UI.fmtNum(buyU ? t.assetAmt : t.fiatAmt, 0);
    Q.prefilledFrom = t.id;
    getQuote();
    UI.toast("Prefilled from " + t.id + ". Fetching a fresh quote.", "note");
  }

  // ————— the object —————

  function maxLegText(cur) {
    var perUSDT = Data.notionalAED(pairId(), 1);
    var maxU = perUSDT ? Data.LIMIT_AED / perUSDT : 0;
    var maxLeg = cur === "USDT" ? maxU : maxU * Data.refRate(pairId());
    return "Up to " + UI.fmtNum(maxLeg, 0);
  }

  // both legs wear the same control (Hamis, 15 Sep): the USDT side is a select
  // with one option rather than bare text, so buy and sell look like one object.
  // Flags come from the currency's country; USDT has none and keeps its swatch.
  var CUR_ISO = { AED: "AE", USD: "US", EUR: "EU", BHD: "BH" };
  function curFlag(cur) {
    var iso = CUR_ISO[cur];
    return iso && Data.QUAL && Data.QUAL.flagOf ? Data.QUAL.flagOf(iso) + "  " : "";
  }
  function selHtml(leg) {
    var cur = leg === "buy" ? Q.buyCur : Q.sellCur;
    if (cur === "USDT") {
      return '<span class="tx-cur-fixed">' + ccy("USDT", { label: false }) + "<span>USDT</span></span>";
    }
    var lock = Q.state !== "idle" ? " disabled" : "";
    return '<select class="select tx-sel" id="txFiatSel" aria-label="Currency"' + lock + ">" +
      orderedFiats().map(function (f) {
        return '<option value="' + f.cur + '"' + (f.cur === cur ? " selected" : "") +
          (fiatLive(f) ? "" : " disabled") + ">" + curFlag(f.cur) + f.cur + (fiatLive(f) ? "" : " · soon") + "</option>";
      }).join("") + "</select>";
  }

  // the estimated value of the NON-entry side, from the typed side, via USDT.
  // Indicative only: the firm number exists once a quote is locked.
  function estFor(side) {
    var raw = parseAmt(Q.amt);
    if (!raw) return "";
    var r = Data.refRate(pairId());
    var usdt = entryCur() === "USDT" ? raw : raw / r;
    var out = curOf(side) === "USDT" ? usdt : usdt * r;
    return UI.fmtNum(out, curOf(side) === "USDT" ? 0 : 2);
  }

  function firmFor(side) {
    return curOf(side) === "USDT" ? Q.amtNum : Q.fiatFirm;
  }

  // one card per side. Both sides are typeable in idle (Hamis 2026-09-03):
  // typing in a card makes it the entry side and the other side estimates.
  // Once quoted, the entry side is the client's exact size and the other
  // side lands firm through the moneyHero ceremony.
  function cardHtml(side, mode) {
    var S = Data.state;
    var idle = mode === "idle";
    var firm = mode === "quoted" || mode === "executing";
    var cur = curOf(side);
    var isEntry = Q.entry === side;
    var body;
    if (idle) {
      body = '<input class="tx-amt' + (isEntry ? "" : " est") + '" id="txAmt-' + side + '" inputmode="decimal" autocomplete="off" placeholder="' +
        UI.esc(maxLegText(cur)) + '" value="' + UI.esc(isEntry ? Q.amt : estFor(side)) + '">';
    } else if (isEntry) {
      body = '<input class="tx-amt" id="txAmt-' + side + '" value="' + UI.esc(Q.amt) + '" readonly>';
    } else {
      body = '<div class="tx-amt tx-amt-out' + (firm ? "" : " est") + '">' +
        (firm ? UI.moneyHero(cur, firmFor(side), { dp: cur === "USDT" ? 0 : 2 }) : '<span class="faint">0.00</span>') + "</div>";
    }
    var note = isEntry ? "" : (firm ? "firm at your locked rate" : "indicative");
    var balLbl = side === "sell" ? "Available " : "Balance ";
    return '<div class="tx-card">' +
      '<div class="tx-row1"><span class="tx-label">' + (side === "buy" ? "You buy" : "You sell") + "</span>" + selHtml(side) + "</div>" +
      body +
      '<div class="tx-row3"><span>' + note + "</span><span>" + balLbl + UI.money(cur, S.bal[cur] || 0) + "</span></div>" +
    "</div>";
  }

  function objectHtml(mode) {
    var idle = mode === "idle";
    return '<div class="tx-object">' +
      cardHtml("buy", mode) +
      '<div class="tx-swap-row"><button class="tx-swap" id="txSwap" type="button" aria-label="Swap"' + (idle ? "" : " disabled") + ">" + icon("swap", 15) + "</button></div>" +
      cardHtml("sell", mode) +
    "</div>";
  }

  function lockHtml(pct, secsText, arriving) {
    return '<div class="tq-lock' + (arriving ? " arriving" : "") + '" id="tqLock">' +
      '<div class="tq-lock-bar"><i class="tq-lock-fill" id="tqLockFill" style="width:' + pct.toFixed(3) + '%"></i></div>' +
      '<div class="tq-lock-secs" id="tqLockSecs" aria-live="polite" aria-atomic="true">' + UI.esc(secsText) + "</div></div>";
  }

  // says the two numbers the client needs: what leaves the balance now, and
  // what they still have to put in. Never the word "short" on its own.
  function coverage() {
    var payCur = side() === "buy" ? fiat() : "USDT";
    var payAmt = side() === "buy" ? Q.fiatFirm : Q.amtNum;
    var have = Data.state.bal[payCur] || 0;
    var short = Math.max(0, payAmt - have);
    var dp = payCur === "USDT" ? 0 : 2;
    if (short <= 0) return "Uses " + UI.money(payCur, payAmt, { dp: dp }) + " from your balance.";
    return "Uses " + UI.money(payCur, have, { dp: dp }) + " from your balance. You add " +
      UI.money(payCur, short, { dp: dp }) + " to fund the rest.";
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
    if (!Data.railLive(fiat())) { Q.buyCur = "USDT"; Q.sellCur = "AED"; }

    if (Q.state === "idle") {
      // no price before the quote (Hamis 2026-09-03): the estimated side says
      // "indicative" and the firm number exists only once a quote is locked
      return (S.stale ? '<div class="note note-warning tq-note" style="margin-bottom:16px">Rate feed interrupted, so nothing quotes on a stale price. Try again in a moment.</div>' : "") +
        objectHtml("idle") +
        '<div id="txLimitSlot">' + limitNoteHtml() + "</div>" +
        '<button class="btn btn-primary btn-lg tx-cta" id="txGo" type="button"' + (overLimit() ? " disabled" : "") + ">Get quote</button>" +
        '<p class="freshline mt-12" style="text-align:center">Your rate will be locked for ' + Data.LOCK_SECS + " seconds.</p>";
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

    if (Q.state === "placed") return orderPanelHtml(Q.booked);

    if (Q.state === "overlimit") {
      // higher limits are an offline conversation, never an in-app order
      return headline("Above your self-serve limit") +
        '<p class="tq-statement">This trade is ' + UI.money("AED", Q.notional) + ". Your limit is " +
          UI.money("AED", Data.LIMIT_AED, { dp: 0 }) + " per trade. Contact your relationship manager to get set up for higher limits.</p>" +
        '<div class="tq-actions"><button class="btn btn-primary" id="tqCancel" type="button">Adjust the amount</button></div>';
    }

    return "";
  }

  // ————— after execute: the order as one object (2026-09-14) —————
  // The state is the title. The figure is the one number that matters now:
  // what is still needed, or what you receive. Under it, the lifecycle as
  // the shared timeline (Initiated · Funded · Completed), then the one
  // action. Nothing is a note; the deposit details are a sheet.

  function orderTimeline(t) {
    var placed = UI.fmtTs(t.stamps.placed || t.ts);
    if (t.state === "failed") {
      return [{ label: "Initiated", state: "done", time: placed }, { label: "Failed", state: "failed" }];
    }
    return [
      { label: "Initiated", state: "done", time: placed },
      { label: t.state === "awaiting" ? "Awaiting funding" : "Funded",
        state: t.state === "awaiting" ? "pending" : "done",
        time: t.stamps.funded ? UI.fmtTs(t.stamps.funded) : "" },
      { label: t.state === "settled" ? "Completed" : "Processing",
        state: t.state === "settled" ? "done" : t.state === "settling" ? "active" : "todo",
        time: t.stamps.settled ? UI.fmtTs(t.stamps.settled) : "" }
    ];
  }

  function fmtClock(secs) {
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), x = secs % 60;
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return pad(h) + ":" + pad(m) + ":" + pad(x);
  }

  function stopFundClock() { if (fundIv) { clearInterval(fundIv); fundIv = null; } }

  // the countdown ticks on its own interval so a re-render never restarts it
  // mid-second, and it stops the moment the order leaves the awaiting state.
  function startFundClock(t) {
    stopFundClock();
    fundIv = setInterval(function () {
      var el = document.getElementById("tqClock");
      if (!el || !Q || Q.state !== "placed" || !Q.booked || Q.booked.state !== "awaiting") { stopFundClock(); return; }
      var left = Data.fundingSecsLeft(t);
      el.textContent = fmtClock(left);
      document.getElementById("tqCount").classList.toggle("low", left <= 300);
      if (left <= 0) stopFundClock();
    }, 1000);
  }

  function orderHero(cur, amt, line) {
    return '<div class="tx-order-need">' +
      '<div class="bal-value" id="tqNeed">' + UI.moneyHero(cur, amt, { dp: cur === "USDT" ? 0 : 2, symbol: true }) + "</div>" +
      (line ? '<p class="tx-order-line">' + line + "</p>" : "") +
      "</div>";
  }

  function orderPanelHtml(t) {
    var rcv = Data.receiveLeg(t);
    var spine = '<div class="tx-order-spine">' + UI.timeline(orderTimeline(t)) + "</div>";
    var ref = '<p class="tx-order-ref">' + UI.esc(t.id) + " · 1 USDT = " + rate4(t.rate) + " " + UI.esc(Data.fiatOf(t.pair)) + "</p>";

    if (t.state === "awaiting") {
      var dp = t.payCur === "USDT" ? 0 : 2;
      return headline("Fund this order.") +
        orderHero(t.payCur, t.needed, "") +
        '<p class="tx-fund-meta">Still needed. Your order is ' + UI.money(t.payCur, t.payAmt, { dp: dp }) +
          ", of which " + UI.money(t.payCur, t.fromBalance || 0, { dp: dp }) + " comes from your balance.</p>" +
        '<div class="tx-count" id="tqCount"><span class="tc-clock" id="tqClock">' + fmtClock(Data.fundingSecsLeft(t)) +
          '</span><span class="tc-lbl">left to fund at this rate</span></div>' +
        spine +
        '<button class="btn btn-primary btn-lg tx-cta" id="tqFundSheet" type="button">' +
          (t.payCur === "USDT" ? "Send USDT" : "Fund by bank transfer") + "</button>" +
        '<div class="tx-under"><button class="link" id="tqDone" type="button">Later</button></div>' + ref;
    }
    if (t.state === "settling") {
      return headline("Funded.") +
        orderHero(rcv.cur, rcv.amt, "Lands in your balance by " + UI.esc(UI.fmtTime(Data.settleEta(t))) + ".") +
        spine +
        '<div class="tq-actions"><button class="btn btn-primary" id="tqDone" type="button">Done</button>' +
          '<button class="btn btn-secondary" id="tqRepeatLast" type="button">Repeat</button></div>' + ref;
    }
    if (t.state === "failed") {
      return headline("Order failed.") +
        '<p class="tq-statement">The funding window ran out. Nothing was taken.</p>' +
        spine +
        '<div class="tq-actions"><button class="btn btn-primary" id="tqRepeatLast" type="button">Trade again</button>' +
          '<button class="btn btn-secondary" id="tqDone" type="button">Done</button></div>' + ref;
    }
    return headline("Completed.") +
      orderHero(rcv.cur, rcv.amt, "In your available balance.") +
      spine +
      '<div class="tq-actions"><button class="btn btn-primary" id="tqDone" type="button">Done</button>' +
        '<button class="btn btn-secondary" id="tqRepeatLast" type="button">Repeat</button></div>' + ref;
  }

  // the funding sheet: the exact shortfall and the copy-ready details for the
  // currency the order is paid in, the order id as the reference. Closes on
  // its own the moment funding lands (webhook), never on a client claim.
  function openFundSheet(t) {
    var cur = t.payCur, needed = t.needed;
    var dp = cur === "USDT" ? 0 : 2;
    // copyRow escapes its value, so the amount is plain text here, not the money markup
    var body = UI.copyRow("Amount", cur + " " + UI.fmtNum(needed, dp), { copy: String(Number(needed.toFixed(dp))) });
    if (cur === "USDT") {
      body += UI.copyRow("Address", Data.USDT_ADDRS.TRC20, { mono: true, copy: Data.USDT_ADDRS.TRC20 }) +
        '<div class="copy-row"><span class="cr-label">Network</span><span class="cr-value">TRC20 · Tron</span></div>';
    } else {
      var v = Data.VIBANS[cur] || Data.VIBANS.AED;
      body += UI.copyRow("IBAN", v.iban, { mono: true, copy: v.copy }) +
        // verbatim: the sending bank checks this string against ours
        UI.copyRow("Account name", Data.ACCOUNT_NAME, { copy: Data.ACCOUNT_NAME }) +
        '<div class="copy-row"><span class="cr-label">Bank</span><span class="cr-value">Zand Bank · Dubai, UAE</span></div>' +
        UI.copyRow("Reference", t.id, { mono: true, copy: t.id });
    }
    body += '<p class="tx-order-line mt-16">Your rate holds for ' + fmtClock(Data.fundingSecsLeft(t)) + " from now.</p>";
    body += '<div class="demo-strip mt-16"><span class="freshline">Demo · the bank or the chain confirms it.</span>' +
      '<button class="db-btn" id="tqSheetFund" type="button">Webhook: funding arrives</button></div>';

    var onData = null;
    var h = UI.drawer("Fund " + t.id, body, {
      width: 480,
      foot: '<button class="btn btn-secondary" id="tqSheetClose" type="button">Close</button>',
      onClose: function () { if (onData) Data.off(onData); onData = null; }
    });
    h.el.querySelector("#tqSheetClose").addEventListener("click", h.close);
    h.el.querySelector("#tqSheetFund").addEventListener("click", function () {
      if (!Data.fundOrder(t.id)) UI.toast("This order is no longer awaiting funding.", "blocked");
    });
    onData = function (scope) {
      if (scope === "trades" && t.state !== "awaiting") h.close();
    };
    Data.on(onData);
  }

  function orderSummary(t) {
    return '<div class="def-group">' +
      '<div class="def-row"><span class="def-label">Order</span><span class="def-value strong">' + UI.esc(t.id) + "</span></div>" +
      '<div class="def-row"><span class="def-label">Side</span><span class="def-value">' + (t.side === "buy" ? "Buy" : "Sell") + " USDT · " + UI.esc(t.pair) + "</span></div>" +
      '<div class="def-row"><span class="def-label">Locked rate</span><span class="def-value strong" id="tqBookedRate">' + rate4(t.rate) + "</span></div>" +
      '<div class="def-row"><span class="def-label">USDT</span><span class="def-value">' + UI.money("USDT", t.assetAmt, { dp: 0 }) + "</span></div>" +
      '<div class="def-row"><span class="def-label">' + UI.esc(Data.fiatOf(t.pair)) + '</span><span class="def-value">' + UI.money(Data.fiatOf(t.pair), t.fiatAmt) + "</span></div>" +
      '<div class="def-row"><span class="def-label">Initiated</span><span class="def-value">' + UI.esc(UI.fmtTs(t.ts)) + "</span></div>" +
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
      // identity capped, spacer takes the surplus, the cluster stays adjacent.
      // Phone roles (m): the purchased leg is the title (its swatch rides
      // inside the cell, as on the dashboard — a separate "lead" track would
      // move every desktop column), the sold leg is the amount, and the rate
      // drops out: it is already the chip between the legs in the details
      // drawer this row opens. The date keeps the full stamp here because
      // trade history has no day group labels to carry it.
      cols: [
        { label: "Purchased", w: "minmax(0, 220px)", m: "title" },
        { spacer: true, m: "hide" },
        { label: "Sold", w: "190px", m: "amount" },
        { label: "Rate", w: "195px", m: "hide" },
        { label: "Status", w: "150px", m: "status" },
        { label: "Date", w: "135px", m: "meta" }
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
      settleFlash(p.querySelector("#tqHead h2"));
      Q.justBooked = false;
    }

    // both cards are typeable: typing in one makes it the entry side and the
    // other side estimates in place. Only the estimate repaints, never the
    // input the client is typing into.
    if (Q.state === "idle") {
      ["buy", "sell"].forEach(function (s) {
        var inp = byId("txAmt-" + s);
        if (!inp) return;
        // grouped digits as you type (UI.amountInput owns the caret)
        UI.amountInput(inp, {
          dp: curOf(s) === "USDT" ? 0 : 2,
          onInput: function (v) {
            Q.entry = s;
            Q.amt = v;
            inp.classList.remove("est");
            var other = byId("txAmt-" + (s === "buy" ? "sell" : "buy"));
            if (other) { other.value = estFor(s === "buy" ? "sell" : "buy"); other.classList.add("est"); }
            var slot = byId("txLimitSlot");
            if (slot) slot.innerHTML = limitNoteHtml();
            var go = byId("txGo");
            if (go) go.disabled = overLimit();
            inp.classList.toggle("over", overLimit());
          }
        });
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") getQuote(); });
      });
    }
    var swap = byId("txSwap");
    if (swap) swap.addEventListener("click", function () {
      if (Q.state !== "idle") return;
      var b = Q.buyCur;
      Q.buyCur = Q.sellCur;
      Q.sellCur = b;
      Q.entry = Q.entry === "buy" ? "sell" : "buy";   // the typed value follows its currency
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
    on("tqFundSheet", function () { if (Q.booked) openFundSheet(Q.booked); });
    stopFundClock();
    if (Q.state === "placed" && Q.booked && Q.booked.state === "awaiting") startFundClock(Q.booked);
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

    // no skeleton on the phone: the trade object is the screen, and 360ms of
    // grey bars where it should be reads as broken. The flag is burned so the
    // desktop path is unchanged.
    if (App.isPhone && App.isPhone()) loadedOnce = true;
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
  }

  App.registerScreen("trade", {
    title: "Trade",
    subtitle: "Buy and sell at a price we hold while you decide",
    zone: "app",
    prefill: function (t) { repeat(t); },
    // dashboard rates row → Trade lands on the pair the client tapped,
    // showing the same reference level they just read
    setPair: function (pair) {
      if (!Q) initQ();
      var f = Data.fiatOf(pair);
      if (Q.state === "idle" && Data.railLive(f)) { Q.buyCur = "USDT"; Q.sellCur = f; }
    },
    // the dashboard's mini trade hands over a pair and a typed amount so the
    // client lands on Trade with their intent intact rather than an empty form
    setDraft: function (fiatCur, amt) {
      if (!Q) initQ();
      if (Q.state !== "idle") return;
      if (Data.railLive(fiatCur)) { Q.buyCur = "USDT"; Q.sellCur = fiatCur; }
      Q.entry = "buy";
      Q.amt = amt || "";
    },
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
