/* ————————————————————————————————————————————————
   Fasset Prime — the introducing broker portal (three screens:
   ib-overview · ib-clients · ib-payouts). Added 2026-09-02, rebuilt
   to the taste brief 2026-09-04.

   What an IB is here: one individual, linked to several Prime clients
   by the desk in Optimus. Their whole world is read-only: the clients
   they introduced, those clients' trades (trade-level, exact notional,
   never balances, funding or wallets — enforced in data.js, the ib*
   reads expose trades only), what that accrues to them, and where it
   is paid (their own verified bank account or the desk-created USDT
   container referral-<name>). PLACEHOLDER MATH: Data.ibAccrual is a
   flat bps of settled notional, share-weighted, until the commercial
   schedule lands.

   The grammar is the dashboard's and Accounts': typeset money hero,
   an open stat strip, no-lines tables where every row is a tap target,
   and ONE details drawer per object (a client trade, a client, a
   payout period, the payout account). Reasons, timelines and actions
   live in drawers; nothing expands in place; the product never
   narrates its own boundary, economics or process.

   Nothing here mutates client state. The only mutations are the
   payout-account switch (step-up gated) and the demo strip's
   webhook/desk mirrors (a client trade settling, the desk running a
   payout) — the IB side asserts nothing.

   Colour budget per screen: client identity art (hashed, the safe
   four) and the currency code money already carries. No saturated
   fill anywhere in the portal. Status dots stay --st-*.

   Phone pass (2026-09-04): the three portal tables declare UI.table
   column roles, so at 600px each row folds to two lines instead of
   scrolling sideways. What drops out is only ever a fact the row's own
   drawer already carries: a client's introduced date (client drawer) and
   a period's volume (payout drawer). The skeleton is a desktop pass.

   States inventory: loading (one skeleton pass per screen per app
   load) · live · empty tables (one quiet sentence) · onboarding client
   (no trades yet) · dormant client · accruing / scheduled / paid
   periods · failed trade (drawer timeline). Role/permission states
   don't exist: the IB is one person.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loaded = { overview: false, clients: false, payouts: false };
  var sig = {};

  // ————— shared helpers —————

  function ccy(cur, opts) { return UI.ccy ? UI.ccy(cur, opts) : UI.esc(cur); }

  function phone() { return !!(App.isPhone && App.isPhone()); }

  // A right-aligned figure used to get its alignment from being the grid
  // item itself. Once a table declares phone column roles, UI.table wraps
  // every cell in a .m-cell span, so the figure has to be the block that
  // aligns its own text. display:block is what it already computed to as a
  // grid item, so the desktop is unchanged either way.
  function amt(cls, html) {
    return '<span class="' + cls + '" style="display:block">' + html + "</span>";
  }

  function drow(label, valueHtml, strong) {
    return '<div class="def-row"><span class="def-label">' + UI.esc(label) +
      '</span><span class="def-value' + (strong ? " strong" : "") + '">' + valueHtml + "</span></div>";
  }

  function stack(nameHtml, descHtml) {
    return '<span class="ib-stack"><span class="name">' + nameHtml + "</span>" +
      (descHtml ? '<span class="desc">' + descHtml + "</span>" : "") + "</span>";
  }

  // the locked labels, and nothing under them
  function clientStatus(c) {
    if (c.status === "onboarding") return UI.statusDot("info", "Onboarding");
    if (c.status === "dormant") return UI.statusDot("neutral", "Dormant");
    return UI.statusDot("positive", "Active");
  }

  function tradeStatus(t) {
    if (t.state === "settled") return UI.statusDot("positive", "Completed");
    if (t.state === "failed") return UI.statusDot("error", "Failed");
    if (t.state === "settling") return UI.statusDot("info", "Processing");
    return UI.statusDot("warning", "Awaiting funding");
  }

  function periodStatus(state) {
    if (state === "paid") return UI.statusDot("positive", "Paid");
    if (state === "scheduled") return UI.statusDot("warning", "Scheduled");
    return UI.statusDot("info", "Accruing");
  }

  function tradeTitle(t) {
    return (t.side === "buy" ? "Buy " : "Sell ") + Number(t.assetAmt).toLocaleString("en-US") +
      " USDT at " + Number(t.rate).toFixed(4);
  }

  function clientOf(id) { return Data.ibClient(id); }
  function clientName(id) { var c = clientOf(id); return c ? c.name : "Linked client"; }

  function refLink() { return "prime.fasset.com/signup?ib=" + Data.state.ib.refCode; }

  function rateLabel() { return (Data.state.ib.rateBps / 100).toFixed(2) + "%"; }

  function usdtMethod() { return Data.state.ib.payoutMethod === "usdt"; }

  function ibanTail(iban) { return "····" + String(iban).replace(/\s/g, "").slice(-3); }

  function destLabel() {
    var ib = Data.state.ib;
    return usdtMethod() ? ib.payoutWallet.label : ib.payoutBank.bank + " " + ibanTail(ib.payoutBank.iban);
  }

  function lastPaid() {
    var paid = Data.state.ib.payouts.filter(function (p) { return p.state === "paid"; });
    paid.sort(function (a, b) { return new Date(b.paidTs) - new Date(a.paidTs); });
    return paid[0] || null;
  }

  function findTrade(cid, tid) {
    return Data.ibTrades(cid).filter(function (t) { return t.id === tid; })[0] || null;
  }

  function tradeKey(t) { return "t:" + t.clientId + ":" + t.id; }

  function repaint(id, html, key) {
    var node = document.getElementById(id);
    if (!node || sig[key] === html) return;
    sig[key] = html;
    UI.repaint(node, html);
  }

  // ————— drawers: one per object, live while open —————
  // Every drawer repaints itself on the scopes this portal listens to, so
  // a client trade settling while its drawer is open lands in the drawer
  // too. Rows inside a drawer body (a client's trades) open their own.

  function liveDrawer(title, opts, bodyFn) {
    var refresh;
    var h = UI.drawer(title, "", {
      width: opts.width || 460,
      subtitle: opts.subtitle,
      onClose: function () { Data.off(refresh); },
      foot: (opts.foot || "") + '<button class="btn btn-secondary" data-ibd-close type="button">Close</button>'
    });
    function paint() {
      var html = bodyFn();
      if (html === null) { h.close(); return; }
      h.body.innerHTML = html;
    }
    refresh = function (scope) { if (scope === "ib" || scope === "trades") paint(); };
    Data.on(refresh);
    paint();
    h.el.querySelector("[data-ibd-close]").addEventListener("click", h.close);
    h.body.addEventListener("click", function (e) {
      var r = e.target.closest && e.target.closest(".row.clickable");
      if (r) openKey(r.getAttribute("data-key"));
    });
    return h;
  }

  // — a client's trade: the shared trade-details grammar (def-group, legs
  //   card with the rate chip, Initiated · Funded · Completed) —

  function tradeTimeline(t) {
    if (t.state === "failed") {
      return [
        { label: "Initiated", state: "done", time: UI.fmtTs(t.ts) },
        { label: "Failed", state: "failed" }
      ];
    }
    return [
      { label: "Initiated", state: "done", time: UI.fmtTs(t.ts) },
      { label: t.state === "awaiting" ? "Awaiting funding" : "Funded",
        state: t.state === "awaiting" ? "pending" : "done" },
      { label: t.state === "settled" ? "Completed" : "Processing",
        state: t.state === "settled" ? "done" : t.state === "settling" ? "active" : "todo" }
    ];
  }

  function tradeBody(t) {
    var f = Data.fiatOf(t.pair);
    var buyU = t.side === "buy";
    return '<div class="def-group">' +
        drow("Client", UI.esc(clientName(t.clientId)), true) +
        drow("Trade", UI.esc(t.id)) +
        drow("Status", tradeStatus(t)) +
      "</div>" +
      '<div class="txd-legs">' +
        '<div class="txd-leg"><span class="txd-what"><span class="tx-label">Purchased</span><span class="txd-cur">' + ccy(buyU ? "USDT" : f) + "</span></span>" +
          '<span class="txd-amt">' + (buyU ? UI.money("USDT", t.assetAmt, { dp: 0 }) : UI.money(f, t.fiatAmt)) + "</span></div>" +
        '<span class="txd-pill">1 USDT = ' + Number(t.rate).toFixed(4) + " " + UI.esc(f) + "</span>" +
        '<div class="txd-leg"><span class="txd-what"><span class="tx-label">Sold</span><span class="txd-cur">' + ccy(buyU ? f : "USDT") + "</span></span>" +
          '<span class="txd-amt">' + (buyU ? UI.money(f, t.fiatAmt) : UI.money("USDT", t.assetAmt, { dp: 0 })) + "</span></div>" +
      "</div>" +
      '<div class="mt-16">' + UI.timeline(tradeTimeline(t)) + "</div>";
  }

  function openTrade(cid, tid) {
    if (!findTrade(cid, tid)) return;
    liveDrawer("Trade details", { width: 460 }, function () {
      var t = findTrade(cid, tid);
      return t ? tradeBody(t) : null;
    });
  }

  // — a client: the facts, then their trades —

  function clientTradesTable(cid) {
    var rows = [], day = null;
    Data.ibTrades(cid).slice(0, 12).forEach(function (t) {
      var lbl = UI.dayLabel(t.ts);
      if (lbl !== day) { day = lbl; rows.push({ group: day }); }
      rows.push({
        key: tradeKey(t),
        clickable: true,
        cells: [
          stack(UI.esc(tradeTitle(t)), UI.esc(UI.fmtTs(t.ts))),
          tradeStatus(t),
          '<span class="amount">' + UI.money(Data.fiatOf(t.pair), t.fiatAmt) + "</span>"
        ]
      });
    });
    return UI.table({
      cols: [
        { label: "Trade", w: "minmax(0, 1fr)" },
        { label: "Status", w: "150px" },
        { label: "Notional", w: "150px", right: true }
      ],
      rows: rows,
      empty: "No trades yet."
    });
  }

  function clientBody(cid) {
    var c = clientOf(cid);
    if (!c) return null;
    var vol = Data.ibMonthVolume(cid);
    var share = Data.ibShare(cid);
    return '<div class="def-group">' +
        drow("Status", clientStatus(c)) +
        drow("Introduced", UI.esc(UI.fmtDate(c.introduced))) +
        (share < 1 ? drow("Share", Math.round(share * 100) + "%") : "") +
        drow("Trades this period", String(Data.ibMonthTrades(cid))) +
        drow("Volume this period", vol ? UI.money("AED", vol, { dp: 0 }) : "—") +
        drow("Accrued this period", vol ? UI.money("AED", Data.ibAccrual(cid)) : "—", true) +
      "</div>" +
      '<div class="section-head mt-24"><h2>Activity</h2></div>' +
      clientTradesTable(cid);
  }

  function openClient(cid) {
    var c = clientOf(cid);
    if (!c) return;
    liveDrawer(c.name, { width: 560, subtitle: c.type }, function () { return clientBody(cid); });
  }

  // — a payout period: the facts, then Accruing · Scheduled · Paid —

  function periodRec(key) {
    if (key === "current") {
      return { period: Data.ibPeriodLabel(), state: "accruing", volumeAED: Data.ibMonthVolume(),
        amountAED: Data.ibAccrual(), paidTs: null };
    }
    return Data.state.ib.payouts.filter(function (p) { return p.period === key; })[0] || null;
  }

  function periodTimeline(p) {
    var paid = p.state === "paid", sched = p.state === "scheduled";
    return [
      { label: "Accruing", state: p.state === "accruing" ? "active" : "done" },
      { label: "Scheduled", state: sched ? "pending" : paid ? "done" : "todo" },
      { label: "Paid", state: paid ? "done" : "todo", time: paid ? UI.fmtTs(p.paidTs) : "" }
    ];
  }

  function periodBody(key) {
    var p = periodRec(key);
    if (!p) return null;
    var has = p.volumeAED > 0;
    return '<div class="def-group">' +
        drow("Period", UI.esc(p.period), true) +
        drow("Status", periodStatus(p.state)) +
        drow("Volume", has ? UI.money("AED", p.volumeAED, { dp: 0 }) : "—") +
        drow("Payout", has ? UI.money("AED", p.amountAED) : "—", true) +
      "</div>" +
      '<div class="mt-16">' + UI.timeline(periodTimeline(p)) + "</div>";
  }

  function openPeriod(key) {
    if (!periodRec(key)) return;
    liveDrawer("Payout details", { width: 460 }, function () { return periodBody(key); });
  }

  // — the payout account: where the money lands, and the switch. AED to
  //   their own bank account, or USDT to the desk-created container
  //   referral-<name>. Switching changes where money goes: step-up. —

  function accountBody() {
    var ib = Data.state.ib;
    if (usdtMethod()) {
      return '<div class="def-group">' +
        drow("Status", UI.statusDot("positive", "Approved")) +
        drow("Wallet", UI.esc(ib.payoutWallet.label), true) +
        drow("Network", UI.esc(ib.payoutWallet.net)) +
        drow("Currency", ccy("USDT")) +
        "</div>";
    }
    return '<div class="def-group">' +
      drow("Status", UI.statusDot("positive", "Approved")) +
      drow("Bank", UI.esc(ib.payoutBank.bank), true) +
      drow("IBAN", '<span class="mono ib-mono">' + UI.esc(ib.payoutBank.iban) + "</span>") +
      drow("Account name", UI.esc(ib.payoutBank.title)) +
      drow("Currency", ccy("AED")) +
      "</div>";
  }

  function openAccount() {
    var refresh;
    var h = UI.drawer("Payout account", "", {
      width: 460,
      onClose: function () { Data.off(refresh); }
    });
    function paint() {
      var ib = Data.state.ib, usdt = usdtMethod();
      h.body.innerHTML = accountBody();
      h.setFoot(
        '<button class="btn btn-secondary" id="ibAcSwitch" type="button">' +
          (usdt ? "Use bank account" : "Use USDT wallet") + "</button>" +
        '<button class="btn btn-secondary" id="ibAcClose" type="button">Close</button>');
      h.foot.querySelector("#ibAcClose").addEventListener("click", h.close);
      h.foot.querySelector("#ibAcSwitch").addEventListener("click", function () {
        var to = usdt ? "bank" : "usdt";
        var dest = to === "usdt" ? ib.payoutWallet.label : ib.payoutBank.bank + " " + ibanTail(ib.payoutBank.iban);
        UI.stepUp("Payouts move to " + dest + ".", function () { Data.ibSetPayoutMethod(to); });
      });
    }
    refresh = function (scope) { if (scope === "ib") paint(); };
    Data.on(refresh);
    paint();
  }

  // row keys: "t:<clientId>:<tradeId>" · "c:<clientId>" · "p:<period>|current"
  function openKey(key) {
    if (!key) return;
    var i = key.indexOf(":");
    var kind = key.slice(0, i), rest = key.slice(i + 1);
    if (kind === "t") {
      var j = rest.indexOf(":");
      openTrade(rest.slice(0, j), rest.slice(j + 1));
    } else if (kind === "c") {
      openClient(rest);
    } else if (kind === "p") {
      openPeriod(rest);
    }
  }

  // ————— ib-overview —————

  function tile(go, label, valueHtml, sub) {
    return '<button class="stat-strip-cell" data-go="' + go + '" type="button">' +
      '<div class="tile-label">' + UI.esc(label) + "</div>" +
      '<div class="tile-value">' + valueHtml + "</div>" +
      (sub ? '<div class="tile-sub">' + UI.esc(sub) + "</div>" : "") +
      "</button>";
  }

  function ovStrip() {
    var cs = Data.state.ib.clients;
    var active = cs.filter(function (c) { return c.status === "active"; }).length;
    var onb = cs.filter(function (c) { return c.status === "onboarding"; }).length;
    var dorm = cs.length - active - onb;
    var subs = [];
    if (active) subs.push(active + " active");
    if (onb) subs.push(onb + " onboarding");
    if (dorm) subs.push(dorm + " dormant");
    var lp = lastPaid();
    return tile("ib-clients", "Clients", UI.digits(null, String(cs.length)), subs.join(" · ")) +
      tile("ib-clients", "Volume this period", UI.moneyHero("AED", Data.ibMonthVolume(), { dp: 0 }), "") +
      tile("ib-clients", "Trades this period", UI.digits(null, String(Data.ibMonthTrades())), "") +
      tile("ib-payouts", "Last payout",
        lp ? UI.moneyHero("AED", lp.amountAED, { dp: 0 }) : '<span class="faint">—</span>',
        lp ? lp.period + " · " + UI.fmtDate(lp.paidTs) : "");
  }

  function ovTable() {
    var rows = [], day = null;
    Data.ibTrades().slice(0, 30).forEach(function (t) {
      var lbl = UI.dayLabel(t.ts);
      if (lbl !== day) { day = lbl; rows.push({ group: day }); }
      rows.push({
        key: tradeKey(t),
        clickable: true,
        cells: [
          '<span class="cell-main">' + UI.identityArt(clientName(t.clientId), 20) + "</span>",
          '<span class="cell-main">' + stack(UI.esc(clientName(t.clientId)), UI.esc(tradeTitle(t))) + "</span>",
          tradeStatus(t),
          '<span class="date">' + UI.esc(UI.fmtTs(t.ts)) + "</span>",
          amt("amount", UI.money(Data.fiatOf(t.pair), t.fiatAmt))
        ]
      });
    });
    // the identity art takes its own 30px track (20px art + the 10px gap
    // .cell-main used to give it), so it can be the phone row's `lead`
    // while the desktop column adds up to the same 320px it always did.
    return UI.table({
      cols: [
        { label: "Client", w: "30px", m: "lead" },
        { label: "", w: "minmax(0, 290px)", m: "title" },
        { spacer: true, m: "hide" },
        { label: "Status", w: "160px", m: "status" },
        { label: "Date", w: "105px", m: "meta" },
        { label: "Notional", w: "170px", right: true, m: "amount" }
      ],
      rows: rows,
      empty: "No client activity yet."
    });
  }

  function ovRender(el) {
    wire(el);
    // the skeleton is a desktop pass; on the phone it reads as a delay
    if (!loaded.overview && !phone()) {
      var body = document.createElement("div");
      body.innerHTML = '<div class="section">' +
        "<div>" + UI.skel("200px", "12px") + "</div>" +
        '<div class="mt-12">' + UI.skel("280px", "44px") + "</div>" +
        '<div class="mt-24 flex" style="gap:32px">' + UI.skel("180px", "56px") + UI.skel("180px", "56px") + UI.skel("180px", "56px") + UI.skel("180px", "56px") + "</div>" +
        '<div class="mt-32">' + UI.skel("100%", "56px") + "</div>" +
        '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
        "</div>";
      el.appendChild(body);
      setTimeout(function () {
        loaded.overview = true;
        if (document.body.contains(el)) { body.remove(); ovBody(el); }
      }, 380);
      return;
    }
    ovBody(el);
  }

  function ovBody(el) {
    var accr = Data.ibAccrual();
    var h = "";

    // the hero: what this period has accrued, typeset. No pill, no freshline.
    h += '<div class="section"><div class="bal-hero"><div>' +
      '<div class="bal-label">Accrued · ' + UI.esc(Data.ibPeriodLabel()) + "</div>" +
      '<div class="bal-value" id="ibOvVal">' + UI.moneyHero("AED", accr) + "</div>" +
      "</div></div></div>";

    h += '<div class="section"><div class="stat-strip ib-strip" id="ibOvStrip">' + ovStrip() + "</div></div>";

    h += '<div class="section"><div class="section-head"><h2>Activity</h2></div>' +
      '<div id="ibOvActs">' + ovTable() + "</div></div>";

    h += '<div class="section"><div class="demo-strip">' +
      '<span class="freshline">Demo · a client trade settling in Optimus, mirrored here.</span>' +
      '<button class="db-btn" id="ibOvSim" type="button">A client’s trade settles</button>' +
      "</div></div>";

    el.insertAdjacentHTML("beforeend", h);
    sig.ovVal = String(accr);
    sig.ovStrip = ovStrip();
    sig.ovActs = ovTable();
  }

  function ovPatch() {
    if (!document.getElementById("ibOvVal")) return false;
    var accr = Data.ibAccrual();
    if (sig.ovVal !== String(accr)) {
      sig.ovVal = String(accr);
      UI.repaint(document.getElementById("ibOvVal"), UI.moneyHero("AED", accr));
    }
    repaint("ibOvStrip", ovStrip(), "ovStrip");
    repaint("ibOvActs", ovTable(), "ovActs");
    return true;
  }

  // ————— ib-clients —————

  function clTable() {
    return UI.table({
      // Introduced drops out on the phone; it is the client drawer's second
      // def-row, so the fact is one tap away.
      cols: [
        { label: "Client", w: "30px", m: "lead" },
        { label: "", w: "minmax(0, 1fr)", m: "title" },
        { label: "Status", w: "150px", m: "status" },
        { label: "Introduced", w: "110px", m: "hide" },
        { label: "Trades this period", w: "135px", right: true, m: "meta" },
        { label: "Volume this period", w: "180px", right: true, m: "amount" }
      ],
      rows: Data.state.ib.clients.map(function (c, i) {
        var vol = Data.ibMonthVolume(c.id);
        return {
          key: "c:" + c.id,
          clickable: true,
          cells: [
            '<span class="cell-main">' + UI.identityArt(c.name, 20, i * 30) + "</span>",
            '<span class="cell-main">' + stack(UI.esc(c.name), UI.esc(c.type)) + "</span>",
            clientStatus(c),
            '<span class="date">' + UI.esc(UI.fmtDate(c.introduced)) + "</span>",
            amt("amount", String(Data.ibMonthTrades(c.id))),
            amt("amount" + (vol ? "" : " pending"), vol ? UI.money("AED", vol, { dp: 0 }) : "—")
          ]
        };
      }),
      empty: "No clients yet."
    });
  }

  function clRender(el) {
    wire(el);
    if (!loaded.clients && !phone()) {
      var body = document.createElement("div");
      body.innerHTML = '<div class="section">' +
        "<div>" + UI.skel("100%", "56px") + "</div>" +
        '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
        '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
        '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
        "</div>";
      el.appendChild(body);
      setTimeout(function () {
        loaded.clients = true;
        if (document.body.contains(el)) { body.remove(); clBody(el); }
      }, 320);
      return;
    }
    clBody(el);
  }

  function clBody(el) {
    el.insertAdjacentHTML("beforeend", '<div class="section" id="ibClTbl">' + clTable() + "</div>");
    sig.clTbl = clTable();
  }

  function clPatch() {
    if (!document.getElementById("ibClTbl")) return false;
    repaint("ibClTbl", clTable(), "clTbl");
    return true;
  }

  // ————— ib-payouts —————

  // three facts: rate, frequency, account. Nothing under them.
  function poTerms() {
    return drow("Rate", UI.esc(rateLabel())) +
      drow("Frequency", "Monthly") +
      drow("Account", UI.esc(destLabel()));
  }

  function poPeriods() {
    var vol = Data.ibMonthVolume();
    var rows = [{
      key: "p:current",
      clickable: true,
      cells: [
        '<span class="name">' + UI.esc(Data.ibPeriodLabel()) + "</span>",
        periodStatus("accruing"),
        '<span class="date">—</span>',
        amt("amount pending", vol ? UI.money("AED", vol, { dp: 0 }) : "—"),
        amt("amount pending", vol ? UI.money("AED", Data.ibAccrual()) : "—")
      ]
    }];
    Data.state.ib.payouts.forEach(function (p) {
      rows.push({
        key: "p:" + p.period,
        clickable: true,
        cells: [
          '<span class="name">' + UI.esc(p.period) + "</span>",
          periodStatus(p.state),
          '<span class="date">' + (p.state === "paid" ? UI.esc(UI.fmtDate(p.paidTs)) : "—") + "</span>",
          amt("amount", UI.money("AED", p.volumeAED, { dp: 0 })),
          amt("amount" + (p.state === "paid" ? " positive" : ""), UI.money("AED", p.amountAED))
        ]
      });
    });
    // Volume drops out on the phone; it is the payout drawer's third
    // def-row, so the fact is one tap away.
    return UI.table({
      cols: [
        { label: "Period", w: "minmax(0, 1fr)", m: "title" },
        { label: "Status", w: "140px", m: "status" },
        { label: "Date", w: "110px", m: "meta" },
        { label: "Volume", w: "170px", right: true, m: "hide" },
        { label: "Payout", w: "150px", right: true, m: "amount" }
      ],
      rows: rows,
      empty: "Nothing yet."
    });
  }

  function poRender(el) {
    wire(el);
    if (!loaded.payouts && !phone()) {
      var body = document.createElement("div");
      body.innerHTML = '<div class="section">' +
        "<div>" + UI.skel("160px", "16px") + "</div>" +
        '<div class="mt-16">' + UI.skel("420px", "14px") + "</div>" +
        '<div class="mt-8">' + UI.skel("420px", "14px") + "</div>" +
        '<div class="mt-8">' + UI.skel("420px", "14px") + "</div>" +
        '<div class="mt-32">' + UI.skel("100%", "56px") + "</div>" +
        '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
        "</div>";
      el.appendChild(body);
      setTimeout(function () {
        loaded.payouts = true;
        if (document.body.contains(el)) { body.remove(); poBody(el); }
      }, 320);
      return;
    }
    poBody(el);
  }

  function poBody(el) {
    var h = "";

    h += '<div class="section"><div class="section-head"><h2>How you’re paid</h2>' +
      '<button class="link" id="ibPoAcct" type="button">Payout account' + icon("arrowRight", 12) + "</button></div>" +
      '<div class="def-group ib-terms" id="ibPoTerms">' + poTerms() + "</div></div>";

    h += '<div class="section"><div class="section-head"><h2>Periods</h2></div>' +
      '<div id="ibPoTbl">' + poPeriods() + "</div></div>";

    h += '<div class="section"><div class="demo-strip">' +
      '<span class="freshline">Demo · the Optimus side. The accrual math is a placeholder.</span>' +
      '<button class="db-btn" id="ibPoSim" type="button">A client’s trade settles</button>' +
      '<button class="db-btn" id="ibPoRun" type="button">Desk runs the scheduled payout</button>' +
      "</div></div>";

    el.insertAdjacentHTML("beforeend", h);
    sig.poTerms = poTerms();
    sig.poTbl = poPeriods();
  }

  function poPatch() {
    if (!document.getElementById("ibPoTbl")) return false;
    repaint("ibPoTerms", poTerms(), "poTerms");
    repaint("ibPoTbl", poPeriods(), "poTbl");
    return true;
  }

  // ————— wiring: one delegated listener per screen root —————
  // The root is rebuilt on a full render and survives every in-place
  // patch, so nothing here is ever bound twice or missed.

  function wire(el) {
    if (!el || el.__ibWired) return;
    el.__ibWired = true;
    el.addEventListener("click", function (e) {
      var t = e.target;
      if (!t.closest) return;
      var go = t.closest("[data-go]");
      if (go) { App.go(go.getAttribute("data-go")); return; }
      var r = t.closest(".row.clickable");
      if (r) { openKey(r.getAttribute("data-key")); return; }
      var b = t.closest("button");
      if (!b) return;
      if (b.id === "ibOvSim" || b.id === "ibPoSim") Data.ibSimClientTrade();
      else if (b.id === "ibPoRun") { if (!Data.ibRunPayout()) UI.toast("No payout is scheduled.", "blocked"); }
      else if (b.id === "ibPoAcct") openAccount();
    });
  }

  // ————— registry —————
  // Every mutation the IB cares about lands as scope "ib" or (for Delos,
  // whose rows come live from the client ledger) "trades". Everything else
  // in the app — deposits, withdrawals, whitelist, team — is another
  // persona's world and is claimed as handled so it can never replay this
  // portal's page entrance.

  function onDataFor(patch) {
    return function (scope) {
      if (scope === "prefs" || scope === "all") return false;
      if (scope === "ib" || scope === "trades") return patch();
      return true;
    };
  }

  App.registerScreen("ib-overview", {
    title: "Overview",
    zone: "app",
    render: ovRender,
    onData: onDataFor(ovPatch)
  });

  App.registerScreen("ib-clients", {
    title: "Clients",
    // the one action on this screen; the delegated [data-copy] handler in
    // ui.js copies and toasts, so it needs no wiring here
    actions: function () {
      return '<button class="btn btn-primary" type="button" data-copy="https://' + UI.esc(refLink()) + '">Copy referral link</button>';
    },
    zone: "app",
    render: clRender,
    onData: onDataFor(clPatch)
  });

  App.registerScreen("ib-payouts", {
    title: "Payouts",
    zone: "app",
    render: poRender,
    onData: onDataFor(poPatch)
  });
})();
