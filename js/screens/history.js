/* ————————————————————————————————————————————————
   Fasset Prime — History (J21/J22). Built in wave 2, reworked in wave 3
   against UI-GAPS.md items 1, 5, 6 and the colour plan.
   Ported from prime-v2.standalone.html per ARCHITECTURE.md.

   One unified lifecycle archive: trades (including awaiting funding
   and settling), deposits, withdrawals and whitelist events, in one
   no-lines table with type / currency / status filters. Rows expand
   IN PLACE to the lifecycle spine (UI.timeline) beside the facts, so
   drilling down never costs the operator their place in the list. The
   open row also carries the anchored 2px ink inset bar, so the row
   you are reading stays marked while the pointer moves elsewhere.

   COLOUR: currency is this screen's one categorical dimension, because
   this screen has money on it. It appears as a 9px squarish swatch
   (UI.ccy) in the amount cell and on the statement group labels, and
   nowhere else: the Type column stays a neutral .tag on purpose, the
   status dots stay the fixed --st-* vocabulary, and the amount column
   takes no accent text (one hue per cell, and here that hue is the
   rail's). Four hues, no saturated fill: the budget, exactly.

   STATEMENTS are a real document, not a toast. Opening one shows the
   statement paper: header, scope pills per issued currency, opening /
   credits / debits / closing, the actual seeded movements for that
   currency and period with a running balance, and the client-money
   footer with ACCOUNT_NAME verbatim. Every figure is derived from the
   ledger — the closing balance is the live balance rewound past every
   movement after the period end, so the paper can never disagree with
   the dashboard. Nothing claims to be a PDF, because nothing here can
   produce one; the toolbar offers the real CSV instead.

   Filter and open-row state is screen-local (F) and re-applied on
   every render, so a webhook landing mid-read never collapses a row.
   Filter changes repaint the table region only (UI.repaint); opening a
   row swaps the table without a fade and animates only the detail that
   was just inserted, so the reader's row never flashes.

   Data API: activity is re-derived here because the archive needs the
   per-object lifecycle stamps, not the flattened feed. Reads only:
   Data.state.trades / deposits / withdrawals / wallets / banks /
   statements / bal, plus Data.windowCopy, VIBANS and ACCOUNT_NAME.
   Lifecycle pushes in the demo strip go through Data.creditOldest ·
   advanceWithdrawal · settleOrder — the client side never asserts an
   outcome.
   States per element: loading (one skeleton pass) · empty (filters
   match nothing; a statement period with no movements) · error/failed
   (held deposits, rejected whitelist entries, with the reason and the
   next step) · stale/degraded (feed note under the table) ·
   permission-denied (none: history is readable by every role,
   including viewers, by design).
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var F = { type: "all", cur: "all", status: "all", open: {} };
  var lastRows = [];

  // ————— foundation primitives —————
  // Shared, fixed signatures. These wrappers keep the screen legible if a
  // primitive has not landed yet; they never re-implement one.
  function ccy(cur, opts) {
    if (UI.ccy) return UI.ccy(cur, opts);
    return opts && opts.label === false ? "" : UI.esc(cur);
  }
  function repaint(el, html) {
    if (!el) return;
    if (UI.repaint) UI.repaint(el, html);
    else el.innerHTML = html;
  }

  function plain(cur, n, dp) {
    var s = UI.fmtNum(n, dp === undefined ? 2 : dp);
    return cur === "USDT" ? s + " USDT" : cur + " " + s;
  }
  function rate4(r) { return Number(r).toFixed(4); }

  // ————— lifecycle spines —————

  function tradeStages(t) {
    var s = [{ label: "Order placed", sub: "locked rate " + rate4(t.rate) + " held for this order", state: "done", time: UI.fmtTs(t.stamps.placed) }];
    if (t.state === "awaiting") {
      s.push({ label: "Awaiting funding", sub: plain(t.payCur, t.needed) + " still needed. Fund within 24 hours or the order lapses.", state: "pending" });
      s.push({ label: "Booked at the locked rate", state: "todo" });
      s.push({ label: "Settled", state: "todo" });
      return s;
    }
    s.push({ label: "Funded", sub: "funded in full from your balance", state: "done", time: UI.fmtTs(t.stamps.funded) });
    s.push({ label: "Booked at the locked rate", sub: plain("USDT", t.assetAmt, 0) + " against " + plain(Data.fiatOf(t.pair), t.fiatAmt), state: "done", time: UI.fmtTs(t.stamps.funded) });
    if (t.state === "settling") s.push({ label: "Settling", sub: "funds release within 30 minutes", state: "active" });
    else s.push({ label: "Settled", sub: "proceeds released to your available balance", state: "done", time: UI.fmtTs(t.stamps.settled) });
    return s;
  }

  function depStages(d) {
    var s = [{ label: "Detected", sub: d.via === "bank" ? "your transfer reached your vIBAN" : "confirmed on-chain", state: "done", time: UI.fmtTs(d.ts) }];
    if (d.state === "held" || d.state === "ident") {
      s.push({ label: d.state === "held" ? "Held for identification" : "Identification submitted",
        sub: "excluded from your available balance until the sender is confirmed",
        state: d.state === "held" ? "failed" : "active" });
      s.push({ label: "Credited to your balance", state: "todo" });
      return s;
    }
    s.push({ label: "Processing", sub: "being credited to your account",
      state: d.state === "processing" ? "active" : d.state === "credited" ? "done" : "todo",
      time: d.state === "credited" ? UI.fmtTs(d.crTs) : "" });
    s.push({ label: "Credited to your balance", sub: "available balance updated",
      state: d.state === "credited" ? "done" : "todo", time: UI.fmtTs(d.crTs) });
    return s;
  }

  function wdStages(w) {
    var order = ["submitted", "servicing", "sent", "confirmed"];
    var labels = { submitted: "Submitted", servicing: "Processing", sent: "Sent", confirmed: "Confirmed" };
    var subs = {
      submitted: "step-up confirmed · set aside from your available balance",
      servicing: "your payout is being prepared",
      sent: "money has left Fasset, on its way to your " + (w.cur === "USDT" ? "wallet" : "bank"),
      confirmed: "your withdrawal is complete"
    };
    var idx = order.indexOf(w.state);
    return order.map(function (k, i) {
      return { label: labels[k], sub: subs[k],
        state: i < idx ? "done" : i === idx ? (w.state === "confirmed" ? "done" : "active") : "todo",
        time: UI.fmtTs(w.stamps[k]) };
    });
  }

  var WL_STATE = {
    needs_tr: "Travel-rule information incomplete",
    pending: "Pending review",
    verified: "Verified",
    test_sent: "Test sent · confirm the amount",
    tested: "Tested · available as a destination",
    rejected: "Rejected"
  };

  function wlStages(o) {
    var reg = { label: "Registered", sub: o.net ? "screened at entry" : "submitted for review", state: "done", time: UI.fmtTs(o.added) };
    var now = { label: WL_STATE[o.state] || o.state,
      sub: o.reason || (o.missing && o.missing.length ? "missing: " + o.missing.join(", ") : ""),
      state: o.state === "rejected" ? "failed" : (o.state === "tested" || o.state === "verified") ? "done" : "pending" };
    return [reg, now];
  }

  // ————— facts + next step —————

  function defRow(label, valueHtml, strong) {
    return '<div class="def-row"><span class="def-label">' + UI.esc(label) + "</span>" +
      '<span class="def-value' + (strong ? " strong" : "") + '">' + valueHtml + "</span></div>";
  }

  function tradeFacts(t) {
    return defRow("Order", UI.esc(t.id), true) +
      defRow("Side", (t.side === "buy" ? "Buy" : "Sell") + " USDT · " + UI.esc(t.pair)) +
      defRow("Locked rate", rate4(t.rate), true) +
      defRow("USDT", UI.money("USDT", t.assetAmt, { dp: 0 })) +
      defRow(Data.fiatOf(t.pair), UI.money(Data.fiatOf(t.pair), t.fiatAmt)) +
      defRow("Booked by", t.byDesk ? "the desk, on your instruction" : "you, in the portal");
  }

  function depFacts(d) {
    return defRow("Deposit", UI.esc(d.id), true) +
      defRow("Amount", UI.money(d.cur, d.amount)) +
      defRow("Sender", UI.esc(d.sender || "—")) +
      defRow("Route", d.via === "bank" ? "bank transfer to your vIBAN" : "on-chain transfer") +
      defRow("Detected", UI.esc(UI.fmtTs(d.ts)));
  }

  function wdFacts(w) {
    return defRow("Withdrawal", UI.esc(w.id), true) +
      defRow("Amount", UI.money(w.cur, w.amount)) +
      defRow("Destination", UI.esc(w.dest)) +
      defRow("Submitted", UI.esc(UI.fmtTs(w.ts))) +
      defRow("Window", UI.esc(w.state === "confirmed" ? "completed" : Data.windowCopy()));
  }

  function wlFacts(o) {
    if (o.net) {
      return defRow("Wallet", UI.esc(o.label), true) +
        defRow("Network", UI.esc(o.net)) +
        defRow("Address", '<span class="mono">' + UI.esc(o.addr.slice(0, 10) + "…" + o.addr.slice(-6)) + "</span>") +
        defRow("Added", UI.esc(UI.fmtDate(o.added)));
    }
    return defRow("Bank", UI.esc(o.bank), true) +
      defRow("IBAN", '<span class="mono">' + UI.esc(o.iban) + "</span>") +
      defRow("Account name", UI.esc(o.title)) +
      defRow("Currency", UI.esc(o.cur)) +
      defRow("Added", UI.esc(UI.fmtDate(o.added)));
  }

  function nextStep(r) {
    if (r.kind === "trade" && r.obj.state === "awaiting") {
      return '<div class="hx-next"><button class="btn btn-secondary btn-sm" data-go="move" type="button">View your deposit details</button>' +
        '<p class="freshline mt-8">Fund within 24 hours or the order lapses.</p></div>';
    }
    if (r.kind === "dep" && (r.obj.state === "held" || r.obj.state === "ident")) {
      return '<div class="hx-next"><button class="btn btn-secondary btn-sm" data-go="move" type="button">' +
        (r.obj.state === "held" ? "Confirm the sending account" : "See the identification") + "</button>" +
        '<p class="freshline mt-8">Excluded from your available balance until the sender is confirmed.</p></div>';
    }
    if (r.kind === "wl" && r.obj.state === "rejected") {
      return '<div class="hx-next"><button class="btn btn-secondary btn-sm" data-go="whitelist" type="button">Open your whitelist</button>' +
        '<p class="freshline mt-8">' + UI.esc(r.obj.reason || "") + "</p></div>";
    }
    return "";
  }

  // ————— rows —————

  // the amount cell is where currency identity lives: swatch, then the figure.
  // No hue on the figure itself — the swatch owns this cell's colour, and the
  // dimmed .pending treatment still says "in flight, not yours yet".
  function amountCell(cur, html) {
    return '<span class="hx-amt">' + (cur && cur !== "—" ? ccy(cur, { label: false }) : "") + html + "</span>";
  }

  function buildRows() {
    var S = Data.state;
    var rows = [];

    S.trades.forEach(function (t) {
      var st = t.state === "settled" ? { kind: "positive", label: "Settled" }
        : t.state === "settling" ? { kind: "info", label: "Settling" }
        : { kind: "warning", label: "Awaiting funding" };
      rows.push({
        kind: "trade", key: "trade:" + t.id, id: t.id, ts: t.ts, cur: Data.fiatOf(t.pair), obj: t,
        typeLabel: "Trade",
        title: (t.side === "buy" ? "Buy " : "Sell ") + UI.fmtNum(t.assetAmt, 0) + " USDT at " + rate4(t.rate),
        sub: t.pair + (t.byDesk ? " · booked by the desk" : ""),
        status: st, bucket: t.state === "settled" ? "done" : t.state === "awaiting" ? "held" : "inflight",
        // buy / sell never takes colour: the sign and the word carry it
        amountHtml: '<span class="amount' + (t.state === "settled" ? "" : " pending") + '">' +
          UI.money(Data.fiatOf(t.pair), t.fiatAmt, { sign: t.side === "buy" ? "−" : "+" }) + "</span>",
        csvAmt: (t.side === "buy" ? "-" : "+") + t.fiatAmt.toFixed(2),
        stages: tradeStages(t), facts: tradeFacts(t)
      });
    });

    S.deposits.forEach(function (d) {
      var st = d.state === "credited" ? { kind: "positive", label: "Credited" }
        : d.state === "held" ? { kind: "error", label: "Held for identification" }
        // the desk is working on it, so this is in process, not waiting on you
        : d.state === "ident" ? { kind: "info", label: "Identification under review" }
        : { kind: "info", label: d.state === "detected" ? "Detected" : "Processing" };
      rows.push({
        kind: "dep", key: "dep:" + d.id, id: d.id, ts: d.ts, cur: d.cur, obj: d,
        typeLabel: "Deposit", title: "Deposit " + d.id, sub: d.sender || (d.via === "bank" ? "bank transfer" : "on-chain"),
        status: st, bucket: d.state === "credited" ? "done" : (d.state === "held" || d.state === "ident") ? "held" : "inflight",
        amountHtml: '<span class="amount' + (d.state === "credited" ? "" : " pending") + '">' + UI.money(d.cur, d.amount, { sign: "+" }) + "</span>",
        csvAmt: "+" + d.amount.toFixed(2),
        stages: depStages(d), facts: depFacts(d)
      });
    });

    S.withdrawals.forEach(function (w) {
      var st = w.state === "confirmed" ? { kind: "positive", label: "Confirmed" }
        : { kind: "info", label: { submitted: "Submitted", servicing: "Processing", sent: "Sent" }[w.state] };
      rows.push({
        kind: "wd", key: "wd:" + w.id, id: w.id, ts: w.ts, cur: w.cur, obj: w,
        typeLabel: "Withdrawal", title: "Withdrawal " + w.id, sub: w.dest,
        status: st, bucket: w.state === "confirmed" ? "done" : "inflight",
        // outbound money is never red: red means failed, not leaving
        amountHtml: '<span class="amount' + (w.state === "confirmed" ? "" : " pending") + '">' + UI.money(w.cur, w.amount, { sign: "−" }) + "</span>",
        csvAmt: "-" + w.amount.toFixed(2),
        stages: wdStages(w), facts: wdFacts(w)
      });
    });

    S.wallets.forEach(function (o) {
      rows.push({
        kind: "wl", key: "wl:" + o.id, id: o.id, ts: o.added, cur: "—", obj: o,
        typeLabel: "Whitelist", title: "Wallet " + o.label, sub: o.net + " · " + o.addr.slice(0, 8) + "…" + o.addr.slice(-4),
        status: o.state === "rejected" ? { kind: "error", label: WL_STATE.rejected }
          : (o.state === "tested" || o.state === "verified") ? { kind: "positive", label: WL_STATE[o.state] }
          : { kind: "warning", label: WL_STATE[o.state] || o.state },
        bucket: (o.state === "tested" || o.state === "verified") ? "done" : (o.state === "rejected" || o.state === "needs_tr") ? "held" : "inflight",
        amountHtml: '<span class="amount hx-nil">—</span>', csvAmt: "",
        stages: wlStages(o), facts: wlFacts(o)
      });
    });

    S.banks.forEach(function (o) {
      rows.push({
        kind: "wl", key: "wl:" + o.id, id: o.id, ts: o.added, cur: o.cur, obj: o,
        typeLabel: "Whitelist", title: "Bank account " + o.bank, sub: o.iban.slice(0, 8) + " ···· " + o.iban.slice(-3) + " · " + o.cur,
        status: o.state === "verified" ? { kind: "positive", label: WL_STATE.verified }
          : o.state === "rejected" ? { kind: "error", label: WL_STATE.rejected }
          : { kind: "warning", label: WL_STATE.pending },
        bucket: o.state === "verified" ? "done" : o.state === "rejected" ? "held" : "inflight",
        amountHtml: '<span class="amount hx-nil">—</span>', csvAmt: "",
        stages: wlStages(o), facts: wlFacts(o)
      });
    });

    rows = rows.filter(function (r) {
      return (F.type === "all" || r.kind === F.type) &&
        (F.cur === "all" || r.cur === F.cur) &&
        (F.status === "all" || r.bucket === F.status);
    });
    rows.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
    return rows;
  }

  // ————— painting —————

  // Event + Type are the identity group and are capped; the spacer takes the
  // panel's surplus; status, date and amount are content-width and adjacent,
  // so they land at the same x as the dashboard's activity table.
  var COLS = [
    { label: "Event", w: "minmax(0, 290px)" },
    { label: "Type", w: "90px" },
    { spacer: true },
    { label: "Status", w: "190px" },
    { label: "Date", w: "105px" },
    { label: "Amount", w: "175px", right: true }
  ];

  function detailHtml(r) {
    return '<div class="hx-detail"><div class="hx-detail-cols">' +
      '<div><div class="hx-detail-head">Lifecycle</div>' + UI.timeline(r.stages) + "</div>" +
      '<div><div class="hx-detail-head">Details</div>' + r.facts + nextStep(r) + "</div>" +
      "</div></div>";
  }

  // opts: { fade } the content genuinely changed (a filter), so fade it in ·
  //       { justOpened } a row was expanded: swap without a fade and animate
  //       only the inserted detail, so the row being read never flashes.
  function paintTable(opts) {
    opts = opts || {};
    var host = document.getElementById("hxTable");
    if (!host) return;
    var rows = buildRows();
    lastRows = rows;

    // the archive is time-ordered, newest first, so it groups by day
    var tableRows = [], day = null;
    rows.forEach(function (r) {
      var open = !!F.open[r.key];
      var dl = UI.dayLabel(r.ts);
      if (dl !== day) { day = dl; tableRows.push({ group: dl }); }
      tableRows.push({
        key: r.key, clickable: true, selected: open, cls: "hx-row" + (open ? " open" : ""),
        cells: [
          '<span class="cell-main">' + icon("chevronRight", 12, "hx-caret") +
            '<span class="hx-main-txt"><span class="name">' + UI.esc(r.title) + "</span>" +
            '<span class="desc">' + UI.esc(r.sub) + "</span></span></span>",
          // the Type column stays a neutral tag: currency owns colour here
          '<span class="tag">' + UI.esc(r.typeLabel) + "</span>",
          UI.statusDot(r.status.kind, r.status.label),
          '<span class="date">' + UI.esc(UI.fmtTs(r.ts)) + "</span>",
          amountCell(r.cur, r.amountHtml)
        ]
      });
      if (open) tableRows.push({ key: "detail:" + r.key, cls: "hx-open", cells: [detailHtml(r)] });
    });

    var html = UI.table({
      cols: COLS, rows: tableRows,
      empty: "Nothing matches these filters."
    }) +
      '<p class="freshline mt-8">' + rows.length + (rows.length === 1 ? " entry" : " entries") +
        " shown. Select a row for its lifecycle." +
      (Data.state.stale ? " Live feed interrupted; in-flight states re-sync automatically." : "") + "</p>";

    if (opts.fade) repaint(host, html);
    else host.innerHTML = html;

    if (opts.justOpened) {
      var row = host.querySelector('[data-key="detail:' + opts.justOpened + '"] .hx-detail');
      if (row) row.classList.add("rise-local");
    }

    host.querySelectorAll(".row.hx-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var k = row.getAttribute("data-key");
        var nowOpen = !F.open[k];
        F.open[k] = nowOpen;
        paintTable({ justOpened: nowOpen ? k : null });
      });
    });
    host.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        App.go(b.getAttribute("data-go"));
      });
    });
  }

  // ————— saving a file — one path, two callers —————

  // Hosted as an artifact, a page cannot start its own download: the viewer
  // hands the file over instead. Served as a normal static site, that host
  // is absent and the anchor works.
  function saveFile(name, text, done, declined) {
    function saveLocally() {
      var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      done();
    }
    if (window.claude && window.claude.use) {
      window.claude.use("downloads").then(function (dl) {
        if (!dl) { saveLocally(); return; }
        dl.save({ filename: name, data: text }).then(done).catch(function (err) {
          if (err && err.code === "declined") { if (declined) declined(); return; }
          saveLocally();
        });
      }).catch(saveLocally);
      return;
    }
    saveLocally();
  }

  function csvCell(s) { return '"' + String(s == null ? "" : s).replace(/"/g, "'") + '"'; }

  function exportCsv() {
    var count = lastRows.length;
    if (!count) {
      UI.toast("Nothing to export with these filters.", "blocked");
      return;
    }
    var lines = ["id,type,description,status,currency,amount,date"];
    lastRows.forEach(function (r) {
      lines.push([r.id, r.kind, csvCell(r.title), r.bucket, r.cur, r.csvAmt, r.ts].join(","));
    });
    saveFile("prime-history-export.csv", lines.join("\n"), function () {
      UI.toast("CSV exported: " + count + (count === 1 ? " row." : " rows."), "done");
    });
  }

  // ————— the statement document —————
  // Every figure is derived from the ledger, never seeded separately: the
  // closing balance is today's balance rewound past every movement after the
  // period end, and the opening balance is the closing minus the period's net
  // movement. So the paper cannot disagree with the dashboard.

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  function periodWindow(period) {
    var m = /^([A-Za-z]+)\s+(\d{4})/.exec(period || "");
    var idx = m ? MONTH_NAMES.indexOf(m[1]) : -1;
    var now = new Date();
    if (idx < 0) return { start: new Date(0), end: now, truncated: true };
    var start = new Date(+m[2], idx, 1, 0, 0, 0, 0);
    var end = new Date(+m[2], idx + 1, 1, 0, 0, 0, 0);
    // "to date" only says "to date" while the month is genuinely still open;
    // once it has closed, the period is the whole month and reads as one
    var truncated = /to date/i.test(period) && now < end;
    if (truncated) end = now;
    return { start: start, end: end, truncated: truncated };
  }

  // every balance movement in one currency, value-dated the way the ledger
  // actually moves: a deposit on its credit stamp, a withdrawal on submit
  // (that is when it leaves available), a trade's pay leg on funding and its
  // proceeds on settlement.
  function movements(cur) {
    var out = [];
    Data.state.deposits.forEach(function (d) {
      if (d.cur !== cur || d.state !== "credited" || !d.crTs) return;
      out.push({ ts: d.crTs, ref: d.id, desc: "Deposit credited",
        sub: d.via === "bank" ? "bank transfer · " + (d.sender || "") : "on-chain transfer · " + (d.sender || ""),
        delta: d.amount });
    });
    Data.state.withdrawals.forEach(function (w) {
      if (w.cur !== cur) return;
      out.push({ ts: w.stamps.submitted || w.ts, ref: w.id, desc: "Withdrawal",
        sub: w.dest + (w.state === "confirmed" ? " · confirmed" : " · in flight"),
        delta: -w.amount });
    });
    Data.state.trades.forEach(function (t) {
      var f = Data.fiatOf(t.pair);
      var payCur = t.side === "buy" ? f : "USDT";
      var payAmt = t.side === "buy" ? t.fiatAmt : t.assetAmt;
      var recvCur = t.side === "buy" ? "USDT" : f;
      var recvAmt = t.side === "buy" ? t.assetAmt : t.fiatAmt;
      if (payCur === cur && t.stamps.funded) {
        out.push({ ts: t.stamps.funded, ref: t.id, desc: "Trade funded · " + (t.side === "buy" ? "buy" : "sell") + " USDT",
          sub: t.pair + " at " + rate4(t.rate) + (t.byDesk ? " · booked by the desk" : ""), delta: -payAmt });
      }
      if (recvCur === cur && t.stamps.settled) {
        out.push({ ts: t.stamps.settled, ref: t.id, desc: "Trade proceeds",
          sub: t.pair + " at " + rate4(t.rate) + " · released to available", delta: recvAmt });
      }
    });
    out.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
    return out;
  }

  function statement(period, cur) {
    var win = periodWindow(period);
    var rows = [], after = 0, credits = 0, debits = 0;
    movements(cur).forEach(function (mv) {
      var t = new Date(mv.ts);
      if (t >= win.start && t < win.end) rows.push(mv);
      else if (t >= win.end) after += mv.delta;
    });
    var closing = (Data.state.bal[cur] || 0) - after;
    rows.forEach(function (mv) {
      if (mv.delta >= 0) credits += mv.delta; else debits += -mv.delta;
    });
    var opening = closing - (credits - debits);
    var run = opening;
    rows.forEach(function (mv) { run += mv.delta; mv.balance = run; });
    return { win: win, rows: rows, opening: opening, closing: closing, credits: credits, debits: debits, cur: cur, period: period };
  }

  function scopesFor(period) {
    return Data.state.statements.filter(function (s) { return s.period === period; })
      .map(function (s) { return s.scope; });
  }

  function periodLine(win) {
    return UI.fmtDate(win.start.toISOString()) + " to " + UI.fmtDate(new Date(win.end.getTime() - 1).toISOString()) +
      (win.truncated ? " · to date" : "");
  }

  function balCell(label, cur, n, strong) {
    return '<div' + (strong ? ' class="doc-bal-strong"' : "") + '><span class="doc-k">' + UI.esc(label) + "</span>" +
      '<span class="doc-bal-v">' + UI.moneyHero(cur, n) + "</span></div>";
  }

  function paperHtml(period, cur) {
    var st = statement(period, cur);
    var v = Data.VIBANS[cur];
    var rows = st.rows.map(function (mv) {
      return "<tr><td>" + UI.esc(UI.fmtDate(mv.ts)) + "</td>" +
        "<td>" + UI.esc(mv.desc) + '<span class="doc-sub">' + UI.esc(mv.ref + " · " + mv.sub) + "</span></td>" +
        '<td class="r num">' + (mv.delta < 0 ? UI.fmtNum(-mv.delta) : "") + "</td>" +
        '<td class="r num">' + (mv.delta >= 0 ? UI.fmtNum(mv.delta) : "") + "</td>" +
        '<td class="r num">' + UI.fmtNum(mv.balance) + "</td></tr>";
    }).join("");

    return '<div class="doc-head"><div>' +
        '<span class="doc-brand"><svg class="doc-lock" viewBox="0 0 160 28" fill="currentColor" aria-label="Fasset">' +
          '<use href="#brand-lockup"/></svg><span class="doc-biz">Prime</span></span>' +
        '<div class="doc-entity">' + UI.esc(Data.state.user.entity) + "</div>" +
      '</div><div class="doc-head-right">' +
        '<div class="doc-title">Statement of account</div>' +
        '<div class="doc-period">' + UI.esc(period) + "</div>" +
        '<div class="doc-period">' + UI.esc(periodLine(st.win)) + "</div>" +
      "</div></div>" +

      '<div class="doc-meta">' +
        '<div><span class="doc-k">Account name</span>' +
          // verbatim: the sending bank's confirmation-of-payee check fails on
          // any styled or edited version of this string
          '<span class="doc-v doc-verbatim">' + UI.esc(Data.ACCOUNT_NAME) + "</span></div>" +
        "<div><span class=\"doc-k\">" + (cur === "USDT" ? "Custody" : "Deposit reference") + "</span>" +
          '<span class="doc-v' + (v ? " mono" : "") + '">' +
          UI.esc(cur === "USDT" ? "Fasset custody · TRC20 and ERC20" : (v ? v.iban : "—")) + "</span></div>" +
        // a hosted paper surface, so the tinted chip variant is legitimate here
        '<div><span class="doc-k">Currency</span><span class="doc-v">' + ccy(cur, { chip: true }) + "</span></div>" +
      "</div>" +

      '<div class="doc-balances">' +
        balCell("Opening balance", cur, st.opening) +
        balCell("Credits in", cur, st.credits) +
        balCell("Debits out", cur, st.debits) +
        balCell("Closing balance", cur, st.closing, true) +
      "</div>" +

      '<table class="doc-table"><thead><tr>' +
        '<th style="width:96px">Date</th><th>Description</th>' +
        '<th class="r" style="width:112px">Debit</th>' +
        '<th class="r" style="width:112px">Credit</th>' +
        '<th class="r" style="width:124px">Balance</th>' +
      "</tr></thead><tbody>" +
        '<tr class="doc-opening"><td>' + UI.esc(UI.fmtDate(st.win.start.toISOString())) + "</td>" +
          "<td>Opening balance</td><td></td><td></td>" +
          '<td class="r num">' + UI.fmtNum(st.opening) + "</td></tr>" +
        (st.rows.length ? rows :
          '<tr><td colspan="5" class="doc-empty">No movements in this period. The balance carried forward unchanged.</td></tr>') +
        '<tr class="doc-closing"><td>' + UI.esc(UI.fmtDate(new Date(st.win.end.getTime() - 1).toISOString())) + "</td>" +
          "<td>Closing balance</td>" +
          '<td class="r num">' + UI.fmtNum(st.debits) + "</td>" +
          '<td class="r num">' + UI.fmtNum(st.credits) + "</td>" +
          '<td class="r num">' + UI.fmtNum(st.closing) + "</td></tr>" +
      "</tbody></table>" +

      '<div class="doc-summary">' +
        '<div class="doc-sum-row"><span>Summary · ' + UI.esc(cur) + "</span><span>" + st.rows.length +
          (st.rows.length === 1 ? " entry" : " entries") + "</span></div>" +
        '<div class="doc-sum-row"><span>Credits</span><span>' + UI.money(cur, st.credits) + "</span></div>" +
        '<div class="doc-sum-row"><span>Debits</span><span>' + UI.money(cur, st.debits) + "</span></div>" +
        '<div class="doc-sum-row"><span class="strong">Net movement</span><span class="strong">' +
          UI.money(cur, st.credits - st.debits, { sign: st.credits - st.debits < 0 ? "−" : "+" }) + "</span></div>" +
      "</div>" +

      '<div class="doc-foot"><p>This is a statement of client money. Balances are held by Fasset in ' +
        UI.esc(Data.ACCOUNT_NAME) + ", separately from Fasset’s own funds. In-flight amounts are shown on the date they left your available balance.</p>" +
        "<p>Zand Bank · Dubai, UAE</p></div>";
  }

  // ————— the overlay: a document viewer, not a modal —————
  // It holds no form and takes no decision, which is why it is not a
  // UI.drawer. Esc and the scrim close it; focus returns to the row you
  // opened it from. It sits above the toast, so its own confirmations land
  // in the toolbar rather than behind the scrim.

  var docEl = null, docPeriod = null, docCur = null, docTrigger = null, docKey = null;

  function docMsg(text) {
    if (!docEl) return;
    var m = docEl.querySelector("#docMsg");
    if (m) m.textContent = text || "";
  }

  function toolbarHtml() {
    var scopes = scopesFor(docPeriod);
    return '<div class="doc-toolbar"><div class="doc-scopes">' +
      scopes.map(function (c) {
        return '<button class="doc-scope' + (c === docCur ? " active" : "") + '" data-scope="' +
          UI.esc(c) + '" type="button">' + ccy(c) + "</button>";
      }).join("") +
      '</div><div class="doc-tools"><span class="doc-msg" id="docMsg" aria-live="polite"></span>' +
      '<button class="link" id="docCsv" type="button">' + icon("download", 12) + "Download rows (CSV)</button>" +
      '<button class="btn btn-ghost" id="docClose" type="button" aria-label="Close statement">' + icon("close", 14) + "</button>" +
      "</div></div>";
  }

  function paintPaper() {
    if (!docEl) return;
    repaint(docEl.querySelector("#docPaper"), paperHtml(docPeriod, docCur));
  }

  function onDocKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); closeStatement(); }
  }

  function openStatement(period, cur, trigger) {
    if (docEl) closeStatement(true);
    docPeriod = period; docCur = cur; docTrigger = trigger || null;
    docEl = document.createElement("div");
    docEl.className = "doc-overlay";
    docEl.setAttribute("role", "dialog");
    docEl.setAttribute("aria-modal", "true");
    docEl.setAttribute("aria-label", "Statement of account · " + period + " · " + cur);
    docEl.innerHTML = '<div class="doc-scrim"></div><div class="doc-scroll"><div class="doc-sheet">' +
      toolbarHtml() + '<div class="doc-paper" id="docPaper">' + paperHtml(period, cur) + "</div></div></div>";
    document.body.appendChild(docEl);
    requestAnimationFrame(function () { if (docEl) docEl.classList.add("open"); });

    docEl.querySelector(".doc-scrim").addEventListener("click", function () { closeStatement(); });
    docEl.querySelector("#docClose").addEventListener("click", function () { closeStatement(); });
    docEl.querySelector("#docCsv").addEventListener("click", statementCsv);
    wireScopes();
    docKey = onDocKey;
    document.addEventListener("keydown", docKey, true);
    docEl.querySelector("#docClose").focus();
  }

  function wireScopes() {
    if (!docEl) return;
    docEl.querySelectorAll("[data-scope]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-scope");
        if (c === docCur) return;
        docCur = c;
        docEl.querySelectorAll("[data-scope]").forEach(function (x) {
          x.classList.toggle("active", x.getAttribute("data-scope") === docCur);
        });
        docMsg("");
        paintPaper();
      });
    });
  }

  function closeStatement(immediate) {
    if (!docEl) return;
    var el = docEl;
    docEl = null;
    if (docKey) { document.removeEventListener("keydown", docKey, true); docKey = null; }
    el.classList.remove("open");
    // the exit runs at roughly half the entrance; the removal timer matches it
    if (immediate) el.remove();
    else setTimeout(function () { el.remove(); }, 150);
    if (docTrigger && document.body.contains(docTrigger)) docTrigger.focus();
    docTrigger = null;
  }

  function statementCsv() {
    var st = statement(docPeriod, docCur);
    var lines = ["date,reference,description,debit,credit,balance,currency"];
    lines.push([st.win.start.toISOString(), "", csvCell("Opening balance"), "", "", st.opening.toFixed(2), st.cur].join(","));
    st.rows.forEach(function (mv) {
      lines.push([mv.ts, mv.ref, csvCell(mv.desc + " · " + mv.sub),
        mv.delta < 0 ? (-mv.delta).toFixed(2) : "", mv.delta >= 0 ? mv.delta.toFixed(2) : "",
        mv.balance.toFixed(2), st.cur].join(","));
    });
    lines.push([new Date(st.win.end.getTime() - 1).toISOString(), "", csvCell("Closing balance"),
      st.debits.toFixed(2), st.credits.toFixed(2), st.closing.toFixed(2), st.cur].join(","));

    var name = "prime-statement-" + st.cur.toLowerCase() + "-" +
      String(st.period).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".csv";
    saveFile(name, lines.join("\n"),
      function () { docMsg(st.rows.length + (st.rows.length === 1 ? " row saved." : " rows saved.")); },
      function () { docMsg("Download declined. Nothing was saved."); });
  }

  // ————— render —————

  function skeletonHtml() {
    return '<div class="section">' + UI.skel("320px", "34px") +
      '<div class="mt-24">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      "</div>";
  }

  function render(el) {
    // the head-right action is rebuilt with the page head, so it is wired here
    var csv = el.querySelector("#hxCsv");
    if (csv) csv.addEventListener("click", exportCsv);

    if (!loadedOnce) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 340);
      return;
    }
    renderBody(el);
  }

  function sel(id, label, opts, value) {
    return '<select class="select tx-select" id="' + id + '" aria-label="' + UI.esc(label) + '">' +
      opts.map(function (o) {
        return '<option value="' + o[0] + '"' + (value === o[0] ? " selected" : "") + ">" + UI.esc(o[1]) + "</option>";
      }).join("") + "</select>";
  }

  function renderBody(el) {
    var h = "";

    // — the archive —
    h += '<div class="section"><div class="section-head"><h2>Archive</h2>' +
      '<span class="link">newest first, one entry per event</span></div>' +
      '<div class="tx-toolbar">' +
        sel("hxType", "Type", [["all", "All types"], ["trade", "Trades"], ["dep", "Deposits"], ["wd", "Withdrawals"], ["wl", "Whitelist events"]], F.type) +
        // a <select> cannot carry the currency swatch, so this filter stays
        // typographic; the swatch does its work in the amount column
        sel("hxCur", "Currency", [["all", "All currencies"], ["AED", "AED"], ["USD", "USD"], ["GBP", "GBP"], ["USDT", "USDT"]], F.cur) +
        sel("hxStatus", "Status", [["all", "Any status"], ["inflight", "In flight"], ["done", "Completed"], ["held", "Needs attention"]], F.status) +
      "</div>" +
      '<div id="hxTable"></div>' +
      "</div>";

    // — statements, per currency —
    var byCur = {};
    Data.state.statements.forEach(function (s) {
      (byCur[s.scope] = byCur[s.scope] || []).push(s);
    });
    var stmtRows = [], groupHtml = [];
    Object.keys(byCur).forEach(function (cur) {
      stmtRows.push({ group: cur + " · " + Data.state.user.entity });
      // UI.table escapes group labels, so the swatch is injected after the
      // fact, one node per group, in the same order they were pushed
      groupHtml.push('<span class="hx-stmt-group">' + ccy(cur) + " · " + UI.esc(Data.state.user.entity) + "</span>");
      byCur[cur].forEach(function (s) {
        var n = statement(s.period, cur).rows.length;
        stmtRows.push({
          key: "stmt:" + cur + ":" + s.period,
          cells: [
            '<span class="cell-main"><span class="hx-main-txt"><span class="name">' + UI.esc(s.period) + "</span>" +
              '<span class="desc">statement of account · ' + UI.esc(cur) + "</span></span></span>",
            '<span class="desc">' + n + (n === 1 ? " entry" : " entries") + "</span>",
            '<span class="c-right"><button class="link" data-stmt-period="' + UI.esc(s.period) +
              '" data-stmt-cur="' + UI.esc(cur) + '" type="button">' + icon("document", 12) + "Open</button></span>"
          ]
        });
      });
    });

    h += '<div class="section"><div class="section-head"><h2>Statements</h2>' +
      '<span class="link">issued monthly, per currency</span></div>' +
      '<div id="hxStmt"></div></div>';

    // — demo affordances: lifecycle pushes from the bank, the chain and the desk —
    h += '<div class="section"><div class="demo-strip">' +
      '<span class="freshline">Demo · lifecycle pushes from the bank, chain and desk.</span>' +
      '<button class="db-btn" id="hxCredit" type="button">Webhook: oldest processing deposit credited</button>' +
      '<button class="db-btn" id="hxAdvance" type="button">Desk: advance oldest in-flight withdrawal</button>' +
      '<button class="db-btn" id="hxSettle" type="button">Fast-forward: settlement window elapses</button>' +
      "</div></div>";

    el.insertAdjacentHTML("beforeend", h);
    paintTable();

    // statements table, then the group-label swatches
    var stmtHost = el.querySelector("#hxStmt");
    stmtHost.innerHTML = UI.table({
      cols: [
        { label: "Period", w: "minmax(0, 320px)" },
        { spacer: true },
        { label: "Entries", w: "110px" },
        { label: "", w: "140px", right: true }
      ],
      rows: stmtRows,
      empty: "No statements yet."
    });
    stmtHost.querySelectorAll(".group-label").forEach(function (g, i) {
      if (groupHtml[i]) g.innerHTML = groupHtml[i];
    });
    stmtHost.querySelectorAll("[data-stmt-period]").forEach(function (b) {
      b.addEventListener("click", function () {
        openStatement(b.getAttribute("data-stmt-period"), b.getAttribute("data-stmt-cur"), b);
      });
    });

    ["hxType", "hxCur", "hxStatus"].forEach(function (id) {
      var s = el.querySelector("#" + id);
      s.addEventListener("change", function () {
        F[id === "hxType" ? "type" : id === "hxCur" ? "cur" : "status"] = s.value;
        paintTable({ fade: true });
      });
    });

    var on = function (id, fn) { var b = el.querySelector("#" + id); if (b) b.addEventListener("click", fn); };
    on("hxCredit", function () { if (!Data.creditOldest()) UI.toast("No deposit is processing right now.", "blocked"); });
    on("hxAdvance", function () { if (!Data.advanceWithdrawal()) UI.toast("No withdrawal in flight.", "blocked"); });
    on("hxSettle", function () { if (!Data.settleOrder()) UI.toast("Nothing settling. Place and fund an order first.", "blocked"); });
  }

  App.registerScreen("history", {
    title: "History",
    subtitle: "One entry per trade, deposit, withdrawal and whitelist event",
    zone: "app",
    actions: function () {
      return '<button class="btn btn-secondary" id="hxCsv" type="button">' + icon("download", 14) + "Export CSV</button>";
    },
    render: render,
    onData: function (scope) {
      // the statement paper is derived from the ledger, so it re-derives
      // rather than going stale behind the reader
      if (docEl) paintPaper();
      // a notification landing must not collapse an open lifecycle row
      return scope === "notifs";
    }
  });
})();
