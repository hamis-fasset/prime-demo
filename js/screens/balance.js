/* ————————————————————————————————————————————————
   Fasset Prime — Balances (per-currency view). Added with IA v2
   (2026-09-03); promoted to the Money nav the same day (Hamis):
   currency pills switch the view, the balance hero, its statements,
   and its ledger. Rows open the shared details drawer.

   Deposit and Withdraw both start HERE (Hamis 2026-09-03): Deposit
   opens a sheet (side sheet on web, bottom sheet on the phone — the
   drawer grammar app-wide) with the copy-ready details; Withdraw
   hands off to the withdraw screen preset to this currency. The
   deposit details no longer sit on the page: too much, especially
   on the phone.

   The statement document (overlay, derived entirely from the ledger)
   moved here from the deleted History screen; the statement's CSV
   download is the product's one export, per Hamis 2026-09-03.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var CUR = "AED";
  var NET = "TRC20";
  var ROOT = null;

  var CURS = ["AED", "USD", "EUR", "BHD", "USDT"];

  function name(c) { return Data.curName ? Data.curName(c) : c; }
  function ccy(cur, opts) { return UI.ccy ? UI.ccy(cur, opts) : UI.esc(cur); }
  function rate4(r) { return Number(r).toFixed(4); }
  function repaint(el, html) { if (!el) return; if (UI.repaint) UI.repaint(el, html); else el.innerHTML = html; }
  function region(id) { return ROOT ? ROOT.querySelector('[data-balsec="' + id + '"]') : null; }
  function phone() { return !!(App.isPhone && App.isPhone()); }
  // the day is a sticky group label above the row on the phone, so the meta
  // slot carries the time alone; desktop keeps the full stamp
  function stamp(ts) { return phone() ? UI.fmtTime(ts) : UI.fmtTs(ts); }

  // ————— currency pills: this screen is the home of every balance —————

  function pillsHtml() {
    var o = Data.state.balOrder && Data.state.balOrder.length === CURS.length ? Data.state.balOrder : CURS;
    return '<div class="bal-pills">' + o.map(function (c) {
      return '<button class="bal-pill' + (c === CUR ? " active" : "") + '" data-balcur="' + c + '" type="button">' +
        ccy(c) + "</button>";
    }).join("") + "</div>";
  }

  // ————— hero: one quiet name line, then the figure —————

  function heroHtml() {
    var live = Data.railLive(CUR);
    return '<div class="bal-hero"><div>' +
      '<div class="bal-label">' + UI.esc(name(CUR)) + " balance</div>" +
      '<div class="bal-value">' + (live ? UI.moneyHero(CUR, Data.state.bal[CUR] || 0, { symbol: true }) : "—") + "</div>" +
      (live ? "" : '<div class="bal-delta">' + UI.statusDot("neutral", "not yet live") + "</div>") +
      "</div></div>";
  }

  // ————— deposit: a sheet, not a page section —————

  function depositBody() {
    if (CUR === "USDT") {
      return '<div class="seg" style="margin-bottom:16px">' +
          ["TRC20", "ERC20"].map(function (n) {
            return '<button class="seg-btn' + (NET === n ? " active" : "") + '" data-net="' + n + '" type="button">' +
              (n === "TRC20" ? "TRC20 · Tron" : "ERC20 · Ethereum") + "</button>";
          }).join("") +
        "</div>" +
        UI.copyRow("Address", Data.USDT_ADDRS[NET], { mono: true, copy: Data.USDT_ADDRS[NET] }) +
        '<div class="copy-row"><span class="cr-label">Custody</span><span class="cr-value">Fasset custody</span></div>';
    }
    var v = Data.VIBANS[CUR];
    return UI.copyRow("IBAN", v.iban, { mono: true, copy: v.copy }) +
      // verbatim: the sending bank checks this string against ours
      UI.copyRow("Account name", Data.ACCOUNT_NAME, { copy: Data.ACCOUNT_NAME }) +
      '<div class="copy-row"><span class="cr-label">Bank</span><span class="cr-value">Zand Bank · Dubai, UAE</span></div>';
  }

  function openDeposit() {
    if (!Data.railLive(CUR)) return;
    var h = UI.drawer("Deposit " + name(CUR), "", {
      width: 480,
      foot: '<button class="btn btn-secondary" id="bdClose" type="button">Close</button>'
    });
    function paintBody() {
      h.body.innerHTML = depositBody();
      h.body.querySelectorAll("[data-net]").forEach(function (b) {
        b.addEventListener("click", function () { NET = b.getAttribute("data-net"); paintBody(); });
      });
    }
    paintBody();
    h.el.querySelector("#bdClose").addEventListener("click", h.close);
  }

  // ————— statements (ported from the deleted History screen) —————
  // Every figure derives from the ledger: the closing balance is today's
  // balance rewound past every later movement, so the paper can never
  // disagree with the dashboard.

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  function periods() {
    var out = [];
    Data.state.statements.forEach(function (s) {
      if (out.indexOf(s.period) < 0) out.push(s.period);
    });
    return out;
  }

  // A period is a row, not a label with an "Open" link beside it: the whole
  // row is the tap target (a link is a 40px target inside a 56px row that
  // does the same thing), and it inherits the table grammar — 56px rows, the
  // header hairline, and the phone's two-line row. One fact per row, so one
  // column with the "title" role.
  function statementsHtml() {
    return '<div class="section-head"><h2>Statements</h2></div>' +
      UI.table({
        cols: [{ label: "Period", w: "minmax(0, 1fr)", m: "title" }],
        rows: periods().map(function (p) {
          return {
            key: p,
            cls: "stmt-row",
            clickable: true,
            cells: ['<span class="cell-main"><span class="name">' + UI.esc(p) + "</span></span>"]
          };
        }),
        empty: "No statements yet."
      });
  }

  function periodWindow(period) {
    var m = /^([A-Za-z]+)\s+(\d{4})/.exec(period || "");
    var idx = m ? MONTH_NAMES.indexOf(m[1]) : -1;
    var now = new Date();
    if (idx < 0) return { start: new Date(0), end: now, truncated: true };
    var start = new Date(+m[2], idx, 1, 0, 0, 0, 0);
    var end = new Date(+m[2], idx + 1, 1, 0, 0, 0, 0);
    var truncated = /to date/i.test(period) && now < end;
    if (truncated) end = now;
    return { start: start, end: end, truncated: truncated };
  }

  function movements(cur) {
    var out = [];
    Data.state.deposits.forEach(function (d) {
      if (d.cur !== cur || d.state !== "credited" || !d.crTs) return;
      out.push({ ts: d.crTs, ref: d.id, desc: "Deposit",
        sub: d.via === "bank" ? "bank transfer · " + (d.sender || "") : "on-chain · " + (d.sender || ""),
        delta: d.amount });
    });
    Data.state.withdrawals.forEach(function (w) {
      if (w.cur !== cur || w.state === "failed") return;
      out.push({ ts: w.stamps.submitted || w.ts, ref: w.id, desc: "Withdrawal",
        sub: w.dest + (w.state === "confirmed" ? " · completed" : " · processing"),
        delta: -w.amount });
    });
    Data.state.trades.forEach(function (t) {
      if (t.state === "failed") return;
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
          sub: t.pair + " at " + rate4(t.rate), delta: recvAmt });
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
          '<span class="doc-v doc-verbatim">' + UI.esc(Data.ACCOUNT_NAME) + "</span></div>" +
        "<div><span class=\"doc-k\">" + (cur === "USDT" ? "Custody" : "Deposit reference") + "</span>" +
          '<span class="doc-v' + (v ? " mono" : "") + '">' +
          UI.esc(cur === "USDT" ? "Fasset custody · TRC20 and ERC20" : (v ? v.iban : "—")) + "</span></div>" +
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
          '<tr><td colspan="5" class="doc-empty">No movements in this period.</td></tr>') +
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
        UI.esc(Data.ACCOUNT_NAME) + ", separately from Fasset’s own funds.</p>" +
        "<p>Zand Bank · Dubai, UAE</p></div>";
  }

  // — the overlay: a document viewer, not a modal. Esc and scrim close it. —

  var docEl = null, docPeriod = null, docCur = null, docTrigger = null, docKey = null;

  function docMsg(text) {
    if (!docEl) return;
    var m = docEl.querySelector("#docMsg");
    if (m) m.textContent = text || "";
  }

  function toolbarHtml() {
    var scopes = ["AED", "USD", "EUR", "BHD", "USDT"].filter(Data.railLive);
    return '<div class="doc-toolbar"><div class="doc-scopes">' +
      scopes.map(function (c) {
        return '<button class="doc-scope' + (c === docCur ? " active" : "") + '" data-scope="' +
          UI.esc(c) + '" type="button">' + ccy(c) + "</button>";
      }).join("") +
      '</div><div class="doc-tools"><span class="doc-msg" id="docMsg" aria-live="polite"></span>' +
      '<button class="link" id="docCsv" type="button">' + icon("download", 12) + "Download (CSV)</button>" +
      '<button class="btn btn-ghost" id="docClose" type="button" aria-label="Close statement">' + icon("close", 14) + "</button>" +
      "</div></div>";
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
    docEl.querySelectorAll("[data-scope]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-scope");
        if (c === docCur) return;
        docCur = c;
        docEl.querySelectorAll("[data-scope]").forEach(function (x) {
          x.classList.toggle("active", x.getAttribute("data-scope") === docCur);
        });
        docMsg("");
        repaint(docEl.querySelector("#docPaper"), paperHtml(docPeriod, docCur));
      });
    });
    docKey = onDocKey;
    document.addEventListener("keydown", docKey, true);
    docEl.querySelector("#docClose").focus();
  }

  function closeStatement(immediate) {
    if (!docEl) return;
    var el = docEl;
    docEl = null;
    if (docKey) { document.removeEventListener("keydown", docKey, true); docKey = null; }
    el.classList.remove("open");
    if (immediate) el.remove();
    else setTimeout(function () { el.remove(); }, 150);
    if (docTrigger && document.body.contains(docTrigger)) docTrigger.focus();
    docTrigger = null;
  }

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

  function csvCell(v) { return '"' + String(v == null ? "" : v).replace(/"/g, "'") + '"'; }

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

  // ————— the ledger: this currency's activity, rows open the drawer —————

  var curActs = {};

  function ledgerHtml() {
    var acts = Data.activity().filter(function (a) {
      return a.cur === CUR || (a.kind === "trade" && CUR === "USDT");
    }).slice(0, 30);
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
          '<span class="cell-main"><span style="min-width:0"><span class="name" style="display:block">' + UI.esc(a.title) + "</span>" +
            '<span class="desc">' + UI.esc(a.sub) + "</span></span></span>",
          UI.statusDot(a.status.kind, a.status.label),
          '<span class="date">' + UI.esc(stamp(a.ts)) + "</span>",
          // display:block: the role wrapper (.m-cell) is the grid item now, so
          // .amount must be the block that fills the track for its
          // text-align:right to hold. Desktop unchanged.
          '<span class="amount' + (a.status.kind === "error" ? " error status-error" : a.status.kind === "positive" ? (a.dir > 0 ? " positive" : "") : " pending") + '" style="display:block">' +
            UI.money(a.cur, a.amount, { sign: a.dir > 0 ? "+" : a.dir < 0 ? "−" : "" }) + "</span>"
        ]
      });
    });
    return UI.table({
      // phone roles (m): activity over amount on line 1, status over time on
      // line 2. One currency on this screen, so there is no identity swatch
      // and no "lead". The spacer is "hide" so it cannot auto-place into a
      // third line of the phone grid.
      cols: [
        { label: "Activity", w: "minmax(0, 300px)", m: "title" },
        { spacer: true, m: "hide" },
        { label: "Status", w: "180px", m: "status" },
        { label: "Date", w: "105px", m: "meta" },
        { label: "Amount", w: "165px", right: true, m: "amount" }
      ],
      rows: rows,
      empty: "No " + CUR + " activity yet."
    });
  }

  // ————— render —————

  function render(el) {
    ROOT = el;
    var dep = el.querySelector("#balDeposit");
    if (dep) dep.addEventListener("click", openDeposit);
    var wd = el.querySelector("#balWithdraw");
    if (wd) wd.addEventListener("click", function () {
      var w = App.screen("withdraw");
      if (w && w.setCur) w.setCur(CUR);
      App.go("withdraw");
    });

    el.insertAdjacentHTML("beforeend",
      '<div data-balsec="pills">' + pillsHtml() + "</div>" +
      '<div class="section" data-balsec="hero">' + heroHtml() + "</div>" +
      '<div class="section" data-balsec="statements">' + statementsHtml() + "</div>" +
      '<div class="section" data-balsec="ledger"><div class="section-head"><h2>Activity</h2></div>' +
        '<div id="balLedger">' + ledgerHtml() + "</div></div>");

    el.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      var pill = e.target.closest("[data-balcur]");
      if (pill) {
        var c = pill.getAttribute("data-balcur");
        if (c !== CUR) { CUR = c; App.rerender(); }   // the title names the currency
        return;
      }
      // the statement row carries its period as the table's data-key; it is
      // checked before the ledger rows because both are .row.clickable
      var st = e.target.closest(".stmt-row");
      if (st) { openStatement(st.getAttribute("data-key"), CUR, st); return; }
      var row = e.target.closest(".row.clickable");
      if (row) {
        var a = curActs[row.getAttribute("data-key")];
        if (a && window.Details) Details.openEntry(a);
      }
    });
  }

  App.registerScreen("balance", {
    title: "Balances",
    subtitle: "What you hold, in each currency",
    actions: function () {
      var live = Data.railLive(CUR);
      if (!live) return "";
      var canAct = Data.state.role !== "viewer";
      return (canAct ? '<button class="btn btn-secondary" id="balWithdraw" type="button">Withdraw</button>' : "") +
        '<button class="btn btn-primary" id="balDeposit" type="button">Deposit</button>';
    },
    zone: "app",
    setCur: function (c) { if (CURS.indexOf(c) >= 0) CUR = c; },
    render: render,
    onData: function (scope) {
      if (scope === "prefs" || scope === "all") return false;
      if (scope === "deposits" || scope === "withdrawals" || scope === "trades") {
        if (!region("hero")) return false;
        repaint(region("hero"), heroHtml());
        repaint(document.getElementById("balLedger"), ledgerHtml());
        return true;
      }
      return true;
    }
  });
})();
