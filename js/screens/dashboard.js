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
  function order() { var o = Data.state.balOrder; return o && o.length === CURS.length ? o : CURS; }

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
  // what you HOLD, and pricing lives on Trade. Each balance is a card on the
  // Trade object's warm-paper surface — a deliberate Hamis override of the
  // boxed-number ban — identity carried by the 9px swatch beside the proper
  // name ("UAE dirham", "Tether USD"), the amount in its proper symbol where
  // a latin one exists. No dots, no "live": the only sub-line is the
  // not-yet-live exception. The whole card taps through to the balance view.

  function currencyCell(cur) {
    var live = Data.railLive(cur);
    var fr = Data.state.firstRun;
    var bal = fr ? 0 : (Data.state.bal[cur] || 0);

    return '<button class="bal-card" data-bal="' + UI.esc(cur) + '" draggable="true" type="button">' +
      '<span class="bc-name">' + ccy(cur, { label: false }) + UI.esc(Data.curName ? Data.curName(cur) : cur) + "</span>" +
      (live
        ? '<span class="bc-amt">' + UI.moneyHero(cur, bal, { symbol: true }) + "</span>"
        : '<span class="bc-amt faint">—</span><span class="bc-sub">' + UI.statusDot("neutral", "not yet live") + "</span>") +
      "</button>";
  }

  function stripHtml() {
    return order().map(currencyCell).join("");
  }

  // ————— reorder: drag a card on desktop, or the Reorder drawer anywhere —————
  // Both write Data.setBalOrder; the Balances pills follow the same order.

  var dragCur = null;
  function wireDnd(node) {
    if (!node) return;
    node.querySelectorAll(".bal-card").forEach(function (c) {
      if (c.__dbDnd) return;
      c.__dbDnd = true;
      c.addEventListener("dragstart", function () { dragCur = c.getAttribute("data-bal"); c.classList.add("dragging"); });
      c.addEventListener("dragend", function () { c.classList.remove("dragging"); dragCur = null; });
      c.addEventListener("dragover", function (e) { e.preventDefault(); c.classList.add("drop-target"); });
      c.addEventListener("dragleave", function () { c.classList.remove("drop-target"); });
      c.addEventListener("drop", function (e) {
        e.preventDefault();
        c.classList.remove("drop-target");
        var to = c.getAttribute("data-bal");
        if (!dragCur || dragCur === to) return;
        var o = order().slice();
        o.splice(o.indexOf(dragCur), 1);
        o.splice(o.indexOf(to), 0, dragCur);
        Data.setBalOrder(o);
      });
    });
  }

  function openReorder() {
    var h = UI.drawer("Reorder balances", "", {
      width: 420,
      foot: '<button class="btn btn-secondary" id="roClose" type="button">Close</button>'
    });
    function paintList() {
      var o = order();
      h.body.innerHTML = '<div class="ro-list">' + o.map(function (cur, i) {
        return '<div class="ro-row">' +
          '<span class="ro-name">' + ccy(cur, { label: false }) + UI.esc(Data.curName(cur)) + "</span>" +
          '<span class="ro-btns">' +
            '<button class="icon-btn" data-ro="up" data-cur="' + cur + '" type="button" aria-label="Move up"' + (i === 0 ? " disabled" : "") + ">" + icon("chevronDown", 14) + "</button>" +
            '<button class="icon-btn" data-ro="down" data-cur="' + cur + '" type="button" aria-label="Move down"' + (i === o.length - 1 ? " disabled" : "") + ">" + icon("chevronDown", 14) + "</button>" +
          "</span></div>";
      }).join("") + "</div>";
      h.body.querySelectorAll("[data-ro]").forEach(function (b) {
        b.addEventListener("click", function () {
          var o2 = order().slice(), cur = b.getAttribute("data-cur"), i = o2.indexOf(cur);
          var j = b.getAttribute("data-ro") === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= o2.length) return;
          o2.splice(i, 1); o2.splice(j, 0, cur);
          Data.setBalOrder(o2);
          paintList();
        });
      });
    }
    paintList();
    h.el.querySelector("#roClose").addEventListener("click", h.close);
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

  function phone() { return !!(App.isPhone && App.isPhone()); }

  // The day is already a group label above the row, so on the phone the meta
  // slot carries the time alone ("14:14"); repeating "Today," inside every
  // row would be the same fact twice and it steals width from the status
  // beside it. On the phone the group label is sticky (.table.has-m), so the
  // day is always on screen. Desktop is untouched: its group label scrolls
  // away, so the row keeps the full stamp.
  function stamp(ts) { return phone() ? UI.fmtTime(ts) : UI.fmtTs(ts); }

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
          '<span class="date">' + UI.esc(stamp(a.ts)) + "</span>",
          // display:block because the role wrapper (.m-cell) is now the grid
          // item: .amount's text-align:right only right-aligns the figure if
          // .amount is itself the block filling the track. Desktop unchanged.
          '<span class="' + amountCls(a) + '" style="display:block">' +
            UI.money(a.cur, a.amount, { sign: a.dir > 0 ? "+" : a.dir < 0 ? "−" : "" }) + "</span>"
        ]
      });
    });
    return UI.table({
      // phone roles (m): line 1 is the event over the amount, line 2 the
      // status over the time. The swatch stays INSIDE the event cell rather
      // than becoming its own "lead" track: a separate track would have to
      // be a fixed width with no gap to the title, which moves every desktop
      // column. app.css already handles it (.m-row [data-m="title"]
      // .cell-main { display: inline }). The structural spacer is "hide" so
      // it never auto-places into a third line of the phone grid.
      cols: [
        { label: "Event", w: "minmax(0, 300px)", m: "title" },
        { spacer: true, m: "hide" },
        { label: "Status", w: "190px", m: "status" },
        { label: "Date", w: "105px", m: "meta" },
        { label: "Amount", w: "155px", right: true, m: "amount" }
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
    bind(node, "#dbReorder", openReorder);
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

    // waiting vocabulary: one brief skeleton pass on first load only.
    // Not on the phone: 380ms of grey bars on a 390px screen reads as a
    // broken app, not as loading. The flag is still burned so the desktop
    // path (and any later resize) behaves exactly as before.
    if (phone()) loadedOnce = true;
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
    h += '<div class="section"><div class="section-head"><h2>Balances</h2>' +
      '<button class="link" id="dbReorder" type="button">Reorder</button></div>' +
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
    wireDnd(el);

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
    wireDnd(document.getElementById("dbStrip"));
    requestAnimationFrame(function () { wireDnd(document.getElementById("dbStrip")); });
    paint("dbActivity", activityHtml(), "act");
    return true;
  }

  App.registerScreen("dashboard", {
    title: "Dashboard",
    actions: function () {
      if (Data.state.role === "viewer") return "";
      return '<button class="btn btn-primary" data-go-trade type="button">Get quote</button>';
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
