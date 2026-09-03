/* ————————————————————————————————————————————————
   Fasset Prime — Withdraw. Its own screen since IA v2 (2026-09-03);
   ported from Move money's withdraw tab and decluttered to the bone:
   currency → amount → destination → review → step-up. The feed on
   the dashboard carries every withdrawal's Processing → Completed ·
   Failed life; nothing is listed here twice.

   States: form · review (btn-danger + step-up: money leaves Fasset) ·
   viewer sees one sentence. Insufficient balance states the two
   numbers. No eligible destination points at Accounts.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var WD = { cur: "AED", amt: "", dest: "", stage: "form", err: "" };
  var ROOT = null;

  var CURS = ["AED", "USD", "EUR", "BHD", "USDT"];

  function ccy(cur, opts) { return UI.ccy ? UI.ccy(cur, opts) : UI.esc(cur); }
  function canAct() { return Data.state.role !== "viewer"; }
  function parseAmt(s) { var a = parseFloat(String(s || "").replace(/,/g, "")); return a > 0 ? a : 0; }
  function region() { return ROOT ? ROOT.querySelector('[data-wdsec="main"]') : null; }

  function formBlock() {
    var dests = Data.eligibleDests(WD.cur);
    var h = '<div class="mv-form">' +
      '<div class="field-row">' +
        '<div class="field mv-narrow"><label for="wdCur">Currency</label><select id="wdCur" class="select">' +
          CURS.map(function (c) {
            if (!Data.railLive(c)) return "<option disabled>" + c + "</option>";
            return "<option" + (WD.cur === c ? " selected" : "") + ">" + c + "</option>";
          }).join("") +
        "</select></div>" +
        '<div class="field"><label for="wdAmt">Amount</label>' +
        '<input id="wdAmt" class="input input-amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + UI.esc(WD.amt) + '">' +
        '<div class="hint">Available ' + UI.money(WD.cur, Data.state.bal[WD.cur]) + "</div>" +
        '<div class="hint err' + (WD.err ? "" : " hide") + '" id="wdAmtErr">' + UI.esc(WD.err || "") + "</div></div>" +
      "</div>";

    if (dests.length) {
      h += '<div class="field"><label for="wdDest">Destination</label>' +
        '<select id="wdDest" class="select"><option value="">Select a destination</option>' +
        dests.map(function (d) {
          return "<option" + (WD.dest === d.label ? " selected" : "") + ">" + UI.esc(d.label) + "</option>";
        }).join("") + "</select></div>" +
        '<button class="btn btn-primary btn-lg mt-16" id="wdNext" type="button">Continue</button>';
    } else {
      // no destination for this currency: the next step IS the button
      h += '<div class="field"><label>Destination</label>' +
        '<p class="hint">No approved ' + (WD.cur === "USDT" ? "wallets" : WD.cur + " accounts") + " yet.</p></div>" +
        '<button class="btn btn-primary btn-lg mt-16" id="wdGoAcc" type="button">' +
          (WD.cur === "USDT" ? "Add a wallet" : "Add a " + WD.cur + " account") + "</button>";
    }

    return h + "</div>";
  }

  function reviewBlock() {
    return '<div class="mv-review">' +
      '<div class="mv-sum">' +
        '<div class="def-row"><span class="def-label">Amount</span><span class="def-value strong">' +
          UI.moneyHero(WD.cur, parseAmt(WD.amt)) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Destination</span><span class="def-value">' + UI.esc(WD.dest) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Window</span><span class="def-value">' + UI.esc(Data.windowCopy()) + "</span></div>" +
      "</div>" +
      '<div class="note note-error">This leaves Fasset. Once sent, it can’t be pulled back.</div>' +
      '<div class="flex mt-16"><button class="btn btn-secondary" id="wdBack" type="button">Back</button>' +
      '<button class="btn btn-danger" id="wdSubmit" type="button">Confirm withdrawal</button></div>' +
      "</div>";
  }

  function balancesCol() {
    var h = '<div class="mv-detail-title">Available</div>';
    CURS.forEach(function (c) {
      if (!Data.railLive(c)) return;
      h += '<div class="def-row"><span class="def-label">' + ccy(c) + '</span><span class="def-value strong">' +
        UI.money(c, Data.state.bal[c]) + "</span></div>";
    });
    return h;
  }

  function mainHtml() {
    if (!canAct()) {
      return '<div class="mv-cols"><div class="mv-denied"><p>Withdrawals are for admins and traders.</p></div>' +
        "<div>" + balancesCol() + "</div></div>";
    }
    if (!Data.railLive(WD.cur)) WD.cur = "AED";
    var review = WD.stage === "review";
    return '<div class="mv-cols"><div>' + (review ? reviewBlock() : formBlock()) + "</div>" +
      "<div>" + balancesCol() + "</div></div>";
  }

  function paint() {
    var node = region();
    if (!node) return;
    if (UI.repaint) UI.repaint(node, mainHtml()); else node.innerHTML = mainHtml();
  }

  function validateAndReview(node) {
    var a = parseAmt(WD.amt), bal = Data.state.bal[WD.cur];
    var focus = "#wdAmt";
    WD.err = "";
    if (!a) {
      WD.err = "Enter an amount.";
    } else if (a > bal) {
      WD.err = "You asked for " + WD.cur + " " + UI.fmtNum(a) + " and " + WD.cur + " " + UI.fmtNum(bal) + " is available.";
    } else if (!WD.dest) {
      WD.err = "Select a destination.";
      focus = "#wdDest";
    }
    if (WD.err) {
      var er = node.querySelector("#wdAmtErr");
      if (er) { er.textContent = WD.err; er.classList.remove("hide"); }
      var f = node.querySelector(focus);
      if (f) f.focus();
      return;
    }
    WD.stage = "review";
    paint();
  }

  function wireOnce(node) {
    if (!node || node.getAttribute("data-wired")) return;
    node.setAttribute("data-wired", "1");
    node.addEventListener("input", function (e) {
      if (e.target.id !== "wdAmt") return;
      WD.amt = e.target.value;
      WD.err = "";
      var er = node.querySelector("#wdAmtErr");
      if (er) er.classList.add("hide");
    });
    node.addEventListener("change", function (e) {
      if (e.target.id === "wdCur") { WD.cur = e.target.value; WD.dest = ""; WD.err = ""; paint(); }
      if (e.target.id === "wdDest") { WD.dest = e.target.value; WD.err = ""; }
    });
    node.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (!b) return;
      if (b.id === "wdGoAcc") {
        var acc = App.screen("accounts");
        if (acc && acc.openAdd) acc.openAdd(WD.cur);
        App.go("accounts");
      }
      if (b.id === "wdNext") validateAndReview(node);
      if (b.id === "wdBack") { WD.stage = "form"; paint(); }
      if (b.id === "wdSubmit") {
        UI.stepUp("Money is leaving Fasset. Confirm with your authenticator.", function () {
          var a = parseAmt(WD.amt), c = WD.cur, dst = WD.dest;
          WD = { cur: c, amt: "", dest: "", stage: "form", err: "" };
          Data.submitWithdrawal(c, a, dst);
          App.go("dashboard");   // the feed shows it processing
        });
      }
    });
  }

  function skeletonHtml() {
    return '<div class="section"><div class="mv-skel-row">' + UI.skel("48%", "190px") + UI.skel("48%", "120px") + "</div></div>";
  }

  function render(el) {
    if (!loadedOnce) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 320);
      return;
    }
    renderBody(el);
  }

  function renderBody(el) {
    ROOT = el;
    el.insertAdjacentHTML("beforeend",
      '<div class="section" data-wdsec="main"></div>' +
      '<div class="section demo-strip-wrap"><div class="demo-strip">' +
        '<span class="freshline">Demo · the desk side.</span>' +
        '<button class="db-btn" id="wdDemoAdvance" type="button">Withdrawal advances</button>' +
        '<button class="db-btn" id="wdDemoFail" type="button">A withdrawal fails</button>' +
      "</div></div>");
    wireOnce(region());
    var adv = el.querySelector("#wdDemoAdvance");
    if (adv) adv.addEventListener("click", function () {
      if (!Data.advanceWithdrawal()) UI.toast("No withdrawal in flight.", "blocked");
    });
    var fl = el.querySelector("#wdDemoFail");
    if (fl) fl.addEventListener("click", function () {
      if (!Data.failWithdrawal()) UI.toast("No withdrawal in flight.", "blocked");
    });
    paint();
  }

  App.registerScreen("withdraw", {
    title: "Withdraw",
    zone: "app",
    // off the nav since 2026-09-03: the flow starts from a balance view
    setCur: function (c) {
      if (CURS.indexOf(c) >= 0 && Data.railLive(c)) { WD.cur = c; WD.dest = ""; WD.err = ""; WD.stage = "form"; }
    },
    render: render,
    onData: function (scope) {
      if (scope === "prefs" || scope === "all") return false;
      if (scope === "withdrawals" || scope === "deposits" || scope === "trades" || scope === "whitelist") {
        if (region()) { paint(); return true; }
        return false;
      }
      return true;
    }
  });
})();
