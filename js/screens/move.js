/* ————————————————————————————————————————————————
   Fasset Prime — Move money (J14–J17). Built in wave 2.
   Ported from prime-v2.standalone.html per ARCHITECTURE.md.
   Audit pass 2026-09-01: items #1 (currency identity), #7 (de-box
   + the dark-theme inversion), the colour plan, M4, M6, M7.

   Deposit:
   · per-currency detail cards, all rails live by default; the demo
     bar's "today" mode gives USD/GBP the dark-rail treatment (no
     account details are ever shown before the rail exists)
   · Data.ACCOUNT_NAME renders VERBATIM (confirmation of payee)
   · IBANs and the USDT address in mono copy rows, network choice
   · optional expected-deposit note: attribution only, never a gate
   · incoming list, lifecycles expanding in place, driven by the
     simulated webhooks; unknown-sender credits are HELD, excluded
     from available, and identified through a drawer (Data.identifyHeld)
   Withdraw:
   · destinations are tested wallets / verified accounts only, never
     free text; inline path to the whitelist when there are none
   · available vs in flight beside the amount; insufficient balance
     states the two numbers
   · review step (btn-danger, "this leaves Fasset") then UI.stepUp;
     Data.submitWithdrawal earmarks the amount at submit
   · lifecycle Submitted → Processing → Sent → Confirmed with
     Data.windowCopy() (the demo bar's OQ9 toggle rewrites it)

   Surfaces (the card rule as the audit amends it: a card is drawn for
   an object OR an irreversible instrument):
     card    · the three fiat rail cards, the USDT custody card, the
               not-live rail card
     wash    · the withdrawal review (--surface-2, not --card-bg)
     no box  · the expected-transfer note, the withdrawal form, the
               viewer notice
   The USDT custody card carries the app's ONE bespoke texture (M6).

   Painting (M7): the screen builds five region shells as direct
   children of .screen once, then repaints a region in place. A tab
   switch or a row expand never replays the page entrance, and a row
   expand animates only the inserted .mv-row-detail.

   States per element: loading (one skeleton pass) · empty (incoming,
   in flight, no eligible destinations) · error/failed (held credit,
   insufficient balance, missing amount/destination) · stale/degraded
   (feed-interrupted note on both lists) · permission-denied (viewers
   see the details and the lists, no act controls).
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;                 // skeleton runs once per app load
  var TAB = "deposit";                    // deposit | withdraw
  var NET = "TRC20";                      // USDT network choice
  var EXP = { amt: "", note: "" };        // expected-deposit note (transient)
  var OPEN = {};                          // row key → expanded
  var INTEREST = {};                      // "USD"/"GBP" → told-me-when-live
  var WD = { cur: "AED", amt: "", dest: "", stage: "form", err: "" };
  var DONE = null;                        // terminal money events already marked
  var ROOT = null;                        // the live .screen element

  var CURS = ["AED", "USD", "GBP", "USDT"];
  // region shells, in page order. Deposit: rail cards · expected-transfer
  // note · USDT custody · incoming · demo. Withdraw: form + availability ·
  // (nothing) · (nothing) · withdrawals · demo.
  var SECS = ["primary", "aux", "custody", "ledger", "demo"];

  // ————— foundation API (js/ui.js) —————
  // UI.ccy / UI.repaint / UI.settleFlash are shared primitives. The
  // fallbacks exist only so a load-order accident can't blank the screen;
  // they render the same information without the flourish.
  function ccy(cur, opts) { return UI.ccy ? UI.ccy(cur, opts) : UI.esc(cur); }
  function swap(node, html) { if (UI.repaint) UI.repaint(node, html); else node.innerHTML = html; }
  function settle(node) { if (node && UI.settleFlash) UI.settleFlash(node); }

  function canAct() { return Data.state.role !== "viewer"; }
  function parseAmt(s) {
    var a = parseFloat(String(s || "").replace(/,/g, ""));
    return a > 0 ? a : 0;
  }
  function caret(open) {
    return '<span class="mv-caret' + (open ? " open" : "") + '">' + icon("chevronRight", 12) + "</span>";
  }
  function region(id) { return ROOT ? ROOT.querySelector('[data-mvsec="' + id + '"]') : null; }

  // ————— deposit: per-rail detail cards —————

  var RAIL_NOTE = {
    AED: "Send from an account in your entity’s name. Third-party transfers are held until you confirm the sender.",
    USD: "Send from an account in your entity’s name. USD wires can route through a correspondent bank.",
    GBP: "Send from an account in your entity’s name."
  };

  function railCard(cur) {
    var v = Data.VIBANS[cur];
    if (!Data.railLive(cur)) {
      // dark-rail treatment: no account details exist yet, so none are shown.
      // The surface is pinned dark in BOTH themes (see screens-move.css).
      return '<div class="card card-pad mv-depcard mv-rail-off">' +
        '<div class="mv-dep-head"><h3>' + ccy(cur, { chip: true }) + "</h3>" +
        UI.statusDot("neutral", "not yet live") + "</div>" +
        '<div class="mv-off-body">' + cur + " is not live yet. Your " + cur +
        " vIBAN appears here the moment the rail opens." +
        (canAct() ? '<div class="mt-12"><button class="link" data-interest="' + cur + '" type="button">' +
          (INTEREST[cur] ? "You’re on the list" : "Tell me when it’s live") + "</button></div>" : "") +
        "</div></div>";
    }
    return '<div class="card card-pad mv-depcard">' +
      '<div class="mv-dep-head"><h3>' + ccy(cur, { chip: true }) + "</h3>" +
      UI.statusDot("positive", "live") + "</div>" +
      UI.copyRow("IBAN", v.iban, { mono: true, copy: v.copy }) +
      // verbatim, never truncated or restyled: the sending bank checks this string
      UI.copyRow("Account name", Data.ACCOUNT_NAME, { copy: Data.ACCOUNT_NAME }) +
      '<div class="copy-row"><span class="cr-label">Bank</span><span class="cr-value">Zand Bank · Dubai, UAE</span></div>' +
      '<p class="hint">' + UI.esc(RAIL_NOTE[cur]) + "</p>" +
      "</div>";
  }

  function depRailsHtml() {
    return '<div class="section-head"><h2>Your deposit details · fiat</h2>' +
      '<span class="link">no need to tell us you’ve sent money</span></div>' +
      '<div class="mv-depgrid">' + ["AED", "USD", "GBP"].map(railCard).join("") + "</div>";
  }

  // the only surface in the app that represents Fasset holding your asset,
  // and therefore the only textured one (M6)
  function custodyHtml() {
    return '<div class="section-head"><h2>Your deposit details · digital assets</h2></div>' +
      '<div class="mv-depgrid"><div class="card card-pad mv-depcard mv-usdt">' +
      '<div class="mv-dep-head"><h3>' + ccy("USDT", { chip: true }) + "</h3>" +
      UI.statusDot("positive", "live · Fasset custody") + "</div>" +
      '<div class="mv-netseg"><div class="seg">' +
        ["TRC20", "ERC20"].map(function (n) {
          return '<button class="seg-btn' + (NET === n ? " active" : "") + '" data-net="' + n + '" type="button">' +
            (n === "TRC20" ? "TRC20 · Tron" : "ERC20 · Ethereum") + "</button>";
        }).join("") +
      "</div></div>" +
      UI.copyRow("Address", Data.USDT_ADDRS[NET], { mono: true, copy: Data.USDT_ADDRS[NET] }) +
      '<p class="hint">Send only USDT on the selected network.</p>' +
      "</div></div>";
  }

  // de-boxed: a two-field form is not an object, so width bounds it
  function expectedHtml() {
    return '<div class="section-head"><h2>Expecting a large transfer?</h2>' +
      '<span class="freshline">optional</span></div>' +
      '<div class="mv-form">' +
      '<div class="field-row">' +
        '<div class="field mv-amt"><label for="mvExpAmt">Amount</label>' +
        '<input id="mvExpAmt" class="input input-amount" inputmode="decimal" autocomplete="off" placeholder="10,000,000" value="' + UI.esc(EXP.amt) + '"></div>' +
        '<div class="field"><label for="mvExpNote">Note for the desk</label>' +
        '<input id="mvExpNote" class="input" autocomplete="off" placeholder="arriving in 3 tranches from ENBD this week" value="' + UI.esc(EXP.note) + '"></div>' +
      "</div>" +
      '<div class="hint err hide" id="mvExpErr">Add an amount or a note first.</div>' +
      '<button class="btn btn-secondary mt-8" id="mvExpSend" type="button">Send note</button>' +
      '<p class="hint">This helps the desk match multi-tranche transfers faster. It holds nothing up.</p>' +
      "</div>";
  }

  // ————— deposit lifecycles —————

  function depStatus(d) {
    if (d.state === "credited") return UI.statusDot("positive", "Credited");
    if (d.state === "held") return UI.statusDot("error", "Held for identification");
    // in process, the same hue History uses for the same object in the same state
    if (d.state === "ident") return UI.statusDot("info", "Identification under review");
    return UI.statusDot("info", d.state === "detected" ? "Detected" : "Processing");
  }

  function depTimeline(d) {
    var items = [{
      label: "Detected",
      sub: d.via === "bank" ? "your transfer reached your vIBAN" : "confirmed on-chain",
      state: "done",
      time: UI.fmtTs(d.ts)
    }];
    if (d.state === "held" || d.state === "ident") {
      items.push({
        label: d.state === "held" ? "Held for identification" : "Identification submitted",
        sub: d.state === "held"
          ? "excluded from your available balance until the sender is confirmed"
          : "the desk is verifying the sender",
        state: d.state === "held" ? "failed" : "active"
      });
      items.push({ label: "Credited to your balance", state: "todo" });
      return items;
    }
    items.push({
      label: "Processing",
      sub: "being credited to your account",
      state: d.state === "processing" ? "active" : d.state === "credited" ? "done" : "todo"
    });
    items.push({
      label: "Credited to your balance",
      sub: "available balance updated",
      state: d.state === "credited" ? "done" : "todo",
      time: d.crTs ? UI.fmtTs(d.crTs) : ""
    });
    return items;
  }

  function depDetail(d) {
    var h = '<div class="mv-row-detail"><div class="mv-detail-title">Deposit lifecycle · ' + UI.esc(d.id) + "</div>" +
      UI.timeline(depTimeline(d));
    if (d.state === "held") {
      h += '<div class="mv-heldrow">' +
        (canAct()
          ? '<button class="btn btn-secondary btn-sm" data-held="' + UI.esc(d.id) + '" type="button">Confirm the sending account</button>'
          : "") +
        '<span class="freshline">' +
          (canAct()
            ? "Confirm the sender and the desk can credit it."
            : "Ask an admin or trader to confirm the sender.") +
        "</span></div>";
    }
    if (d.state === "ident") {
      h += '<p class="freshline mt-16">With the desk; nothing more needed from you.</p>';
    }
    return h + "</div>";
  }

  function incomingHtml() {
    var deps = Data.state.deposits;
    // time-ordered, newest first: group by day, and keep the identity column
    // capped so status, detected and amount stay clustered at the right edge
    var rows = [], day = null;
    deps.forEach(function (d) {
      var held = d.state === "held" || d.state === "ident";
      var key = "dep:" + d.id;
      var open = !!OPEN[key];
      var dl = UI.dayLabel(d.ts);
      if (dl !== day) { day = dl; rows.push({ group: dl }); }
      rows.push({
        key: key,
        clickable: true,
        selected: open,
        cls: "mvrow",
        cells: [
          '<span class="cell-main">' + caret(open) +
            '<span class="mv-idcell"><span class="name">' + UI.esc(d.id + " · " + (d.sender || "sender not stated")) + "</span>" +
            '<span class="desc">' + (d.via === "bank" ? "bank transfer" : "on-chain") +
              (held ? " · excluded from your available balance" : "") + "</span></span></span>",
          depStatus(d),
          '<span class="date">' + UI.esc(UI.fmtTs(d.ts)) + "</span>",
          // No currency swatch inside a 56px row: the amount already carries the
          // code, and identity colour on this screen lives on the objects. No
          // accent on a credited amount either: this table already spends its
          // one text hue on --st-error for a held credit, which is the line
          // that actually needs the operator (colour plan, rule 8). The accent
          // .amount.positive belongs to the archive.
          '<span class="amount' + (held ? " error" : d.state === "credited" ? "" : " pending") + '">' +
            UI.money(d.cur, d.amount, { sign: held ? "" : "+" }) + "</span>"
        ]
      });
    });
    return '<div class="section-head"><h2>Incoming deposits</h2>' +
      '<span class="link">a row expands into its lifecycle</span></div>' +
      '<div class="mv-table">' + UI.table({
        cols: [
          { label: "Deposit", w: "minmax(0, 400px)" },
          { spacer: true },
          { label: "Status", w: "190px" },
          { label: "Detected", w: "105px" },
          { label: "Amount", w: "155px", right: true }
        ],
        rows: rows,
        empty: "Nothing incoming right now."
      }) + "</div>" +
      (Data.state.stale
        ? '<p class="freshline mt-8">Deposit feed interrupted · last-known states, re-syncing automatically.</p>'
        : "");
  }

  // ————— held-credit identification drawer —————

  function openIdentify(dep) {
    var accounts = Data.state.banks.filter(function (b) {
      return b.state === "verified" || b.state === "pending";
    }).map(function (b) {
      return b.bank + " · " + b.iban.slice(0, 8) + " ···· " + b.iban.slice(-3) +
        (b.state === "verified" ? " (whitelisted)" : " (pending review)");
    });

    var h = UI.drawer("Identify a held deposit",
      '<div class="note note-error">We can’t match the sender to your accounts. Confirm who sent it and the desk can credit it.</div>' +
      '<div class="mv-sum mt-16">' +
        '<div class="def-row"><span class="def-label">Amount</span><span class="def-value strong">' + UI.money(dep.cur, dep.amount) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Sender, as received</span><span class="def-value">' + UI.esc(dep.sender) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Landed</span><span class="def-value">' + UI.esc(UI.fmtTs(dep.ts)) + "</span></div>" +
      "</div>" +
      '<div class="field"><label for="mvHeldAcct">This came from</label>' +
        '<select id="mvHeldAcct" class="select"><option value="">Select the sending account</option>' +
        accounts.map(function (a) { return "<option>" + UI.esc(a) + "</option>"; }).join("") +
        '<option value="other">A different account · I’ll provide proof</option></select>' +
        '<div class="hint err hide" id="mvHeldErr">Select the sending account first.</div></div>' +
      '<div class="field"><label>Proof of ownership · optional if the account is already whitelisted</label>' +
        uploaderHtml("mvHeldUp", "No document attached yet.") + "</div>" +
      '<p class="hint">The amount stays excluded while the desk verifies the sender.</p>',
      {
        width: 480,
        foot: '<button class="btn btn-secondary" id="mvHeldCancel" type="button">Cancel</button>' +
              '<button class="btn btn-primary" id="mvHeldSubmit" type="button">Submit identification</button>'
      });

    wireUploader(h.el.querySelector("#mvHeldUp"));
    var sel = h.el.querySelector("#mvHeldAcct");
    sel.addEventListener("change", function () { h.el.querySelector("#mvHeldErr").classList.add("hide"); });
    h.el.querySelector("#mvHeldCancel").addEventListener("click", h.close);
    h.el.querySelector("#mvHeldSubmit").addEventListener("click", function () {
      if (!sel.value) { h.el.querySelector("#mvHeldErr").classList.remove("hide"); sel.focus(); return; }
      Data.identifyHeld(dep.id);
      h.close();
    });
  }

  // ————— simulated document upload (a filling bar, never a spinner) —————
  // Duplicated verbatim in whitelist.js. The audit's fix is one component in
  // ui.js + app.css, which this owner cannot write; flagged, not forked.

  function uploaderHtml(id, label) {
    return '<div class="wl-up" id="' + id + '">' +
      '<span class="wl-up-meta">' + UI.esc(label) + "</span>" +
      '<span class="wl-up-bar"><i></i></span>' +
      '<label class="link" for="' + id + '-f">Attach</label>' +
      '<input type="file" id="' + id + '-f" class="hide"></div>';
  }

  function wireUploader(box) {
    if (!box) return { isDone: function () { return false; } };
    var st = { done: false };
    box.querySelector("input[type=file]").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      box.querySelector(".wl-up-meta").textContent = f.name + " · attaching";
      box.querySelector(".wl-up-bar").classList.add("run");
      setTimeout(function () {
        box.classList.add("done");
        box.querySelector(".wl-up-meta").textContent = f.name + " · attached";
        st.done = true;
      }, 760);
    });
    return { isDone: function () { return st.done; } };
  }

  // ————— withdraw —————

  function withdrawHtml() {
    if (!canAct()) {
      // permission-denied: one quiet paragraph, no box
      return '<div class="section-head"><h2>New withdrawal</h2>' +
        '<span class="link">an admin or trader action</span></div>' +
        '<div class="mv-cols"><div class="mv-denied"><p>Moving money out is for admins and traders. Ask one to submit the withdrawal.</p></div>' +
        "<div>" + availabilityCol() + "</div></div>";
    }
    if (!Data.railLive(WD.cur)) WD.cur = "AED";
    var review = WD.stage === "review";
    return '<div class="section-head"><h2>' + (review ? "Review your withdrawal" : "New withdrawal") + "</h2>" +
      '<span class="link">' + (review ? "this leaves Fasset" : "every withdrawal takes a step-up confirmation") + "</span></div>" +
      '<div class="mv-cols"><div>' + (review ? reviewBlock() : formBlock()) + "</div>" +
      "<div>" + availabilityCol() + "</div></div>";
  }

  // de-boxed: a form is not an object
  function formBlock() {
    var dests = Data.eligibleDests(WD.cur);
    var h = '<div class="mv-form">' +
      '<div class="field-row">' +
        '<div class="field mv-narrow"><label for="mvCur">Currency</label><select id="mvCur" class="select">' +
          CURS.map(function (c) {
            if (!Data.railLive(c)) return "<option disabled>" + c + " · rail not live yet</option>";
            return "<option" + (WD.cur === c ? " selected" : "") + ">" + c + "</option>";
          }).join("") +
        "</select></div>" +
        '<div class="field"><label for="mvAmt">Amount</label>' +
        '<input id="mvAmt" class="input input-amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + UI.esc(WD.amt) + '">' +
        '<div class="hint">Available ' + UI.money(WD.cur, Data.state.bal[WD.cur]) +
          (Data.inflightOut(WD.cur) ? " · " + UI.money(WD.cur, Data.inflightOut(WD.cur)) + " already in flight out" : "") + "</div>" +
        '<div class="hint err' + (WD.err ? "" : " hide") + '" id="mvAmtErr">' + UI.esc(WD.err || "") + "</div></div>" +
      "</div>";

    if (dests.length) {
      h += '<div class="field"><label for="mvDest">Destination · ' +
        (WD.cur === "USDT" ? "tested wallets only" : "verified " + WD.cur + " accounts only") + "</label>" +
        '<select id="mvDest" class="select"><option value="">Select a destination</option>' +
        dests.map(function (d) {
          return "<option" + (WD.dest === d.label ? " selected" : "") + ">" + UI.esc(d.label) + "</option>";
        }).join("") + "</select>" +
        '<div class="hint">A destination has to be on your whitelist. <button class="link" id="mvGoWl" type="button">Register a new one first</button></div></div>';
    } else {
      h += '<div class="note note-warning">No ' + (WD.cur === "USDT" ? "tested wallets" : "verified " + WD.cur + " accounts") +
        ' on your whitelist yet, so a withdrawal can’t proceed. <button class="link" id="mvGoWl" type="button">Register a destination</button></div>';
    }

    return h + '<button class="btn btn-primary btn-lg mt-16" id="mvNext" type="button"' + (dests.length ? "" : " disabled") + ">Continue</button>" +
      '<p class="hint">A withdrawal ' + UI.esc(Data.windowCopy()) + ". Submitting takes a step-up confirmation with your authenticator.</p></div>";
  }

  // an irreversible instrument, so it keeps a bounded surface: a wash, and
  // the one saturated fill this view is allowed (the danger button)
  function reviewBlock() {
    return '<div class="mv-review">' +
      '<div class="mv-sum">' +
        '<div class="def-row"><span class="def-label">Amount</span><span class="def-value strong">' +
          UI.moneyHero(WD.cur, parseAmt(WD.amt)) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Destination</span><span class="def-value">' + UI.esc(WD.dest) + "</span></div>" +
        '<div class="def-row"><span class="def-label">Service window</span><span class="def-value">' + UI.esc(Data.windowCopy()) + "</span></div>" +
      "</div>" +
      '<div class="note note-error">This leaves Fasset. Once sent, it can’t be pulled back.</div>' +
      '<div class="flex mt-16"><button class="btn btn-secondary" id="mvBack" type="button">Back</button>' +
      '<button class="btn btn-danger" id="mvSubmit" type="button">Confirm withdrawal</button></div>' +
      "</div>";
  }

  function availabilityCol() {
    var h = '<div class="mv-detail-title">Available to withdraw</div>';
    CURS.forEach(function (c) {
      // identity is the swatch beside a neutral label — four hues, no tints,
      // no dots. This column is the four rails at a glance.
      var label = '<span class="def-label">' + ccy(c) + "</span>";
      if (!Data.railLive(c)) {
        h += '<div class="def-row">' + label + '<span class="def-value">' +
          UI.statusDot("neutral", "not yet live") + "</span></div>";
        return;
      }
      var out = Data.inflightOut(c), inn = Data.inflightIn(c), held = Data.heldAmt(c);
      h += '<div class="def-row">' + label + '<span class="def-value strong">' +
        UI.moneyHero(c, Data.state.bal[c]) + "</span></div>";
      if (out || inn) {
        h += '<div class="mv-avail-sub">' +
          [out ? UI.money(c, out, { sign: "−" }) + " in flight out" : "", inn ? UI.money(c, inn, { sign: "+" }) + " arriving" : ""]
            .filter(Boolean).join(" · ") + "</div>";
      }
      if (held) {
        h += '<div class="mv-avail-held">' + UI.money(c, held) + " held for identification, excluded from available</div>";
      }
    });
    h += '<p class="hint mt-12">In-flight money is set aside and can’t be withdrawn twice.</p>';
    if (Data.state.stale) {
      h += '<p class="freshline mt-8">Balance feed interrupted · these are last-known values from ' +
        UI.esc(UI.fmtTs(new Date(Date.now() - 9 * 60000).toISOString())) + " and re-sync automatically.</p>";
    }
    return h;
  }

  function wdTimeline(w) {
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
      return {
        label: labels[k],
        sub: subs[k],
        state: i < idx ? "done" : i === idx ? (w.state === "confirmed" ? "done" : "active") : "todo",
        time: w.stamps[k] ? UI.fmtTs(w.stamps[k]) : ""
      };
    });
  }

  function wdListHtml() {
    var wds = Data.state.withdrawals;
    var inflight = wds.filter(function (w) { return w.state !== "confirmed"; }).length;
    var rows = [], day = null;
    wds.forEach(function (w) {
      var key = "wd:" + w.id;
      var open = !!OPEN[key];
      var dl = UI.dayLabel(w.ts);
      if (dl !== day) { day = dl; rows.push({ group: dl }); }
      rows.push({
        key: key,
        clickable: true,
        selected: open,
        cls: "mvrow",
        cells: [
          '<span class="cell-main">' + caret(open) +
            '<span class="mv-idcell"><span class="name">' + UI.esc(w.id + " → " + w.dest) + "</span>" +
            '<span class="desc">' + UI.esc(w.state === "confirmed" ? "completed" : Data.windowCopy()) + "</span></span></span>",
          w.state === "confirmed"
            ? UI.statusDot("positive", "Confirmed")
            : UI.statusDot("info", { submitted: "Submitted", servicing: "Processing", sent: "Sent" }[w.state]),
          '<span class="date">' + UI.esc(UI.fmtTs(w.ts)) + "</span>",
          // outbound money is never red: the sign and the word carry direction
          '<span class="amount' + (w.state === "confirmed" ? "" : " pending") + '">' +
            UI.money(w.cur, w.amount, { sign: "−" }) + "</span>"
        ]
      });
    });
    return '<div class="section-head"><h2>Withdrawals</h2>' +
      '<span class="link">' + (inflight ? inflight + " in flight" : "nothing in flight") + "</span></div>" +
      '<div class="mv-table">' + UI.table({
        cols: [
          { label: "Withdrawal", w: "minmax(0, 400px)" },
          { spacer: true },
          { label: "Status", w: "190px" },
          { label: "Submitted", w: "105px" },
          { label: "Amount", w: "155px", right: true }
        ],
        rows: rows,
        empty: "No withdrawals yet."
      }) + "</div>" +
      (Data.state.stale
        ? '<p class="freshline mt-8">Withdrawal feed interrupted · last-known states, re-syncing automatically.</p>'
        : "");
  }

  // ————— demo affordances (simulated webhooks, never client assertions) —————

  function depDemoHtml() {
    return '<span class="freshline">Demo · the bank and chain side, simulated.</span>' +
      '<div class="demo-strip">' +
        '<input class="db-inp" id="mvDemoAmt" inputmode="decimal" value="3,200,000.00" aria-label="Demo deposit amount">' +
        '<button class="db-btn" id="mvSimDep" type="button">Webhook: AED deposit detected</button>' +
        '<button class="db-btn" id="mvSimCredit" type="button">Webhook: oldest processing deposit credited</button>' +
        '<button class="db-btn" id="mvSimUnknown" type="button">Webhook: credit from an unknown sender, held</button>' +
        '<button class="db-btn" id="mvSimResolve" type="button">Desk: resolve the held credit</button>' +
      "</div>" +
      '<span class="freshline">The account name renders exactly as the bank registered it.</span>';
  }

  function wdDemoHtml() {
    return '<span class="freshline">Demo · the desk side, simulated.</span>' +
      '<div class="demo-strip">' +
        '<button class="db-btn" id="mvWdAdvance" type="button">Desk: advance the oldest in-flight withdrawal</button>' +
      "</div>";
  }

  // ————— region painting (M7) —————
  // The page entrance belongs to the page. A tab switch or a webhook
  // repaints one region and fades it; nothing replays the title, the tabs
  // or the rail cards. A row expand touches neither: it inserts one detail
  // node, which carries its own rise-in.

  function tabsHtml() {
    var inflight = Data.state.withdrawals.filter(function (w) { return w.state !== "confirmed"; }).length;
    return '<div class="seg">' +
      '<button class="seg-btn' + (TAB === "deposit" ? " active" : "") + '" data-tab="deposit" type="button">Deposit</button>' +
      '<button class="seg-btn' + (TAB === "withdraw" ? " active" : "") + '" data-tab="withdraw" type="button">Withdraw' +
        (inflight ? ' <span class="faint">' + inflight + "</span>" : "") + "</button>" +
      "</div>";
  }

  function secHtml(id) {
    if (TAB === "deposit") {
      if (id === "primary") return depRailsHtml();
      if (id === "aux") return canAct() ? expectedHtml() : "";
      if (id === "custody") return custodyHtml();
      if (id === "ledger") return incomingHtml();
      if (id === "demo") return depDemoHtml();
      return "";
    }
    if (id === "primary") return withdrawHtml();
    if (id === "ledger") return wdListHtml();
    if (id === "demo") return wdDemoHtml();
    return "";
  }

  function paint(id, fade) {
    var node = region(id);
    if (!node) return;
    var html = id === "tabs" ? tabsHtml() : secHtml(id);
    if (fade) swap(node, html); else node.innerHTML = html;
    if (id === "ledger") { insertOpenDetails(node); markSettled(node); }
  }

  function setTab(t) {
    if (TAB === t) return;
    TAB = t;
    paint("tabs", false);
    SECS.forEach(function (id) { paint(id, true); });
  }

  // expand-in-place details, inserted after their row so drilling down
  // never moves the operator off the list
  function insertOpenDetails(node) {
    Object.keys(OPEN).forEach(function (k) {
      if (!OPEN[k]) return;
      var row = node.querySelector('.row[data-key="' + k + '"]');
      if (!row) return;
      row.insertAdjacentHTML("afterend", detailHtml(k));
      // a detail that was already open is not arriving, so it does not
      // animate: the region it sits in is already doing that
      var d = row.nextElementSibling;
      if (d && d.classList) d.classList.add("mv-nofx");
    });
  }

  function detailHtml(k) {
    var id = k.split(":")[1];
    if (k.indexOf("dep:") === 0) {
      var d = Data.state.deposits.filter(function (x) { return x.id === id; })[0];
      return d ? depDetail(d) : "";
    }
    var w = Data.state.withdrawals.filter(function (x) { return x.id === id; })[0];
    return w ? '<div class="mv-row-detail"><div class="mv-detail-title">Withdrawal lifecycle · ' +
      UI.esc(w.id) + "</div>" + UI.timeline(wdTimeline(w)) + "</div>" : "";
  }

  function toggleRow(node, row) {
    var k = row.getAttribute("data-key");
    var open = !OPEN[k];
    OPEN[k] = open;
    row.classList.toggle("selected", open);
    var c = row.querySelector(".mv-caret");
    if (c) c.classList.toggle("open", open);
    var next = row.nextElementSibling;
    var hasDetail = next && next.classList && next.classList.contains("mv-row-detail");
    if (open && !hasDetail) row.insertAdjacentHTML("afterend", detailHtml(k));
    if (!open && hasDetail) next.remove();
  }

  // ————— completion moments (M4) —————
  // A deposit that credited and a withdrawal that confirmed are the two
  // terminal money events on this screen. Each is marked once, with the one
  // shared settle hairline, and only when it happens in front of the
  // operator. Seeded history never celebrates.

  function terminalNow() {
    var m = {};
    Data.state.deposits.forEach(function (d) { if (d.state === "credited") m["dep:" + d.id] = 1; });
    Data.state.withdrawals.forEach(function (w) { if (w.state === "confirmed") m["wd:" + w.id] = 1; });
    return m;
  }

  function markSettled(node) {
    var now = terminalNow();
    if (DONE === null) { DONE = now; return; }
    var fresh = Object.keys(now).filter(function (k) { return !DONE[k]; });
    DONE = now;
    if (!fresh.length) return;
    // one frame later, so the mark lands on the painted row whatever order
    // the region swap runs in
    requestAnimationFrame(function () {
      fresh.forEach(function (k) {
        settle(node.querySelector('.row[data-key="' + k + '"] .mv-idcell'));
      });
    });
  }

  // ————— wiring —————
  // One delegated listener set per region, attached once: the region shells
  // outlive every repaint, so nothing is ever double-bound.

  function wireOnce(node, id) {
    if (!node || node.getAttribute("data-wired")) return;
    node.setAttribute("data-wired", "1");

    if (id === "tabs") {
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-tab]");
        if (b) setTab(b.getAttribute("data-tab"));
      });
      return;
    }

    if (id === "primary") {
      node.addEventListener("input", function (e) {
        if (e.target.id !== "mvAmt") return;
        WD.amt = e.target.value;
        WD.err = "";
        var er = node.querySelector("#mvAmtErr");
        if (er) er.classList.add("hide");
      });
      node.addEventListener("change", function (e) {
        if (e.target.id === "mvCur") {
          WD.cur = e.target.value; WD.dest = ""; WD.err = "";
          paint("primary", true);
        }
        if (e.target.id === "mvDest") { WD.dest = e.target.value; WD.err = ""; }
      });
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("button");
        if (!b) return;
        if (b.hasAttribute("data-interest")) {
          var c = b.getAttribute("data-interest");
          INTEREST[c] = true;
          b.textContent = "You’re on the list";
          // second argument is the toast kind: a confirmation gets the tick, a
          // refusal never does (UI.toast(msg, "done" | "note" | "blocked"))
          UI.toast("Noted. We’ll email you when " + c + " is live.", "done");
          return;
        }
        if (b.id === "mvGoWl") {
          var wl = App.screen("whitelist");
          if (wl && wl.openTab) wl.openTab(WD.cur === "USDT" ? "wallets" : "banks");
          App.go("whitelist");
          return;
        }
        if (b.id === "mvNext") { validateAndReview(node); return; }
        if (b.id === "mvBack") { WD.stage = "form"; paint("primary", true); return; }
        if (b.id === "mvSubmit") { submitWithdrawal(); return; }
      });
      return;
    }

    if (id === "aux") {
      node.addEventListener("input", function (e) {
        if (e.target.id === "mvExpAmt") EXP.amt = e.target.value;
        else if (e.target.id === "mvExpNote") EXP.note = e.target.value;
        else return;
        var er = node.querySelector("#mvExpErr");
        if (er) er.classList.add("hide");
      });
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("#mvExpSend");
        if (!b) return;
        if (!EXP.amt && !EXP.note) {
          node.querySelector("#mvExpErr").classList.remove("hide");
          return;
        }
        EXP.amt = ""; EXP.note = "";
        node.querySelector("#mvExpAmt").value = "";
        node.querySelector("#mvExpNote").value = "";
        UI.toast("Noted for the desk.", "done");
      });
      return;
    }

    if (id === "custody") {
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-net]");
        if (!b) return;
        NET = b.getAttribute("data-net");
        paint("custody", true);
      });
      return;
    }

    if (id === "ledger") {
      node.addEventListener("click", function (e) {
        if (!e.target.closest) return;
        var held = e.target.closest("[data-held]");
        if (held) {
          var d = Data.state.deposits.filter(function (x) { return x.id === held.getAttribute("data-held"); })[0];
          if (d) openIdentify(d);
          return;
        }
        var row = e.target.closest(".row[data-key]");
        if (row) toggleRow(node, row);
      });
      return;
    }

    if (id === "demo") {
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("button");
        if (!b) return;
        var inp = node.querySelector("#mvDemoAmt");
        var amt = parseAmt(inp && inp.value);
        // every refusal below is "blocked": a refusal is not a failure, and it
        // is certainly not a green tick
        if (b.id === "mvSimDep") {
          if (!amt) { UI.toast("Enter a demo amount first.", "blocked"); return; }
          Data.simulateDeposit(amt);
        } else if (b.id === "mvSimCredit") {
          if (!Data.creditOldest()) UI.toast("Nothing processing. Detect a deposit first.", "blocked");
        } else if (b.id === "mvSimUnknown") {
          Data.unknownSenderCredit(amt || 750000);
        } else if (b.id === "mvSimResolve") {
          if (!Data.resolveHeld()) UI.toast("No held credit to resolve.", "blocked");
        } else if (b.id === "mvWdAdvance") {
          if (!Data.advanceWithdrawal()) UI.toast("Nothing in flight to advance.", "blocked");
        }
      });
    }
  }

  // validation states the two numbers and keeps the operator in the field,
  // instead of repainting the form out from under them
  function validateAndReview(node) {
    var a = parseAmt(WD.amt), bal = Data.state.bal[WD.cur], out = Data.inflightOut(WD.cur);
    var focus = "#mvAmt";
    WD.err = "";
    if (!a) {
      WD.err = "Enter an amount to withdraw.";
    } else if (a > bal) {
      WD.err = "Insufficient available balance. You asked for " + WD.cur + " " + UI.fmtNum(a) +
        " and " + WD.cur + " " + UI.fmtNum(bal) + " is available" +
        (out ? ", with " + WD.cur + " " + UI.fmtNum(out) + " already in flight out" : "") +
        ". Lower the amount or wait for a deposit to credit.";
    } else if (!WD.dest) {
      WD.err = "Select a destination first.";
      focus = "#mvDest";
    }
    if (WD.err) {
      var er = node.querySelector("#mvAmtErr");
      if (er) { er.textContent = WD.err; er.classList.remove("hide"); }
      var f = node.querySelector(focus);
      if (f) f.focus();
      return;
    }
    WD.stage = "review";
    paint("primary", true);
  }

  function submitWithdrawal() {
    UI.stepUp("Money is leaving Fasset. Confirm the withdrawal with your authenticator.", function () {
      var a = parseAmt(WD.amt), c = WD.cur, dst = WD.dest;
      WD = { cur: c, amt: "", dest: "", stage: "form", err: "" };
      Data.submitWithdrawal(c, a, dst);   // earmarks the amount at submit
    });
  }

  // ————— render —————

  function skeletonHtml() {
    return '<div class="section">' +
      "<div>" + UI.skel("180px", "28px") + "</div>" +
      '<div class="mt-32 mv-skel-row">' + UI.skel("48%", "190px") + UI.skel("48%", "190px") + "</div>" +
      '<div class="mt-32">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      "</div>";
  }

  function render(el) {
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

  // the shells are direct children of .screen, so the page entrance
  // choreography still owns the first paint
  function renderBody(el) {
    ROOT = el;
    el.insertAdjacentHTML("beforeend",
      '<div class="mv-tabs" data-mvsec="tabs"></div>' +
      SECS.map(function (id) {
        return '<div class="section mv-sec' + (id === "demo" ? " mv-demo" : "") + '" data-mvsec="' + id + '"></div>';
      }).join(""));
    ["tabs"].concat(SECS).forEach(function (id) { wireOnce(region(id), id); });
    paint("tabs", false);
    SECS.forEach(function (id) { paint(id, false); });
  }

  App.registerScreen("move", {
    title: "Move money",
    subtitle: "Deposits are detected automatically. Withdrawals are tracked at every step",
    zone: "app",
    // let another screen land on the right mode (Trade sends under-funded orders here)
    openTab: function (t) { TAB = t === "withdraw" ? "withdraw" : "deposit"; },
    render: render,
    // patch in place instead of rebuilding the screen: a webhook must not
    // replay the page entrance either
    onData: function (scope) {
      if (!ROOT || !document.body.contains(ROOT) || !region("ledger")) return false;
      // the shell already refreshed the bell; nothing here renders notifications
      if (scope === "notifs") return true;
      if (scope === "deposits" || scope === "withdrawals") {
        paint("tabs", false);
        if (TAB === "withdraw") paint("primary", true);
        paint("ledger", true);
        return true;
      }
      return false;
    }
  });
})();
