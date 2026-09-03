/* ————————————————————————————————————————————————
   Fasset Prime — Dashboard (J19/J20: pure monitor).
   The exemplar screen. No money-moving controls live here;
   everything routes to Trade or Move money.

   2026-09-02: the 30-day balance line is gone (Hamis: pointless for
   this persona; a treasurer's own books are the source of truth for
   their trajectory). In its place, per pm-designer: a compact
   indicative reference-rates row (USDT vs AED · USD · EUR · BHD),
   which answers the one market question this persona opens a trading
   portal for and makes the hero's "at market reference" auditable.
   The scrub, the count-up and the draw-in died with the chart; the
   total lands via UI.moneyHero like every other figure. The screen
   is now fill-free, and nothing new claims the freed saturated-fill
   slot on purpose.

   Grammar demonstrated:
   · balance hero (42px, solid full-size currency code)
   · reference rates as OPEN TYPOGRAPHY via UI.digits (rates are
     non-money figures; money never routes through UI.digits)
   · currency identity: a 9px squarish swatch (UI.ccy) wherever this
     screen names a rail. Bare swatch inside rows and strips, never a
     chip. The rates row carries NO swatches: a pair names two
     currencies and would break the one-categorical-dimension rule.
   · per-currency balances as a stat strip, never boxed numbers
   · in-flight strip as an open list · recent activity as a no-lines table
   · credits and debits are not the same colour: a terminal credit is
     accent text, an outbound figure recedes, only held/failed colours red
   · local state (a webhook patch) never calls App.rerender, so the
     page entrance is never replayed

   Colour budget on this screen: 4 identity hues (AED/USD/EUR/USDT; BHD
   carries the neutral swatch, keeping the budget at four) ·
   0 saturated fills · 1 hue colouring text (--st-error, held only).
   Status dots stay --st-*; an identity hue never lands on a round dot.

   States inventory: loading (one skeleton pass, rates-row-shaped) ·
   live · stale feed (warning status, last-known values, rates caption
   timestamps itself) · first-run zero balance (rates row KEPT: it
   prices the first trade before funding) · rails-not-live (value is a
   dash, swatch still identifies the rail) · held credit (error
   escalation in the tile sub-line and the in-flight strip) · empty
   in-flight · empty activity · role-gated action (viewer sees no "Get
   a quote"; the rates row stays readable but doesn't navigate).
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  // ————— screen-local flags: per app load, never per data change —————
  var loadedOnce = false;   // the one skeleton pass
  var curFlight = [];       // in-flight rows by index, for the click targets
  var sig = {};             // last painted html per region — kills double paints

  var CURS = ["AED", "USD", "EUR", "BHD", "USDT"];
  var PAIRS = ["USDT/AED", "USDT/USD", "USDT/EUR", "USDT/BHD"];

  // ————— foundation helpers, with a graceful floor —————

  function ccy(cur, opts) {
    if (UI.ccy) return UI.ccy(cur, opts);
    return opts && opts.label === false ? "" : UI.esc(cur);
  }

  function repaint(el, html) {
    if (!el) return;
    if (UI.repaint) UI.repaint(el, html);
    else el.innerHTML = html;
  }

  function liveTotal() {
    return Data.state.firstRun ? 0 : Data.totalAedApprox();
  }

  // ————— the hero's second line —————

  function deltaHtml() {
    var fr = Data.state.firstRun;
    var arriving = fr ? 0 : CURS.reduce(function (a, c) { return a + Data.inflightIn(c); }, 0);
    var freshness = Data.state.stale
      ? UI.statusDot("warning", "feed interrupted · last-known values from " + UI.fmtTs(new Date(Date.now() - 9 * 60000).toISOString()))
      : UI.statusDot("positive", "live · updated " + UI.fmtTime());
    // .up is accent TEXT, not a fill — this screen has no saturated fill.
    return (arriving ? '<span class="up">' + UI.money("AED", arriving, { sign: "+" }) + " arriving</span> · " : "") + freshness;
  }

  // ————— reference rates: the row that replaced the line —————
  // Indicative, never a quote. Rates are non-money figures, so they
  // assemble through UI.digits. No swatches, no tick colours, no arrows:
  // level plus timestamp is what a professional expects from a reference
  // line, and direction colour would collide with the status vocabulary.

  // each pair is its own cell: click goes to Trade, drag reorders. The order
  // is the client's pinned preference (Data.state.pairOrder) and the Trade
  // pair picker follows the same order.
  function ratesRow() {
    var canTrade = Data.state.role !== "viewer";
    var pairs = Data.state.pairOrder && Data.state.pairOrder.length ? Data.state.pairOrder : PAIRS;
    return '<div class="rates-row">' + pairs.map(function (p) {
      var r = Data.refRate(p);
      var inner = '<span class="rr-pair">' + UI.esc(p) + "</span>" +
        '<span class="rr-rate">' + (r ? UI.digits(null, r.toFixed(4)) : "—") + "</span>";
      return canTrade
        ? '<button class="rr-cell" data-rrpair="' + UI.esc(p) + '" data-go-trade draggable="true" title="Drag to reorder" type="button">' + inner + "</button>"
        : '<span class="rr-cell">' + inner + "</span>";
    }).join("") + "</div>";
  }

  function ratesCaption() {
    return Data.state.stale
      ? "Market reference · indicative · last-known, updated " + UI.esc(UI.fmtTime(new Date(Date.now() - 9 * 60000).toISOString()))
      : "Market reference · indicative · firm prices in Trade · drag to reorder";
  }

  function ratesHtml() {
    return ratesRow() + '<div class="freshline mt-8">' + ratesCaption() + "</div>";
  }

  // drag-to-reorder wiring; one binding per node, same guard style as bind()
  var dragPair = null;
  function wireRatesDnd(node) {
    if (!node) return;
    node.querySelectorAll("[data-rrpair]").forEach(function (b) {
      if (b.__dbDnd) return;
      b.__dbDnd = true;
      b.addEventListener("dragstart", function () { dragPair = b.getAttribute("data-rrpair"); b.classList.add("dragging"); });
      b.addEventListener("dragend", function () { b.classList.remove("dragging"); });
      b.addEventListener("dragover", function (e) { e.preventDefault(); });
      b.addEventListener("drop", function (e) {
        e.preventDefault();
        var to = b.getAttribute("data-rrpair");
        if (!dragPair || dragPair === to) return;
        var order = (Data.state.pairOrder || []).slice();
        var fi = order.indexOf(dragPair), ti = order.indexOf(to);
        if (fi < 0 || ti < 0) return;
        order.splice(fi, 1);
        order.splice(ti, 0, dragPair);
        dragPair = null;
        Data.setPairOrder(order);
      });
    });
  }

  // ————— per-currency cell: open typography, identity in the label —————

  function railStatus(cur) {
    if (cur === "USDT") return UI.statusDot("positive", "live · Fasset custody");
    return Data.railLive(cur)
      ? UI.statusDot("positive", "live")
      : UI.statusDot("neutral", "not yet live");
  }

  function currencyCell(cur) {
    var live = Data.railLive(cur);
    var fr = Data.state.firstRun;
    var bal = fr ? 0 : (Data.state.bal[cur] || 0);
    var fin = fr ? 0 : (Data.inflightIn(cur) + Data.settlingIn(cur));
    var fout = fr ? 0 : Data.inflightOut(cur);
    var held = fr ? 0 : Data.heldAmt(cur);

    // the figure is set, not printed: per-digit assembly on all four balances
    var value = live
      ? '<div class="tile-value">' + UI.moneyHero(cur, bal) + "</div>"
      : '<div class="tile-value faint">—</div>';

    var subs = [];
    if (live) {
      if (fin) subs.push("+" + UI.fmtNum(fin) + " in flight in");
      if (fout) subs.push("−" + UI.fmtNum(fout) + " in flight out");
      // held is the one kind the law lets colour text
      if (held) subs.push('<span class="error status-error">' + UI.fmtNum(held) + " held</span>");
      if (!subs.length) subs.push("all settled");
    } else {
      subs.push("available when the rail opens");
    }

    return '<button class="stat-strip-cell" data-go-move type="button">' +
      '<div class="tile-label">' + ccy(cur) + '<span style="margin-left:auto"></span>' + railStatus(cur) + "</div>" +
      value +
      '<div class="tile-sub">' + subs.join(" · ") + "</div>" +
      "</button>";
  }

  function stripHtml() {
    return CURS.map(currencyCell).join("");
  }

  // ————— in flight now —————
  // Everything in this strip is provisional, so nothing here is accent.
  // Money leaving recedes (.muted), a held credit escalates (--st-error),
  // and an order awaiting funding carries no hue at all: the word "needed"
  // and the sentence do that work.

  function inflightRows() {
    var S = Data.state;
    if (S.firstRun) return [];
    var rows = [];
    S.deposits.forEach(function (d) {
      if (d.state === "detected" || d.state === "processing") rows.push({
        cur: d.cur,
        amt: '<span class="if-amt">' + UI.money(d.cur, d.amount, { sign: "+" }) + "</span>",
        txt: "Deposit " + d.id + " · " + (d.state === "detected" ? "detected" : "processing") + " · " + UI.fmtTs(d.ts),
        go: "move"
      });
      if (d.state === "held" || d.state === "ident") rows.push({
        cur: d.cur,
        amt: '<span class="if-amt error status-error">' + UI.money(d.cur, d.amount) + "</span>",
        txt: "Held for identification · excluded from available balance",
        go: "move"
      });
    });
    S.withdrawals.forEach(function (w) {
      if (["submitted", "servicing", "sent"].indexOf(w.state) >= 0) rows.push({
        cur: w.cur,
        amt: '<span class="if-amt muted">' + UI.money(w.cur, w.amount, { sign: "−" }) + "</span>",
        txt: "Withdrawal " + w.id + " · " + Data.windowCopy(),
        go: "move"
      });
    });
    S.trades.forEach(function (t) {
      if (t.state === "awaiting") rows.push({
        cur: t.payCur || Data.fiatOf(t.pair),
        amt: '<span class="if-amt">' + UI.money(t.payCur || Data.fiatOf(t.pair), t.needed) + " needed</span>",
        txt: "Order " + t.id + " · awaiting funding at " + t.rate.toFixed(4) + " · fund within 24 hours or it lapses",
        go: "move"
      });
      if (t.state === "settling") rows.push({
        cur: t.side === "buy" ? "USDT" : Data.fiatOf(t.pair),
        amt: '<span class="if-amt">' + (t.side === "buy" ? UI.money("USDT", t.assetAmt, { sign: "+", dp: 0 }) : UI.money(Data.fiatOf(t.pair), t.fiatAmt, { sign: "+" })) + "</span>",
        txt: "Trade " + t.id + " · settling · funds release within 30 minutes",
        go: "history"
      });
    });
    return rows;
  }

  function flightHtml() {
    curFlight = inflightRows();
    if (!curFlight.length) return '<div class="empty empty-sm">Nothing in flight. Everything you hold is settled.</div>';
    // the swatch sits at the left edge of every row, so the rails read as one
    // scannable column rather than four codes buried in four figures
    return curFlight.map(function (r, i) {
      return '<button class="inflight-row" data-if="' + i + '" type="button">' +
        ccy(r.cur, { label: false }) + r.amt +
        '<span class="if-txt">' + UI.esc(r.txt) + "</span>" +
        '<span class="if-go link">View' + icon("chevronRight", 12) + "</span></button>";
    }).join("");
  }

  // ————— recent activity: the no-lines table —————
  // Time-ordered, so it groups by day (newest first); the identity column is
  // capped and status/date/amount cluster at the right edge.

  function amountCls(a) {
    if (a.status.kind === "error") return "amount error status-error";
    if (a.status.kind === "info" || a.status.kind === "warning") return "amount pending";
    // accent only on a terminal credit: credited, settled, confirmed AND
    // money in. A terminal debit is neutral — outbound is not a failure.
    if (a.status.kind === "positive" && a.dir > 0) return "amount positive";
    return "amount";
  }

  function activityHtml() {
    var acts = Data.state.firstRun ? [] : Data.activity().slice(0, 5);
    var rows = [], day = null;
    acts.forEach(function (a) {
      var lbl = UI.dayLabel(a.ts);
      if (lbl !== day) { day = lbl; rows.push({ group: day }); }
      rows.push({
        key: a.kind + ":" + a.id,
        clickable: true,
        cells: [
          '<span class="cell-main">' + ccy(a.cur, { label: false }) +
            '<span style="min-width:0"><span class="name" style="display:block">' + UI.esc(a.title) + "</span>" +
            '<span class="desc">' + UI.esc(a.sub) + "</span></span></span>",
          UI.statusDot(a.status.kind, a.status.label),
          '<span class="date">' + UI.esc(UI.fmtTs(a.ts)) + "</span>",
          '<span class="' + amountCls(a) + '">' +
            UI.money(a.cur, a.amount, { sign: a.dir > 0 ? "+" : a.dir < 0 ? "−" : "" }) + "</span>"
        ]
      });
    });
    return UI.table({
      cols: [
        { label: "Event", w: "minmax(0, 300px)" },
        { spacer: true },
        { label: "Status", w: "190px" },
        { label: "Date", w: "105px" },
        { label: "Amount", w: "155px", right: true }
      ],
      rows: rows,
      empty: "No activity yet. Your first deposit shows up here."
    });
  }

  // ————— skeleton: shaped like what lands, rates row included —————

  function skeletonHtml() {
    return '<div class="section">' +
      "<div>" + UI.skel("140px", "12px") + "</div>" +
      '<div class="mt-12">' + UI.skel("340px", "44px") + "</div>" +
      '<div class="mt-16">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-24 flex" style="gap:32px">' + UI.skel("180px", "56px") + UI.skel("180px", "56px") + UI.skel("180px", "56px") + UI.skel("180px", "56px") + "</div>" +
      '<div class="mt-32">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      "</div>";
  }

  // ————— wiring: navigation only. A monitor mutates nothing. —————

  // once per node: a patched region re-wires its own fresh nodes, and the
  // head's action (wired before the body exists) is never bound twice
  function bind(node, sel, fn) {
    node.querySelectorAll(sel).forEach(function (b) {
      if (b.__dbWired) return;
      b.__dbWired = true;
      b.addEventListener("click", fn);
    });
  }

  function wireRegion(node) {
    if (!node) return;
    bind(node, "[data-go-move]", function () { App.go("move"); });
    bind(node, "[data-go-history]", function () { App.go("history"); });
    bind(node, "[data-go-trade]", function () { App.go("trade"); });
    bind(node, ".row.clickable", function () { App.go("history"); });
    bind(node, "[data-if]", function (e) {
      var b = e.currentTarget;
      var r = curFlight[+b.getAttribute("data-if")];
      if (r) App.go(r.go);
    });
  }

  // ————— render —————

  function render(el) {
    // the page head is rendered inside .screen before us, so the top-right
    // action is wired here rather than with an inline handler
    wireRegion(el.querySelector(".page-actions"));

    // waiting vocabulary: one brief skeleton pass on first load only
    if (!loadedOnce) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 380);
      return;
    }
    renderBody(el);
  }

  function renderBody(el) {
    var S = Data.state;
    var fr = S.firstRun;
    var total = liveTotal();

    var h = "";

    // — the balance hero and the reference rates: one section —
    // The rates row stays in first-run: it prices the first trade before
    // the account is funded, which is exactly when a new client wants it.
    h += '<div class="section">' +
      '<div class="bal-hero"><div>' +
        '<div class="bal-label">Total balance · all currencies</div>' +
        '<div class="bal-value" id="dbHeroVal">' + UI.moneyHero("AED", total) + "</div>" +
        '<div class="bal-delta" id="dbHeroDelta">' + deltaHtml() + "</div>" +
      "</div></div>" +
      '<div id="dbRates">' + ratesHtml() + "</div>";

    if (S.stale) {
      h += '<div class="note note-warning mt-16">Balance feed interrupted. Showing last-known values; it re-syncs automatically.</div>';
    }
    if (fr) {
      h += '<div class="mt-24"><p class="muted" style="font-size:14px">Welcome. Your account is ready.</p>' +
        '<p class="tile-sub mt-4">Fund it to start trading. Your deposit details are in Move money.</p>' +
        '<button class="btn btn-primary mt-16" data-go-move type="button">Go to Move money</button></div>';
    }
    h += "</div>";

    // — per-currency balances: a stat strip, never boxed numbers —
    h += '<div class="section"><div class="section-head"><h2>Balances</h2></div>' +
      '<div class="stat-strip" id="dbStrip">' + stripHtml() + "</div></div>";

    // — in flight now —
    h += '<div class="section"><div class="section-head"><h2>In flight now</h2></div>' +
      '<div id="dbFlight">' + flightHtml() + "</div></div>";

    // — recent activity —
    h += '<div class="section"><div class="section-head"><h2>Recent activity</h2>' +
      '<button class="link" data-go-history type="button">Full history' + icon("arrowRight", 12) + "</button></div>" +
      '<div id="dbActivity">' + activityHtml() + "</div></div>";

    // sections land as direct children of .screen so the entrance
    // choreography (title → hero → rates → strips → table) applies
    el.insertAdjacentHTML("beforeend", h);
    wireRegion(el);
    wireRatesDnd(el);

    // the paint signatures start here, so the first patch only touches what
    // a confirmed event actually changed
    sig = {
      hero: String(total),
      delta: deltaHtml(),
      rates: ratesHtml(),
      strip: stripHtml(),
      flight: flightHtml(),
      act: activityHtml()
    };
  }

  // ————— patch in place: a webhook must not replay the page entrance —————

  function paint(id, html, key) {
    var node = document.getElementById(id);
    if (!node || sig[key] === html) return;
    sig[key] = html;
    repaint(node, html);
    wireRegion(node);
    // second pass next frame in case the swap lands inside UI.repaint's own
    // frame. The per-node guard makes it a no-op when it already took.
    requestAnimationFrame(function () { wireRegion(document.getElementById(id)); });
  }

  function patch() {
    var strip = document.getElementById("dbStrip");
    if (!strip) return false;                  // skeleton still up: let app.js render

    var total = liveTotal();

    // balances only move on confirmed events, so the hero only repaints
    // when the total actually changed
    if (sig.hero !== String(total)) {
      sig.hero = String(total);
      repaint(document.getElementById("dbHeroVal"), UI.moneyHero("AED", total));
    }
    var dh = deltaHtml();
    if (sig.delta !== dh) { sig.delta = dh; repaint(document.getElementById("dbHeroDelta"), dh); }

    paint("dbRates", ratesHtml(), "rates");
    wireRatesDnd(document.getElementById("dbRates"));
    requestAnimationFrame(function () { wireRatesDnd(document.getElementById("dbRates")); });
    paint("dbStrip", stripHtml(), "strip");
    paint("dbFlight", flightHtml(), "flight");
    paint("dbActivity", activityHtml(), "act");
    return true;
  }

  App.registerScreen("dashboard", {
    title: "Dashboard",
    subtitle: "What you hold, what’s moving, and what just happened.",
    actions: function () {
      if (Data.state.role === "viewer") return "";
      return '<button class="btn btn-primary" data-go-trade type="button">Get a quote</button>';
    },
    zone: "app",
    render: render,
    // prefs (role, rails, stale, first run) change the composition and the
    // head's action, so those still take the full render. Money movement is
    // patched in place.
    onData: function (scope) {
      if (scope === "prefs" || scope === "all" || scope === "journey" || scope === "ib") return false;
      return patch();
    }
  });
})();
