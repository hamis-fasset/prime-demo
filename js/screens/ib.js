/* ————————————————————————————————————————————————
   Fasset Prime — the introducing broker portal (three screens:
   ib-overview · ib-clients · ib-payouts). Added 2026-09-02.

   What an IB is here: one individual, linked to several Prime clients
   by the desk in Optimus (referral code at signup, confirmed at
   review). Their whole world is read-only:
   · the clients they introduced, with status and this period's volume
   · those clients' trading activity — trade-level, exact notional —
     and NEVER balances, funding activity or wallet addresses. That
     boundary is enforced in data.js: the ib* reads expose trades only.
   · what that trading accrues to them, and where it's paid. Payouts
     go only to the IB's own verified account. PLACEHOLDER MATH:
     Data.ibAccrual is a flat bps of settled notional until the
     commercial schedule is decided.

   Nothing in this portal mutates client state. The only mutations the
   demo affordances call are webhook/desk mirrors (a client's trade
   settling, the desk running a payout) — the IB side asserts nothing.

   Colour budget per screen: identity = client identity art (hashed,
   the safe four) plus the currency code UI.money already carries.
   No swatches needed, no saturated fill anywhere in the portal.
   Status dots stay --st-*.

   States inventory: loading (one skeleton pass per screen per app
   load) · live · empty tables (one quiet sentence) · onboarding
   client (no trades yet, status carries why) · dormant client ·
   scheduled vs paid payouts. Role/permission states don't exist
   here: the IB is one person.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loaded = { overview: false, clients: false, payouts: false };
  var sig = {};

  // ————— shared helpers —————

  function clientStatus(c) {
    if (c.status === "onboarding") return UI.statusDot("info", "Onboarding · with compliance review");
    if (c.status === "dormant") return UI.statusDot("neutral", "Dormant · no trades in 60 days");
    return UI.statusDot("positive", "Active");
  }

  function tradeStatus(t) {
    if (t.state === "settled") return UI.statusDot("positive", "Settled");
    if (t.state === "settling") return UI.statusDot("info", "Settling");
    return UI.statusDot("warning", "Awaiting funding");
  }

  function tradeTitle(t) {
    return (t.side === "buy" ? "Buy " : "Sell ") + Number(t.assetAmt).toLocaleString("en-US") +
      " USDT at " + t.rate.toFixed(4);
  }

  function clientOf(id) { return Data.ibClient(id); }

  function refLink() { return "prime.fasset.com/signup?ib=" + Data.state.ib.refCode; }

  function lastPaid() {
    var paid = Data.state.ib.payouts.filter(function (p) { return p.state === "paid"; });
    paid.sort(function (a, b) { return new Date(b.paidTs) - new Date(a.paidTs); });
    return paid[0] || null;
  }

  function repaint(id, html, key) {
    var node = document.getElementById(id);
    if (!node || sig[key] === html) return;
    sig[key] = html;
    UI.repaint(node, html);
  }

  // ————— ib-overview —————

  function ovDelta() {
    return UI.statusDot("positive", "live · accrues as client trades settle") +
      " · paid monthly";
  }

  function ovStrip() {
    var cs = Data.state.ib.clients;
    var active = cs.filter(function (c) { return c.status === "active"; }).length;
    var onb = cs.filter(function (c) { return c.status === "onboarding"; }).length;
    var lp = lastPaid();
    var subs = [];
    if (active) subs.push(active + " active");
    if (onb) subs.push(onb + " onboarding");
    if (cs.length - active - onb) subs.push((cs.length - active - onb) + " dormant");
    return '<button class="stat-strip-cell" data-go="ib-clients" type="button">' +
        '<div class="tile-label">Clients</div>' +
        '<div class="tile-value">' + UI.digits(null, String(cs.length)) + "</div>" +
        '<div class="tile-sub">' + subs.join(" · ") + "</div></button>" +
      '<button class="stat-strip-cell" data-go="ib-clients" type="button">' +
        '<div class="tile-label">Volume this period</div>' +
        '<div class="tile-value">' + UI.moneyHero("AED", Data.ibMonthVolume(), { dp: 0 }) + "</div>" +
        '<div class="tile-sub">settled notional at reference</div></button>' +
      '<button class="stat-strip-cell" data-go="ib-clients" type="button">' +
        '<div class="tile-label">Trades this period</div>' +
        '<div class="tile-value">' + UI.digits(null, String(Data.ibMonthTrades())) + "</div>" +
        '<div class="tile-sub">across all linked clients</div></button>' +
      '<button class="stat-strip-cell" data-go="ib-payouts" type="button">' +
        '<div class="tile-label">Last payout</div>' +
        (lp
          ? '<div class="tile-value">' + UI.moneyHero("AED", lp.amountAED, { dp: 0 }) + "</div>" +
            '<div class="tile-sub">' + UI.esc(lp.period) + " · paid " + UI.esc(UI.fmtDate(lp.paidTs)) + "</div>"
          : '<div class="tile-value faint">—</div><div class="tile-sub">your first payout lands after this period closes</div>') +
        "</button>";
  }

  function ovTable() {
    var rows = [], day = null;
    Data.ibTrades().slice(0, 6).forEach(function (t) {
      var c = clientOf(t.clientId);
      var lbl = UI.dayLabel(t.ts);
      if (lbl !== day) { day = lbl; rows.push({ group: day }); }
      rows.push({
        key: t.clientId + ":" + t.id,
        clickable: true,
        cls: "ib-row",
        cells: [
          '<span class="cell-main" data-client="' + UI.esc(t.clientId) + '">' + UI.identityArt(c ? c.name : t.clientId, 20) +
            '<span class="cell-stack"><span class="name">' + UI.esc(c ? c.name : "Linked client") + "</span>" +
            '<span class="desc">' + UI.esc(tradeTitle(t)) + "</span></span></span>",
          tradeStatus(t),
          '<span class="date">' + UI.esc(UI.fmtTs(t.ts)) + "</span>",
          '<span class="amount">' + UI.money(Data.fiatOf(t.pair), t.fiatAmt) + "</span>"
        ]
      });
    });
    return UI.table({
      cols: [
        { label: "Client · trade", w: "minmax(0, 320px)" },
        { spacer: true },
        { label: "Status", w: "160px" },
        { label: "Date", w: "105px" },
        { label: "Notional", w: "170px", right: true }
      ],
      rows: rows,
      empty: "No client activity yet."
    });
  }

  function ovRender(el) {
    if (!loaded.overview) {
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

    h += '<div class="section"><div class="bal-hero"><div>' +
      '<div class="bal-label">Accrued this period · ' + UI.esc(Data.ibPeriodLabel()) + "</div>" +
      '<div class="bal-value" id="ibOvVal">' + UI.moneyHero("AED", accr) + "</div>" +
      '<div class="bal-delta" id="ibOvDelta">' + ovDelta() + "</div>" +
      "</div></div></div>";

    h += '<div class="section"><div class="section-head"><h2>Your book</h2>' +
      '<span class="link">linked by the desk at onboarding</span></div>' +
      '<div class="stat-strip" id="ibOvStrip">' + ovStrip() + "</div></div>";

    h += '<div class="section"><div class="section-head"><h2>Client activity</h2>' +
      '<button class="link" data-go="ib-clients" type="button">All clients' + icon("arrowRight", 12) + "</button></div>" +
      '<div id="ibOvActs">' + ovTable() + "</div>" +
      '<p class="freshline mt-8">Trading activity only. Balances, funding and wallets are never shown.</p></div>';

    h += '<div class="section"><div class="demo-strip">' +
      '<span class="freshline">Demo · a client trade settling in Optimus, mirrored here.</span>' +
      '<button class="db-btn" id="ibOvSim" type="button">A client’s trade settles</button>' +
      "</div></div>";

    el.insertAdjacentHTML("beforeend", h);
    sig.ovVal = String(accr);
    sig.ovStrip = ovStrip();
    sig.ovActs = ovTable();
    wire(el);
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
    var host = document.getElementById("screenHost");
    if (host) { wire(host); requestAnimationFrame(function () { wire(document.getElementById("screenHost")); }); }
    return true;
  }

  // ————— ib-clients —————

  function clTable() {
    return UI.table({
      cols: [
        { label: "Client", w: "minmax(0, 1fr)" },
        { label: "Status", w: "260px" },
        { label: "Introduced", w: "110px" },
        { label: "Trades this period", w: "135px", right: true },
        { label: "Volume this period", w: "180px", right: true }
      ],
      rows: Data.state.ib.clients.map(function (c, i) {
        var vol = Data.ibMonthVolume(c.id);
        // a shared introduction says so here and in the drawer; the split
        // itself is configured desk-side in Optimus
        var share = Data.ibShare(c.id);
        var descTxt = c.type + (share < 1 ? " · shared · your " + Math.round(share * 100) + "%" : "");
        return {
          key: c.id,
          clickable: true,
          cells: [
            '<span class="cell-main" data-client="' + UI.esc(c.id) + '">' + UI.identityArt(c.name, 20, i * 30) +
              '<span class="cell-stack"><span class="name">' + UI.esc(c.name) + "</span>" +
              '<span class="desc">' + UI.esc(descTxt) + "</span></span></span>",
            clientStatus(c),
            '<span class="date">' + UI.esc(UI.fmtDate(c.introduced)) + "</span>",
            '<span class="date">' + Data.ibMonthTrades(c.id) + "</span>",
            '<span class="amount' + (vol ? "" : " pending") + '">' + (vol ? UI.money("AED", vol, { dp: 0 }) : "—") + "</span>"
          ]
        };
      }),
      empty: "No clients yet."
    });
  }

  function openClient(cid) {
    var c = clientOf(cid);
    if (!c) return;
    var trades = Data.ibTrades(cid).slice(0, 8);
    var vol = Data.ibMonthVolume(cid);
    var rows = [], day = null;
    trades.forEach(function (t) {
      var lbl = UI.dayLabel(t.ts);
      if (lbl !== day) { day = lbl; rows.push({ group: day }); }
      rows.push({
        key: t.id,
        cells: [
          '<span class="cell-stack"><span class="name">' + UI.esc(tradeTitle(t)) + "</span>" +
            '<span class="desc">' + UI.esc(t.pair) + "</span></span>",
          tradeStatus(t),
          '<span class="amount">' + UI.money(Data.fiatOf(t.pair), t.fiatAmt) + "</span>"
        ]
      });
    });
    var emptyTxt = c.status === "onboarding"
      ? "No trades yet. Their application is still in review."
      : "No trades yet.";
    var h = UI.drawer(c.name, "", {
      width: 560,
      subtitle: c.type + " · introduced " + UI.fmtDate(c.introduced)
    });
    var share = Data.ibShare(cid);
    h.body.innerHTML =
      '<div style="margin-bottom:12px">' + clientStatus(c) + "</div>" +
      '<div class="ibc-stats">' +
        '<div><div class="cs-label">Volume this period</div><div class="cs-val">' + (vol ? UI.money("AED", vol, { dp: 0 }) : "—") + "</div></div>" +
        '<div><div class="cs-label">Your accrual this period</div><div class="cs-val">' + (vol ? UI.money("AED", Data.ibAccrual(cid)) : "—") + "</div></div>" +
        (share < 1
          ? '<div><div class="cs-label">Your share</div><div class="cs-val">' + Math.round(share * 100) + '%</div></div>' +
            '<div><div class="cs-label">Split</div><div class="cs-val" style="font-size:var(--text-13);font-weight:var(--w-body)">Shared introduction · set by the desk</div></div>'
          : "") +
      "</div>" +
      '<div class="section-head"><h2>Trading activity</h2></div>' +
      UI.table({
        cols: [
          { label: "Trade", w: "minmax(0, 1fr)" },
          { label: "Status", w: "150px" },
          { label: "Notional", w: "140px", right: true }
        ],
        rows: rows,
        empty: emptyTxt
      }) +
      '<p class="freshline mt-8">Trading activity only. Balances, funding and wallets are never shown.</p>';
  }

  function clRender(el) {
    if (!loaded.clients) {
      var body = document.createElement("div");
      body.innerHTML = '<div class="section">' +
        '<div>' + UI.skel("100%", "56px") + "</div>" +
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
    var h = "";
    h += '<div class="section" id="ibClTbl">' + clTable() + "</div>";
    h += '<div class="section"><div class="section-head"><h2>Introduce someone new</h2></div>' +
      UI.copyRow("Referral link", refLink(), { copy: "https://" + refLink() }) +
      '<p class="freshline mt-8">Sign-ups through your link appear here once the desk confirms them.</p></div>';
    el.insertAdjacentHTML("beforeend", h);
    sig.clTbl = clTable();
    wire(el);
  }

  function clPatch() {
    if (!document.getElementById("ibClTbl")) return false;
    repaint("ibClTbl", clTable(), "clTbl");
    var host = document.getElementById("screenHost");
    if (host) { wire(host); requestAnimationFrame(function () { wire(document.getElementById("screenHost")); }); }
    return true;
  }

  // ————— ib-payouts —————

  function poRate() { return (Data.state.ib.rateBps / 100).toFixed(2) + "%"; }

  function poPeriods() {
    var vol = Data.ibMonthVolume();
    var rows = [{
      key: "current",
      cells: [
        '<span class="cell-stack"><span class="name">' + UI.esc(Data.ibPeriodLabel()) + '</span><span class="desc">current period</span></span>',
        UI.statusDot("info", "Accruing · closes on the last calendar day"),
        '<span class="amount pending">' + (vol ? UI.money("AED", vol, { dp: 0 }) : "—") + "</span>",
        '<span class="amount pending">' + (vol ? UI.money("AED", Data.ibAccrual()) : "—") + "</span>"
      ]
    }];
    Data.state.ib.payouts.forEach(function (p) {
      rows.push({
        key: p.period,
        cells: [
          '<span class="name">' + UI.esc(p.period) + "</span>",
          p.state === "paid"
            ? UI.statusDot("positive", "Paid " + UI.fmtDate(p.paidTs))
            : UI.statusDot("warning", "With the desk · pays within 5 business days"),
          '<span class="amount">' + UI.money("AED", p.volumeAED, { dp: 0 }) + "</span>",
          '<span class="amount' + (p.state === "paid" ? " positive" : "") + '">' + UI.money("AED", p.amountAED, { dp: 0 }) + "</span>"
        ]
      });
    });
    return UI.table({
      cols: [
        { label: "Period", w: "minmax(0, 1fr)" },
        { label: "Status", w: "300px" },
        { label: "Volume", w: "170px", right: true },
        { label: "Payout", w: "150px", right: true }
      ],
      rows: rows,
      empty: "Nothing yet."
    });
  }

  function poRender(el) {
    if (!loaded.payouts) {
      var body = document.createElement("div");
      body.innerHTML = '<div class="section">' +
        '<div class="ib-how">' + UI.skel("100%", "44px") + UI.skel("100%", "44px") + UI.skel("100%", "44px") + "</div>" +
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

  function poHow() {
    var ib = Data.state.ib;
    var usdt = ib.payoutMethod === "usdt";
    return '<div><div class="ih-name">' + UI.digits(null, poRate()) + ' of settled notional</div>' +
        '<div class="ih-desc">Accrues per trade, across every linked client. Shared introductions pay your split.</div></div>' +
      '<div><div class="ih-name">Monthly</div>' +
        '<div class="ih-desc">Each period closes on the last calendar day and pays within 5 business days.</div></div>' +
      '<div><div class="ih-name">' + (usdt
          ? "USDT · " + UI.esc(ib.payoutWallet.label)
          : UI.esc(ib.payoutBank.bank) + " ····" + UI.esc(ib.payoutBank.iban.replace(/\s/g, "").slice(-3))) + "</div>" +
        '<div class="ih-desc">' + (usdt ? "Your Fireblocks container. Payouts go nowhere else." : "Your verified account, in your own name. Payouts go nowhere else.") + "</div></div>";
  }

  // AED to their own bank account, or USDT to the desk-created Fireblocks
  // container named referral-<name> (2026-09-02 call). One is active;
  // switching changes where money goes, so it takes a step-up.
  function poDest() {
    var ib = Data.state.ib;
    var usdt = ib.payoutMethod === "usdt";
    return '<div class="section-head"><h2>Payout destination</h2>' +
      '<span class="link">' + UI.statusDot("positive", usdt ? "Ready" : "Verified") + "</span></div>" +
      '<div class="seg">' +
        '<button class="seg-btn' + (!usdt ? " active" : "") + '" data-paym="bank" type="button">AED · bank account</button>' +
        '<button class="seg-btn' + (usdt ? " active" : "") + '" data-paym="usdt" type="button">USDT · Fireblocks container</button>' +
      "</div>" +
      '<div class="mt-16">' + (usdt
        ? UI.copyRow("Container", ib.payoutWallet.label) +
          UI.copyRow("Custody", ib.payoutWallet.custody + " · " + ib.payoutWallet.net)
        : UI.copyRow("Bank", ib.payoutBank.bank) +
          UI.copyRow("IBAN", ib.payoutBank.iban, { mono: true, copy: ib.payoutBank.iban.replace(/\s/g, "") }) +
          UI.copyRow("Account name", ib.payoutBank.title)) +
      "</div>" +
      '<p class="freshline mt-8">' + (usdt
        ? "Created and named for you by the desk. Payouts convert at the day’s reference rate."
        : "In your own name, verified by the desk.") + "</p>";
  }

  function poBody(el) {
    var h = "";

    h += '<div class="section"><div class="section-head"><h2>How you’re paid</h2></div>' +
      '<div class="ib-how" id="ibPoHow">' + poHow() + "</div></div>";

    h += '<div class="section"><div id="ibPoDest">' + poDest() + "</div></div>";

    h += '<div class="section"><div class="section-head"><h2>Periods</h2></div>' +
      '<div id="ibPoTbl">' + poPeriods() + "</div></div>";

    h += '<div class="section"><div class="demo-strip">' +
      '<span class="freshline">Demo · the Optimus side. The accrual math is a placeholder.</span>' +
      '<button class="db-btn" id="ibPoSim" type="button">A client’s trade settles</button>' +
      '<button class="db-btn" id="ibPoRun" type="button">Desk runs the scheduled payout</button>' +
      "</div></div>";

    el.insertAdjacentHTML("beforeend", h);
    sig.poHow = poHow();
    sig.poDest = poDest();
    sig.poTbl = poPeriods();
    wire(el);
  }

  function poPatch() {
    if (!document.getElementById("ibPoTbl")) return false;
    repaint("ibPoHow", poHow(), "poHow");
    repaint("ibPoDest", poDest(), "poDest");
    repaint("ibPoTbl", poPeriods(), "poTbl");
    var host = document.getElementById("screenHost");
    if (host) { wire(host); requestAnimationFrame(function () { wire(document.getElementById("screenHost")); }); }
    return true;
  }

  // ————— wiring (shared, idempotent) —————

  function wire(node) {
    if (!node) return;
    node.querySelectorAll("[data-go]").forEach(function (b) {
      if (b.__ibWired) return;
      b.__ibWired = true;
      b.addEventListener("click", function () { App.go(b.getAttribute("data-go")); });
    });
    node.querySelectorAll(".row.clickable").forEach(function (r) {
      if (r.__ibWired) return;
      r.__ibWired = true;
      r.addEventListener("click", function () {
        var m = r.querySelector("[data-client]");
        if (m) openClient(m.getAttribute("data-client"));
      });
    });
    ["ibOvSim", "ibPoSim"].forEach(function (id) {
      var b = node.querySelector("#" + id);
      if (b && !b.__ibWired) {
        b.__ibWired = true;
        b.addEventListener("click", function () { Data.ibSimClientTrade(); });
      }
    });
    var run = node.querySelector("#ibPoRun");
    if (run && !run.__ibWired) {
      run.__ibWired = true;
      run.addEventListener("click", function () {
        if (!Data.ibRunPayout()) UI.toast("No payout is scheduled. The current period is still accruing.", "blocked");
      });
    }
    node.querySelectorAll("[data-paym]").forEach(function (b) {
      if (b.__ibWired) return;
      b.__ibWired = true;
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-paym");
        if (m === Data.state.ib.payoutMethod) return;
        UI.stepUp("Changing where you’re paid is a security change.", function () {
          Data.ibSetPayoutMethod(m);
        });
      });
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
    subtitle: "What your introduced clients trade, and what it accrues to you",
    zone: "app",
    render: ovRender,
    onData: onDataFor(ovPatch)
  });

  App.registerScreen("ib-clients", {
    title: "Clients",
    subtitle: "The clients you introduced. Trading activity only, never balances or funding",
    zone: "app",
    render: clRender,
    onData: onDataFor(clPatch)
  });

  App.registerScreen("ib-payouts", {
    title: "Payouts",
    subtitle: "What your introductions accrue, and where it’s paid",
    zone: "app",
    render: poRender,
    onData: onDataFor(poPatch)
  });
})();
