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

   States inventory: loading (one skeleton pass) ·
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
  var sig = {};             // last painted html per region — kills double paints

  var CURS = ["AED", "USD", "EUR", "BHD", "USDT"];

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

  // ————— the hero: total balance in the client's chosen denomination —————
  // The freshline is gone (2026-09-03): balances move only on confirmed
  // events, they are facts, not a feed. Rates left the dashboard the same
  // day — pricing lives on Trade.

  function heroTotal() {
    var aed = liveTotal();
    return Data.state.totalCur === "USDT" ? aed / Data.refRate("USDT/AED") : aed;
  }

  function heroSeg() {
    return '<span class="seg seg-mini">' + ["AED", "USDT"].map(function (c) {
      return '<button class="seg-btn' + (Data.state.totalCur === c ? " active" : "") +
        '" data-totcur="' + c + '" type="button">' + c + "</button>";
    }).join("") + "</span>";
  }

  function heroLabelHtml() { return "Total balance" + heroSeg(); }

  // ————— per-currency balance cards —————
  // Rates left the dashboard entirely (Hamis 2026-09-03): the dashboard shows
  // what you HOLD, and pricing lives on Trade. Each balance is a tinted card
  // in its identity hue — a deliberate Hamis override of the boxed-number
  // ban — named properly ("UAE dirham", "Tether USD"), the amount in its
  // proper symbol where a latin one exists. No dots, no "live": the only
  // sub-line is the not-yet-live exception. The whole card taps through to
  // the currency's balance view.

  function currencyCell(cur) {
    var live = Data.railLive(cur);
    var fr = Data.state.firstRun;
    var bal = fr ? 0 : (Data.state.bal[cur] || 0);

    return '<button class="bal-card cat-' + cur.toLowerCase() + '" data-bal="' + UI.esc(cur) + '" type="button">' +
      '<span class="bc-name">' + UI.esc(Data.curName ? Data.curName(cur) : cur) + "</span>" +
      (live
        ? '<span class="bc-amt">' + UI.moneyHero(cur, bal, { symbol: true }) + "</span>"
        : '<span class="bc-amt faint">—</span><span class="bc-sub">' + UI.statusDot("neutral", "not yet live") + "</span>") +
      "</button>";
  }

  function stripHtml() {
    return CURS.map(currencyCell).join("");
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

  var curActs = {};   // key → entry, for the drawer

  function activityHtml() {
    var acts = Data.state.firstRun ? [] : Data.activity().slice(0, 30);
    curActs = {};
    acts.forEach(function (a) { curActs[a.kind + ":" + a.id] = a; });
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

  function openRow(row) {
    var a = curActs[row.getAttribute("data-key")];
    if (a && window.Details) Details.openEntry(a);
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
    bind(node, "[data-go-trade]", function () { App.go("trade"); });
    bind(node, "[data-totcur]", function (e) {
      Data.setTotalCur(e.currentTarget.getAttribute("data-totcur"));
    });
    bind(node, "[data-bal]", function (e) {
      var cur = e.currentTarget.getAttribute("data-bal");
      var b = App.screen("balance");
      if (b && b.setCur) b.setCur(cur);
      App.go("balance");
    });
    bind(node, ".row.clickable", function (e) { openRow(e.currentTarget); });
    // demo webhooks: the whole feed's lifecycle pushes live here now
    bind(node, "#dbSimDep", function () { Data.simulateDeposit(3200000); });
    bind(node, "#dbSimCredit", function () { if (!Data.creditOldest()) UI.toast("Nothing processing. Detect a deposit first.", "blocked"); });
    bind(node, "#dbWdAdvance", function () { if (!Data.advanceWithdrawal()) UI.toast("No withdrawal in flight.", "blocked"); });
    bind(node, "#dbWdFail", function () { if (!Data.failWithdrawal()) UI.toast("No withdrawal in flight.", "blocked"); });
    bind(node, "#dbLapse", function () { if (!Data.lapseOrder()) UI.toast("No order awaiting funding.", "blocked"); });
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
        '<div class="bal-label" id="dbHeroLabel">' + heroLabelHtml() + "</div>" +
        '<div class="bal-value" id="dbHeroVal">' + UI.moneyHero(S.totalCur, heroTotal()) + "</div>" +
      "</div></div>";

    if (S.stale) {
      h += '<div class="note note-warning mt-16">Balance feed interrupted. Showing last-known values; it re-syncs automatically.</div>';
    }
    if (fr) {
      h += '<div class="mt-24"><p class="muted" style="font-size:14px">Welcome. Your account is ready.</p>' +
        '<p class="tile-sub mt-4">Fund it to start trading.</p>' +
        '<button class="btn btn-primary mt-16" data-bal="AED" type="button">View your deposit details</button></div>';
    }
    h += "</div>";

    // — per-currency balances: tinted identity cards, whole card taps through —
    h += '<div class="section"><div class="section-head"><h2>Balances</h2></div>' +
      '<div class="bal-cards" id="dbStrip">' + stripHtml() + "</div></div>";

    // — the feed: every money event, one list, rows open the details drawer —
    h += '<div class="section"><div class="section-head"><h2>Activity</h2></div>' +
      '<div id="dbActivity">' + activityHtml() + "</div></div>";

    // — demo: the bank, the chain and the desk, simulated —
    h += '<div class="section"><div class="demo-strip">' +
      '<span class="freshline">Demo · webhooks and desk pushes for the feed.</span>' +
      '<button class="db-btn" id="dbSimDep" type="button">AED deposit detected</button>' +
      '<button class="db-btn" id="dbSimCredit" type="button">Oldest deposit completes</button>' +
      '<button class="db-btn" id="dbWdAdvance" type="button">Withdrawal advances</button>' +
      '<button class="db-btn" id="dbWdFail" type="button">A withdrawal fails</button>' +
      '<button class="db-btn" id="dbLapse" type="button">An awaiting order lapses</button>' +
      "</div></div>";

    // sections land as direct children of .screen so the entrance
    // choreography (title → hero → rates → strips → table) applies
    el.insertAdjacentHTML("beforeend", h);
    wireRegion(el);

    // the paint signatures start here, so the first patch only touches what
    // a confirmed event actually changed
    sig = {
      hero: String(total) + ":" + S.totalCur,
      strip: stripHtml(),
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

    // balances only move on confirmed events, so the hero only repaints
    // when the total (or its denomination) actually changed
    var totKey = String(liveTotal()) + ":" + Data.state.totalCur;
    if (sig.hero !== totKey) {
      sig.hero = totKey;
      repaint(document.getElementById("dbHeroVal"), UI.moneyHero(Data.state.totalCur, heroTotal()));
      var lbl = document.getElementById("dbHeroLabel");
      if (lbl) { lbl.innerHTML = heroLabelHtml(); wireRegion(lbl); }
    }

    paint("dbStrip", stripHtml(), "strip");
    paint("dbActivity", activityHtml(), "act");
    return true;
  }

  App.registerScreen("dashboard", {
    title: "Dashboard",
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
