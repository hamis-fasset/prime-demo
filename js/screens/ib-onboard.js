/* ————————————————————————————————————————————————
   Fasset Prime — introducing broker onboarding (ib-onboard).
   Added 2026-09-02, modeled on the status hub (hub.js); rebuilt to
   the taste brief 2026-09-04. Same journey grammar, deliberately:
   spine, one state card, reviewer pushes from the Optimus side. It
   reuses the onboarding zone's furniture (.ob-*, .hub-*) so there is
   one journey language across the product, not two.

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

   The state card says the status, what's flagged and what to do
   next, and nothing else. The wizard is one drawer; steps are
   instructions, not descriptions; the agreement is def-rows. Review
   states: not_started → in_progress → in_review → needs_info |
   approved | rejected. The reviewer acts in Optimus; the demo pushes
   stand in for that, and nothing on this side asserts an outcome.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var lastReview = null;   // for the settle on the transition into approved

  var STEPS = ["Identity", "Proof of address", "Agreement", "Payout account"];

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

  function rowHtml(name, detail, key) {
    return '<button class="option-row ob-row" data-ibrow="' + UI.esc(key) + '" type="button">' +
      '<span class="ob-row-main"><span class="opt-name">' + UI.esc(name) + "</span>" +
      (detail ? '<span class="opt-detail">' + UI.esc(detail) + "</span>" : "") + "</span>" +
      icon("chevronRight", 14, "chev") + "</button>";
  }

  function openComment(c) {
    var h = UI.drawer(c.target, "", {
      width: 440,
      foot: '<button class="btn btn-secondary" id="ibcClose" type="button">Close</button>' +
            '<button class="btn btn-primary" id="ibcFix" type="button">Fix</button>'
    });
    h.body.innerHTML = '<div class="def-group">' + drow("Step", UI.esc(c.stepName)) + "</div>" +
      '<p class="ob-text mt-16">' + UI.esc(c.text) + "</p>";
    h.el.querySelector("#ibcClose").addEventListener("click", h.close);
    h.el.querySelector("#ibcFix").addEventListener("click", function () { h.close(); openWizard(c.stepIdx); });
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

  // ————— the state card —————

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
          return rowHtml(c.target, c.stepName, "c" + i);
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
        '<div class="ob-rows hub-rows">' + rowHtml("Reason for the decision", "", "reason") + "</div>";
    }

    return '<div class="empty">No application yet.</div>';
  }

  // ————— the wizard drawer —————

  function attachRow(label, file) {
    return '<div class="ibw-attach" data-attach>' +
      UI.statusDot("positive", label) +
      '<span class="freshline">' + UI.esc(file) + " · attached</span></div>";
  }

  function field(label, controlHtml) {
    return '<div class="field"><label>' + UI.esc(label) + "</label>" + controlHtml + "</div>";
  }

  function openWizard(startIdx) {
    var ib = Data.state.ib;
    var idx = Math.max(0, Math.min(startIdx == null ? J().stepsDone : startIdx, STEPS.length - 1));
    var vals = { agreed: false, payUsdt: ib.payoutMethod === "usdt" };
    var h = UI.drawer("Introducing broker application", "", { width: 520 });

    function stepsBar() {
      return '<div class="steps" style="margin-bottom:16px">' + STEPS.map(function (s, i) {
        return '<span class="step' + (i === idx ? " active" : "") + '">' + UI.esc(s) + "</span>" +
          (i < STEPS.length - 1 ? '<span class="sep">·</span>' : "");
      }).join("") + "</div>";
    }

    function body() {
      var b = stepsBar();
      if (idx === 0) {
        b += field("Full legal name", '<input class="input" value="' + UI.esc(ib.user.name) + '" autocomplete="off">') +
          field("Nationality", '<select class="select"><option>United Arab Emirates</option><option>Saudi Arabia</option><option>United Kingdom</option></select>') +
          field("Passport", attachRow("Passport scan", "passport.pdf"));
      } else if (idx === 1) {
        b += field("Country of residence", '<select class="select"><option>United Arab Emirates</option><option>Saudi Arabia</option><option>Qatar</option></select>') +
          field("Residential address", '<input class="input" value="Villa 22, Al Wasl Road, Dubai" autocomplete="off">') +
          field("Proof of address · issued in the last 3 months", attachRow("Utility bill", "dewa-august.pdf"));
      } else if (idx === 2) {
        b += '<div class="def-group">' +
            drow("Rate", UI.esc(rateLabel()), true) +
            drow("Frequency", "Monthly") +
            drow("Split", "Per introduction") +
            drow("Paid to", "An account in your name") +
          "</div>" +
          '<label class="ibw-ack"><input type="checkbox" id="ibwAgree"' + (vals.agreed ? " checked" : "") + ">" +
          "<span>I agree to the introducing broker agreement.</span></label>" +
          '<div class="hint err hide" id="ibwAgreeErr">Accept the agreement to continue.</div>';
      } else {
        b += '<div class="field"><label>Paid to</label>' +
          '<button class="ibw-choice' + (!vals.payUsdt ? " sel" : "") + '" data-pay="bank" type="button">' +
            '<span class="wc-name">AED bank account</span></button>' +
          '<button class="ibw-choice' + (vals.payUsdt ? " sel" : "") + '" data-pay="usdt" type="button">' +
            '<span class="wc-name">USDT wallet</span></button>' +
          "</div>" +
          (vals.payUsdt
            ? '<div class="def-group">' +
                drow("Wallet", UI.esc(ib.payoutWallet.label), true) +
                drow("Network", UI.esc(ib.payoutWallet.net)) +
              "</div>"
            : field("Bank", '<input class="input" value="' + UI.esc(ib.payoutBank.bank) + '" autocomplete="off">') +
              field("IBAN", '<input class="input mono" value="' + UI.esc(ib.payoutBank.iban) + '" autocomplete="off">') +
              field("Account name", '<input class="input" value="' + UI.esc(ib.user.name) + '" autocomplete="off">'));
      }
      h.body.innerHTML = b;

      h.body.querySelectorAll("[data-pay]").forEach(function (c) {
        c.addEventListener("click", function () {
          vals.payUsdt = c.getAttribute("data-pay") === "usdt";
          body();
        });
      });
      var ack = h.body.querySelector("#ibwAgree");
      if (ack) ack.addEventListener("change", function () {
        vals.agreed = ack.checked;
        h.body.querySelector("#ibwAgreeErr").classList.add("hide");
      });

      h.setFoot(
        '<button class="btn btn-secondary" id="ibwBack" type="button">' + (idx === 0 ? "Cancel" : "Back") + "</button>" +
        '<button class="btn btn-primary" id="ibwNext" type="button">' +
        (idx === STEPS.length - 1 ? "Submit" : "Continue") + "</button>"
      );
      h.foot.querySelector("#ibwBack").addEventListener("click", function () {
        if (idx === 0) return h.close();
        idx--;
        body();
      });
      h.foot.querySelector("#ibwNext").addEventListener("click", function () {
        if (idx === 2 && !vals.agreed) {
          h.body.querySelector("#ibwAgreeErr").classList.remove("hide");
          return;
        }
        if (idx === STEPS.length - 1) {
          if ((Data.state.ib.payoutMethod === "usdt") !== vals.payUsdt) {
            Data.ibSetPayoutMethod(vals.payUsdt ? "usdt" : "bank");
          }
          Data.ibReviewerAction("in_review");
          Data.ibSetJourney({ stepsDone: STEPS.length });
          Data.notify("Application submitted", "", "ib-onboard");
          h.close();
          return;
        }
        idx++;
        // a fix-and-resubmit pass keeps its needs_info status until it is
        // actually resubmitted; only a fresh journey advances to in_progress
        var r = J().review;
        var patch = { stepsDone: Math.max(J().stepsDone, idx) };
        if (r === "not_started" || r === "in_progress") patch.review = "in_progress";
        Data.ibSetJourney(patch);
        body();
      });
    }

    body();
  }

  // ————— render —————

  var PUSHES = [
    { s: "in_review", label: "Submitted → in review" },
    { s: "needs_info", label: "Reviewer: request info (2 comments)" },
    { s: "approved", label: "Reviewer: approve" },
    { s: "rejected", label: "Reviewer: reject" },
    { s: "in_progress", label: "Reset: journey in progress" }
  ];

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
    var right = document.getElementById("bareRight");
    if (right) right.textContent = Data.state.ib.user.email;

    var h = '<div class="bare-sheet ob-hub">' + stateCard() + "</div>";

    h += '<div class="ob-demo wide"><div class="ob-demo-row">' +
      PUSHES.map(function (p) {
        return '<button class="db-btn' + (J().review === p.s ? " on" : "") + '" data-push="' + p.s + '" type="button">' +
          UI.esc(p.label) + "</button>";
      }).join("") + "</div>" +
      '<span class="freshline">Demo · stands in for the review queue in Optimus.</span>' +
      "</div>";

    el.insertAdjacentHTML("beforeend", h);

    // the settle fires on the transition into approved only — landing on an
    // already-approved page is not an event
    var now = J().review;
    if (lastReview && lastReview !== now && now === "approved") {
      UI.settleFlash(el.querySelector(".hub-settle"));
    }
    lastReview = now;

    var start = el.querySelector("#ibjStart");
    if (start) start.addEventListener("click", function () {
      if (J().review === "not_started") Data.ibSetJourney({ review: "in_progress" });
      openWizard();
    });
    var fix = el.querySelector("#ibjFix");
    if (fix) fix.addEventListener("click", function () {
      // open on the first flagged step, not the last one
      var cs = J().comments || [];
      openWizard(cs.length ? cs[0].stepIdx : 0);
    });
    el.querySelectorAll("[data-ibrow]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-ibrow");
        if (k === "reason") { openReason(); return; }
        var c = (J().comments || [])[parseInt(k.slice(1), 10)];
        if (c) openComment(c);
      });
    });
    var go = el.querySelector("#ibjGo");
    if (go) go.addEventListener("click", function () {
      Data.setPersona("ib");
      App.go("ib-overview");
    });

    el.querySelectorAll("[data-push]").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = b.getAttribute("data-push");
        if (s === "in_progress") Data.ibSetJourney({ review: "in_progress" });
        else Data.ibReviewerAction(s);
      });
    });
  }

  App.registerScreen("ib-onboard", {
    title: "Introducing broker",
    zone: "onboard",
    render: render
  });
})();
