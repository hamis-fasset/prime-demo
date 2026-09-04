/* ————————————————————————————————————————————————
   Fasset Prime — introducing broker onboarding (ib-onboard).
   Added 2026-09-02, modeled on the status hub (hub.js); rebuilt to
   the taste brief 2026-09-04. Same journey grammar, deliberately:
   spine, one state card, reviewer pushes from the Optimus side. It
   reuses the onboarding zone's furniture (.ob-*, .hub-*, .wiz-*) so
   there is one journey language across the product, not two.

   Why this journey is its own thing and not the client KYC wizard:
   an IB is ALWAYS an individual and never a client — they never
   custody funds, never trade, never whitelist wallets. Per the
   2026-09-02 call the requirement is ID plus proof of address, so
   the journey is four steps:
     1 Identity          (passport)
     2 Proof of address  (country, address, document)
     3 Agreement         (rate · frequency · split · destination)
     4 Payout account    (their OWN name: AED bank account, or the
                          USDT wallet referral-<name>)
   The approval process itself is compliance's to define; the shape
   here is the working assumption until their spec lands.

   Two views, one screen (2026-09-04, Hamis: "it should be screens").
   The hub view is the state card: the status, what's flagged and
   what to do next, and nothing else. Start / Resume / Fix navigate
   INTO the wizard view, rendered in the same bare sheet in kyc.js's
   grammar: a ghost Back top-left, the step spine, one step per view,
   the step title as h1, the fields, and a bottom row holding only
   the primary. Nothing here opens a drawer except a reviewer comment
   and the decision reason. Submitting sets in_review and lands back
   on the hub view.

   Review states: not_started → in_progress → in_review → needs_info
   | approved | rejected. The reviewer acts in Optimus; the demo
   pushes stand in for that, and nothing on this side asserts an
   outcome. journey.stepsDone drives the spine and the step list.

   Every local move (a step change, a payout choice, a reviewer push
   while the hub is up) repaints its region in place (UI.repaint);
   only a view change replays the page entrance.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var lastReview = null;   // for the settle on the transition into approved
  var rootEl = null;       // the .screen we last rendered into
  var view = "hub";        // "hub" | "wizard" — screen-local, re-rendered in place
  var wiz = null;          // { idx, agreed, payUsdt, f } while the wizard view is up

  var STEPS = ["Identity", "Proof of address", "Agreement", "Payout account"];
  // once the application is with the reviewer (or decided) there is nothing
  // to fill in, so the wizard view drops back to the hub
  var TERMINAL = ["in_review", "approved", "rejected"];

  function J() { return Data.state.ib.journey; }

  function refLink() { return "prime.fasset.com/signup?ib=" + Data.state.ib.refCode; }

  function rateLabel() { return (Data.state.ib.rateBps / 100).toFixed(2) + "%"; }

  function drow(label, valueHtml, strong) {
    return '<div class="def-row"><span class="def-label">' + UI.esc(label) +
      '</span><span class="def-value' + (strong ? " strong" : "") + '">' + valueHtml + "</span></div>";
  }

  // ————— timeline: the hub's grammar, labels and timestamps only —————

  function timeline() {
    var j = J(), r = j.review;
    var sub = j.submittedIso ? UI.fmtTs(j.submittedIso) : "";
    var items = [{ label: "Account created", state: "done" }];
    if (r === "not_started" || r === "in_progress") {
      items.push({ label: "Verification", state: r === "in_progress" ? "active" : "todo" });
      items.push({ label: "Pending review", state: "todo" });
      items.push({ label: "Approved", state: "todo" });
    } else if (r === "rejected") {
      items.push({ label: "Submitted", state: "done", time: sub });
      items.push({ label: "Rejected", state: "failed" });
    } else {
      items.push({ label: "Submitted", state: "done", time: sub });
      items.push({ label: r === "needs_info" ? "Needs your input" : "Pending review",
        state: r === "approved" ? "done" : "pending" });
      items.push({ label: "Approved", state: r === "approved" ? "done" : "todo" });
    }
    return '<div class="hub-timeline">' + UI.timeline(items) + "</div>";
  }

  function rowHtml(name, detail, attr, key) {
    return '<button class="option-row ob-row" ' + attr + '="' + UI.esc(key) + '" type="button">' +
      '<span class="ob-row-main"><span class="opt-name">' + UI.esc(name) + "</span>" +
      (detail ? '<span class="opt-detail">' + UI.esc(detail) + "</span>" : "") + "</span>" +
      icon("chevronRight", 14, "chev") + "</button>";
  }

  // a reviewer comment: the text lives here, never in the row. From the hub
  // the drawer offers Fix (into the wizard on that step); inside the wizard
  // you are already on the step, so it only closes.
  function openComment(c, inWizard) {
    var h = UI.drawer(c.target, "", {
      width: 440,
      foot: '<button class="btn btn-secondary" id="ibcClose" type="button">Close</button>' +
            (inWizard ? "" : '<button class="btn btn-primary" id="ibcFix" type="button">Fix</button>')
    });
    h.body.innerHTML = '<div class="def-group">' + drow("Step", UI.esc(c.stepName)) + "</div>" +
      '<p class="ob-text mt-16">' + UI.esc(c.text) + "</p>";
    h.el.querySelector("#ibcClose").addEventListener("click", h.close);
    var fix = h.el.querySelector("#ibcFix");
    if (fix) fix.addEventListener("click", function () {
      h.close();
      enterWizard(c.stepIdx);
      App.rerender();
    });
  }

  function openReason() {
    var h = UI.drawer("Decision", "", {
      width: 440,
      foot: '<button class="btn btn-secondary" id="ibrClose" type="button">Close</button>'
    });
    h.body.innerHTML = '<div class="def-group">' +
        drow("Status", UI.statusDot("error", "Rejected")) +
        drow("Reason", UI.esc(J().rejectedReason || "Identity could not be verified")) +
      "</div>" +
      '<p class="ob-text mt-16">To appeal, reply to the decision email with supporting documents.</p>';
    h.el.querySelector("#ibrClose").addEventListener("click", h.close);
  }

  // title and sub are HTML: the state copy carries one <strong> around a
  // date or a decision reason. Every value interpolated at the call sites
  // below goes through UI.esc first.
  function head(titleHtml, subHtml) {
    return '<h1 class="ob-title">' + titleHtml + "</h1>" +
      '<div class="hub-settle"></div>' +
      (subHtml ? '<p class="ob-sub">' + subHtml + "</p>" : "");
  }

  function stepList() {
    var done = J().stepsDone;
    return '<div class="ibj-steps">' + STEPS.map(function (s, i) {
      return "<div>" + UI.statusDot(i < done ? "positive" : "neutral", s) + "</div>";
    }).join("") + "</div>";
  }

  function cta(label, id) {
    return '<div class="ob-cta-row"><button class="btn btn-primary btn-lg" id="' + id + '" type="button">' +
      UI.esc(label) + "</button></div>";
  }

  // ————— the hub view: one state card —————

  function stateCard() {
    var j = J(), r = j.review;

    if (r === "not_started") {
      return head("Ready when you are.", "About ten minutes.") + timeline() +
        stepList() + cta("Start", "ibjStart");
    }

    if (r === "in_progress") {
      return head("Verification in progress.", "") + timeline() +
        stepList() + cta("Resume", "ibjStart");
    }

    if (r === "in_review") {
      return head("Pending review.", "") + timeline();
    }

    if (r === "needs_info") {
      var cs = j.comments || [];
      return head("Needs your input.", "") + timeline() +
        (cs.length ? '<div class="ob-rows hub-rows">' + cs.map(function (c, i) {
          return rowHtml(c.target, c.stepName, "data-ibrow", "c" + i);
        }).join("") + "</div>" : "") +
        cta("Fix and resubmit", "ibjFix");
    }

    if (r === "approved") {
      return head("Approved.", "") + timeline() +
        '<div class="ob-body">' + UI.copyRow("Referral link", refLink(), { copy: "https://" + refLink() }) + "</div>" +
        cta("Open portal", "ibjGo");
    }

    if (r === "rejected") {
      return head("Rejected.", "") + timeline() +
        '<div class="ob-rows hub-rows">' + rowHtml("Reason for the decision", "", "data-ibrow", "reason") + "</div>";
    }

    return '<div class="empty">No application yet.</div>';
  }

  function hubHtml() {
    return '<div class="bare-sheet ob-hub">' + stateCard() + "</div>";
  }

  function wireHub(el) {
    var start = el.querySelector("#ibjStart");
    if (start) start.addEventListener("click", function () {
      enterWizard();
      // a fresh journey moves to in_progress; that emit re-renders onto the
      // wizard view. A resumed one has nothing to write, so it re-renders itself.
      if (J().review === "not_started") Data.ibSetJourney({ review: "in_progress" });
      else App.rerender();
    });
    var fix = el.querySelector("#ibjFix");
    if (fix) fix.addEventListener("click", function () {
      // open on the first flagged step, not the last one
      var cs = J().comments || [];
      enterWizard(cs.length ? cs[0].stepIdx : 0);
      App.rerender();
    });
    el.querySelectorAll("[data-ibrow]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-ibrow");
        if (k === "reason") { openReason(); return; }
        var c = (J().comments || [])[parseInt(k.slice(1), 10)];
        if (c) openComment(c, false);
      });
    });
    var go = el.querySelector("#ibjGo");
    if (go) go.addEventListener("click", function () {
      Data.setPersona("ib");
      App.go("ib-overview");
    });
  }

  // the settle fires on the transition into approved only — landing on an
  // already-approved page is not an event
  function markSettle(el) {
    var now = J().review;
    if (lastReview && lastReview !== now && now === "approved") {
      var host = el.querySelector(".hub-settle");
      if (host) UI.settleFlash(host);
    }
    lastReview = now;
  }

  // a reviewer push while the hub is up repaints the card, not the page
  function paintHub() {
    var hub = rootEl && rootEl.querySelector(".ob-hub");
    if (!hub) { App.rerender(); return; }
    UI.repaint(hub, stateCard());
    wireHub(hub);
    markSettle(hub);
    syncDemo();
  }

  // ————— the wizard view —————

  function enterWizard(startIdx) {
    var idx = startIdx == null ? J().stepsDone : startIdx;
    wiz = {
      idx: Math.max(0, Math.min(idx, STEPS.length - 1)),
      agreed: false,
      payUsdt: Data.state.ib.payoutMethod === "usdt",
      f: {}   // typed values, so Back never loses an answer
    };
    view = "wizard";
  }

  function leaveWizard() {
    wiz = null;
    view = "hub";
  }

  function commentsFor(i) {
    if (J().review !== "needs_info") return [];
    return (J().comments || []).filter(function (c) { return c.stepIdx === i; });
  }

  function fv(k, def) { return wiz.f[k] != null ? wiz.f[k] : def; }

  function inp(k, def, mono) {
    return '<input class="input' + (mono ? " mono" : "") + '" data-k="' + k + '" value="' + UI.esc(fv(k, def)) + '" autocomplete="off">';
  }

  function sel(k, opts, def) {
    var v = fv(k, def);
    return '<select class="select" data-k="' + k + '">' + opts.map(function (o) {
      return "<option" + (o === v ? " selected" : "") + ">" + UI.esc(o) + "</option>";
    }).join("") + "</select>";
  }

  function attachRow(label, file) {
    return '<div class="ibw-attach" data-attach>' +
      UI.statusDot("positive", label) +
      '<span class="freshline">' + UI.esc(file) + " · attached</span></div>";
  }

  function field(label, controlHtml) {
    return '<div class="field"><label>' + UI.esc(label) + "</label>" + controlHtml + "</div>";
  }

  // the spine's contents alone: a step change rewrites these in place and
  // does not animate. Steps past the furthest one reached are inert.
  function wizSpineInner() {
    var done = J().stepsDone, idx = wiz.idx, reach = Math.max(done, idx);
    return STEPS.map(function (s, i) {
      var isDone = i < done && i !== idx;
      var ahead = i > reach;
      var cls = "wiz-step" + (i === idx ? " cur" : "") + (isDone ? " donestep" : "") + (ahead ? " ibw-ahead" : "");
      return '<button class="' + cls + '"' + (ahead ? " disabled" : ' data-ws="' + i + '"') + ' type="button">' +
        '<span class="wiz-num">' + (isDone ? icon("check", 10) : (i + 1)) + "</span>" +
        "<span>" + UI.esc(s) + "</span></button>";
    }).join("");
  }

  function commentRowsHtml(cs) {
    if (!cs.length) return "";
    return '<div class="ob-rows mt-16">' + cs.map(function (c, n) {
      return rowHtml(c.target, "Reviewer comment", "data-ibwc", String(n));
    }).join("") + "</div>";
  }

  function wizBodyHtml() {
    var ib = Data.state.ib, i = wiz.idx;
    var h = '<h1 class="ob-title">' + UI.esc(STEPS[i]) + "</h1>";
    h += commentRowsHtml(commentsFor(i));
    h += '<div class="ob-body">';

    if (i === 0) {
      h += field("Full legal name", inp("name", ib.user.name)) +
        field("Nationality", sel("nat", ["United Arab Emirates", "Saudi Arabia", "United Kingdom"], "United Arab Emirates")) +
        field("Passport", attachRow("Passport scan", "passport.pdf"));
    } else if (i === 1) {
      h += field("Country of residence", sel("cty", ["United Arab Emirates", "Saudi Arabia", "Qatar"], "United Arab Emirates")) +
        field("Residential address", inp("addr", "Villa 22, Al Wasl Road, Dubai")) +
        field("Proof of address · issued in the last 3 months", attachRow("Utility bill", "dewa-august.pdf"));
    } else if (i === 2) {
      h += '<div class="def-group">' +
          drow("Rate", UI.esc(rateLabel()), true) +
          drow("Frequency", "Monthly") +
          drow("Split", "Per introduction") +
          drow("Paid to", "An account in your name") +
        "</div>" +
        '<label class="ibw-ack"><input type="checkbox" id="ibwAgree"' + (wiz.agreed ? " checked" : "") + ">" +
        "<span>I agree to the introducing broker agreement.</span></label>" +
        '<div class="hint err hide" id="ibwAgreeErr">Accept the agreement to continue.</div>';
    } else {
      h += '<div class="field"><label>Paid to</label>' +
        '<button class="ibw-choice' + (!wiz.payUsdt ? " sel" : "") + '" data-pay="bank" type="button">' +
          '<span class="wc-name">AED bank account</span></button>' +
        '<button class="ibw-choice' + (wiz.payUsdt ? " sel" : "") + '" data-pay="usdt" type="button">' +
          '<span class="wc-name">USDT wallet</span></button>' +
        "</div>" +
        (wiz.payUsdt
          ? '<div class="def-group">' +
              drow("Wallet", UI.esc(ib.payoutWallet.label), true) +
              drow("Network", UI.esc(ib.payoutWallet.net)) +
            "</div>"
          : field("Bank", inp("bank", ib.payoutBank.bank)) +
            field("IBAN", inp("iban", ib.payoutBank.iban, true)) +
            field("Account name", inp("acct", ib.user.name)));
    }

    h += "</div>";
    // the bottom row holds the primary and nothing else; Back lives top-left
    h += '<div class="ob-cta-row"><button class="btn btn-primary" id="ibwNext" type="button">' +
      (i === STEPS.length - 1 ? "Submit" : "Continue") + "</button></div>";
    return h;
  }

  function wizardHtml() {
    return '<div class="bare-sheet ob-sheet bare-sheet-wide ibw-sheet">' +
      '<div class="ibw-top"><button class="btn btn-ghost" id="ibwBack" type="button">' +
        icon("chevronLeft", 14) + "Back</button></div>" +
      '<div class="wiz-grid" id="ibwGrid">' +
        '<div class="wiz-spine">' + wizSpineInner() + "</div>" +
        '<div class="wiz-body">' + wizBodyHtml() + "</div>" +
      "</div></div>";
  }

  // the local repaint: spine in place, body over 200ms. A step change is one
  // region changing, not a page arriving.
  function paintWiz() {
    var grid = rootEl && rootEl.querySelector("#ibwGrid");
    if (!grid || !wiz) { App.rerender(); return; }
    var spine = grid.querySelector(".wiz-spine");
    var body = grid.querySelector(".wiz-body");
    spine.innerHTML = wizSpineInner();
    UI.repaint(body, wizBodyHtml());
    wireWizSpine(spine);
    wireWizBody(body);
    syncDemo();
  }

  function wireWizSpine(spine) {
    spine.querySelectorAll("[data-ws]").forEach(function (b) {
      b.addEventListener("click", function () {
        wiz.idx = +b.getAttribute("data-ws");
        paintWiz();
      });
    });
  }

  function wireWizBody(body) {
    body.querySelectorAll("[data-k]").forEach(function (c) {
      var on = function () { wiz.f[c.getAttribute("data-k")] = c.value; };
      c.addEventListener("input", on);
      c.addEventListener("change", on);
    });
    body.querySelectorAll("[data-pay]").forEach(function (c) {
      c.addEventListener("click", function () {
        wiz.payUsdt = c.getAttribute("data-pay") === "usdt";
        paintWiz();
      });
    });
    var ack = body.querySelector("#ibwAgree");
    if (ack) ack.addEventListener("change", function () {
      wiz.agreed = ack.checked;
      body.querySelector("#ibwAgreeErr").classList.add("hide");
    });
    var cs = commentsFor(wiz.idx);
    body.querySelectorAll("[data-ibwc]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = cs[+b.getAttribute("data-ibwc")];
        if (c) openComment(c, true);
      });
    });
    var next = body.querySelector("#ibwNext");
    if (next) next.addEventListener("click", nextStep);
  }

  function nextStep() {
    var i = wiz.idx;
    if (i === 2 && !wiz.agreed) {
      var err = rootEl && rootEl.querySelector("#ibwAgreeErr");
      if (err) err.classList.remove("hide");
      return;
    }
    if (i === STEPS.length - 1) {
      var payUsdt = wiz.payUsdt;
      // the view flips first, so every emit below re-renders onto the hub
      leaveWizard();
      if ((Data.state.ib.payoutMethod === "usdt") !== payUsdt) {
        Data.ibSetPayoutMethod(payUsdt ? "usdt" : "bank");
      }
      Data.ibSetJourney({ stepsDone: STEPS.length });
      Data.ibReviewerAction("in_review");
      Data.notify("Application submitted", "", "ib-onboard");
      return;
    }
    wiz.idx = i + 1;
    // a fix-and-resubmit pass keeps its needs_info status until it is
    // actually resubmitted; only a fresh journey advances to in_progress
    var r = J().review;
    var patch = { stepsDone: Math.max(J().stepsDone, wiz.idx) };
    if (r === "not_started" || r === "in_progress") patch.review = "in_progress";
    Data.ibSetJourney(patch);   // emits "ib"; onData repaints the wizard in place
  }

  function wireWizard(el) {
    var back = el.querySelector("#ibwBack");
    if (back) back.addEventListener("click", function () {
      // top-left, never in the bottom row. On step 1 it is the way out.
      if (wiz.idx === 0) { leaveWizard(); App.rerender(); return; }
      wiz.idx--;
      paintWiz();
    });
    var grid = el.querySelector("#ibwGrid");
    wireWizSpine(grid.querySelector(".wiz-spine"));
    wireWizBody(grid.querySelector(".wiz-body"));
  }

  // ————— demo pushes: stand in for the review queue in Optimus —————

  var PUSHES = [
    { s: "in_review", label: "Submitted → in review" },
    { s: "needs_info", label: "Reviewer: request info (2 comments)" },
    { s: "approved", label: "Reviewer: approve" },
    { s: "rejected", label: "Reviewer: reject" },
    { s: "in_progress", label: "Reset: journey in progress" }
  ];

  function demoHtml() {
    return '<div class="ob-demo wide"><div class="ob-demo-row">' +
      PUSHES.map(function (p) {
        return '<button class="db-btn' + (J().review === p.s ? " on" : "") + '" data-push="' + p.s + '" type="button">' +
          UI.esc(p.label) + "</button>";
      }).join("") + "</div>" +
      '<span class="freshline">Demo · stands in for the review queue in Optimus.</span>' +
      "</div>";
  }

  function wireDemo(el) {
    el.querySelectorAll("[data-push]").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = b.getAttribute("data-push");
        if (s === "in_progress") Data.ibSetJourney({ review: "in_progress" });
        else Data.ibReviewerAction(s);
      });
    });
  }

  function syncDemo() {
    if (!rootEl) return;
    rootEl.querySelectorAll("[data-push]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-push") === J().review);
    });
  }

  // ————— render —————

  function skeletonHtml() {
    return '<div class="bare-sheet ob-hub">' +
      '<div class="hub-spine">' + UI.skel("100%", "14px") + UI.skel("100%", "14px") + UI.skel("100%", "14px") + "</div>" +
      '<div class="mt-32">' + UI.skel("100%", "30px") + "</div>" +
      '<div class="mt-12">' + UI.skel("80%", "14px") + "</div>" +
      '<div class="mt-24">' + UI.skel("160px", "34px") + "</div>" +
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
      }, 320);
      return;
    }
    renderBody(el);
  }

  function renderBody(el) {
    rootEl = el;
    var right = document.getElementById("bareRight");
    if (right) right.textContent = Data.state.ib.user.email;

    // the wizard has nothing to show once the application has left the
    // applicant's hands
    if (view === "wizard" && (!wiz || TERMINAL.indexOf(J().review) >= 0)) leaveWizard();

    el.insertAdjacentHTML("beforeend", (view === "wizard" ? wizardHtml() : hubHtml()) + demoHtml());

    if (view === "wizard") wireWizard(el);
    else { wireHub(el); markSettle(el); }
    wireDemo(el);
  }

  App.registerScreen("ib-onboard", {
    title: "Introducing broker",
    zone: "onboard",
    render: render,
    // the screen holds its view and the wizard's answers locally. A reviewer
    // push or a step save repaints the region that changed; a notification
    // repaints nothing. Only a view change replays the page entrance.
    onData: function (scope) {
      if (scope === "notifs") return true;
      if (scope !== "ib") return false;
      if (view === "wizard" && TERMINAL.indexOf(J().review) >= 0) { leaveWizard(); return false; }
      if (!loadedOnce || !rootEl || !document.body.contains(rootEl)) return false;
      if (view === "wizard") paintWiz(); else paintHub();
      return true;
    }
  });
})();
