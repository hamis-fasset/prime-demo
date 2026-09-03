/* ————————————————————————————————————————————————
   Fasset Prime — the shared details drawer. Added 2026-09-03.
   The OpenFX grammar: EVERY money event, tapped anywhere (dashboard
   feed, trade history, a balance ledger), opens this one drawer — a
   flat def-list, a timeline of the simple client states, and for a
   trade the legs card with the rate chip between them. Nothing ever
   expands in place; nothing opens a different-shaped detail view.

   Client labels are the locked 8-word vocabulary. Internal stamps
   only surface as timestamps on those labels.

   Exposes window.Details.open(kind, obj) — kind: trade | dep | wd —
   and Details.openEntry(entry) for Data.activity() rows.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  function rate4(r) { return Number(r).toFixed(4); }
  function ccy(cur, opts) { return UI.ccy ? UI.ccy(cur, opts) : UI.esc(cur); }
  function row(label, valueHtml) {
    return '<div class="def-row"><span class="def-label">' + UI.esc(label) + '</span><span class="def-value">' + valueHtml + "</span></div>";
  }
  function rowStrong(label, valueHtml) {
    return '<div class="def-row"><span class="def-label">' + UI.esc(label) + '</span><span class="def-value strong">' + valueHtml + "</span></div>";
  }

  // ————— trades —————

  function tradeStatus(t) {
    if (t.state === "settled") return UI.statusDot("positive", "Completed");
    if (t.state === "failed") return UI.statusDot("error", "Failed");
    if (t.state === "settling") return UI.statusDot("info", "Processing");
    return UI.statusDot("warning", "Awaiting funding");
  }

  // status labels stand alone — no subtitles under timeline steps
  // (Hamis 2026-09-03: "just the title, no description of what it means")
  function tradeTimeline(t) {
    if (t.state === "failed") {
      return [
        { label: "Initiated", state: "done", time: UI.fmtTs(t.stamps.placed || t.ts) },
        { label: "Failed", state: "failed" }
      ];
    }
    return [
      { label: "Initiated", state: "done", time: UI.fmtTs(t.stamps.placed || t.ts) },
      { label: t.state === "awaiting" ? "Awaiting funding" : "Funded",
        state: t.state === "awaiting" ? "pending" : "done",
        time: t.stamps.funded ? UI.fmtTs(t.stamps.funded) : "" },
      { label: t.state === "settled" ? "Completed" : "Processing",
        state: t.state === "settled" ? "done" : t.state === "settling" ? "active" : "todo",
        time: t.stamps.settled ? UI.fmtTs(t.stamps.settled) : "" }
    ];
  }

  function tradeBody(t) {
    var f = Data.fiatOf(t.pair);
    var buyU = t.side === "buy";
    return '<div class="def-group">' +
        rowStrong("Trade", UI.esc(t.id)) +
        row("Status", tradeStatus(t)) +
        row("Initiated by", t.byDesk ? "The desk, for you" : "You") +
      "</div>" +
      '<div class="txd-legs">' +
        '<div class="txd-leg"><span class="txd-what"><span class="tx-label">Purchased</span><span class="txd-cur">' + ccy(buyU ? "USDT" : f) + "</span></span>" +
          '<span class="txd-amt">' + (buyU ? UI.money("USDT", t.assetAmt, { dp: 0 }) : UI.money(f, t.fiatAmt)) + "</span></div>" +
        '<span class="txd-pill">1 USDT = ' + rate4(t.rate) + " " + UI.esc(f) + "</span>" +
        '<div class="txd-leg"><span class="txd-what"><span class="tx-label">Sold</span><span class="txd-cur">' + ccy(buyU ? f : "USDT") + "</span></span>" +
          '<span class="txd-amt">' + (buyU ? UI.money(f, t.fiatAmt) : UI.money("USDT", t.assetAmt, { dp: 0 })) + "</span></div>" +
      "</div>" +
      '<div class="mt-16">' + UI.timeline(tradeTimeline(t)) + "</div>";
  }

  // ————— deposits —————

  function depStatus(d) {
    if (d.state === "credited") return UI.statusDot("positive", "Completed");
    if (d.state === "failed") return UI.statusDot("error", "Failed");
    return UI.statusDot("info", "Processing");
  }

  function depTimeline(d) {
    if (d.state === "failed") {
      return [
        { label: "Processing", state: "done", time: UI.fmtTs(d.ts) },
        { label: "Failed", state: "failed" }
      ];
    }
    return [
      { label: "Processing", state: d.state === "credited" ? "done" : "active", time: UI.fmtTs(d.ts) },
      { label: "Completed",
        state: d.state === "credited" ? "done" : "todo",
        time: d.crTs ? UI.fmtTs(d.crTs) : "" }
    ];
  }

  function depBody(d) {
    return '<div class="def-group">' +
        rowStrong("Deposit", UI.esc(d.id)) +
        row("Status", depStatus(d)) +
        rowStrong("Amount", UI.money(d.cur, d.amount)) +
        row("From", UI.esc(d.sender || (d.via === "bank" ? "bank transfer" : "on-chain"))) +
      "</div>" +
      '<div class="mt-16">' + UI.timeline(depTimeline(d)) + "</div>";
  }

  // ————— withdrawals —————

  function wdStatus(w) {
    if (w.state === "confirmed") return UI.statusDot("positive", "Completed");
    if (w.state === "failed") return UI.statusDot("error", "Failed");
    return UI.statusDot("info", "Processing");
  }

  function wdTimeline(w) {
    if (w.state === "failed") {
      return [
        { label: "Processing", state: "done", time: UI.fmtTs(w.stamps.submitted || w.ts) },
        { label: "Failed", state: "failed" }
      ];
    }
    return [
      { label: "Processing",
        state: w.state === "confirmed" ? "done" : "active",
        time: UI.fmtTs(w.stamps.submitted || w.ts) },
      { label: "Completed",
        state: w.state === "confirmed" ? "done" : "todo",
        time: w.stamps.confirmed ? UI.fmtTs(w.stamps.confirmed) : "" }
    ];
  }

  function wdBody(w) {
    return '<div class="def-group">' +
        rowStrong("Withdrawal", UI.esc(w.id)) +
        row("Status", wdStatus(w)) +
        rowStrong("Amount", UI.money(w.cur, w.amount, { sign: "−" })) +
        row("To", UI.esc(w.dest)) +
      "</div>" +
      '<div class="mt-16">' + UI.timeline(wdTimeline(w)) + "</div>";
  }

  // ————— the one entry point —————

  var Details = {
    open: function (kind, obj) {
      var canAct = Data.state.role !== "viewer";
      var title = kind === "trade" ? "Trade details" : kind === "dep" ? "Deposit details" : "Withdrawal details";
      var repeatable = kind === "trade" && canAct && Data.railLive(Data.fiatOf(obj.pair));
      var h = UI.drawer(title, "", {
        width: 460,
        foot: (repeatable ? '<button class="btn btn-primary" id="dtRepeat" type="button">Repeat trade</button>' : "") +
              '<button class="btn btn-secondary" id="dtClose" type="button">Close</button>'
      });
      h.body.innerHTML = kind === "trade" ? tradeBody(obj) : kind === "dep" ? depBody(obj) : wdBody(obj);
      h.el.querySelector("#dtClose").addEventListener("click", h.close);
      var rep = h.el.querySelector("#dtRepeat");
      if (rep) rep.addEventListener("click", function () {
        h.close();
        var tr = App.screen("trade");
        if (tr && tr.prefill) tr.prefill(obj);
        App.go("trade");
      });
    },
    openEntry: function (entry) { Details.open(entry.kind, entry.obj); }
  };

  window.Details = Details;
})();
