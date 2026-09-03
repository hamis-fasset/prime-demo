/* ————————————————————————————————————————————————
   Fasset Prime — introducing broker onboarding (ib-onboard).
   Added 2026-09-02, modeled on the status hub (hub.js): the same
   journey grammar, deliberately — spine, one state card, reviewer
   pushes from the Optimus side. It reuses the onboarding zone's
   journey furniture (.ob-*, .hub-*) by design: one journey grammar
   across the product, not two.

   Why this journey is its own thing and not the client KYC wizard:
   an IB is ALWAYS an individual and never a client — they never
   custody funds, never trade, never whitelist wallets. Per the
   2026-09-02 call the requirement is ID plus proof of address, so
   the journey is four steps:
     1 Identity          (passport + liveness)
     2 Proof of address  (country, address, document)
     3 Agreement         (the IB agreement, rate schedule included)
     4 Payout account    (their OWN name: AED bank account, or the
                          USDT Fireblocks container referral-<name>)
   The approval process itself is compliance's to define; the shape
   here is the working assumption until their spec lands.

   The wizard is one drawer (multi-step flows live in drawers), demo
   values prefilled. Review states: not_started → in_progress →
   in_review → needs_info | approved | rejected. The reviewer acts in
   Optimus (a compliance queue of individuals); the demo pushes stand
   in for that, and nothing on this side asserts an outcome.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var lastReview = null;   // for the settle on the transition into approved

  var STEPS = [
    { name: "Identity", sub: "Passport and a quick liveness check" },
    { name: "Proof of address", sub: "Country, address and a recent document" },
    { name: "Agreement", sub: "The introducing broker agreement, signed in place" },
    { name: "Payout account", sub: "In your own name · AED bank account or USDT container" }
  ];

  function J() { return Data.state.ib.journey; }

  function refLink() { return "prime.fasset.com/signup?ib=" + Data.state.ib.refCode; }

  // ————— spine —————

  function spine() {
    var r = J().review;
    var s2kind = r === "approved" ? "positive"
      : (r === "in_review") ? "info"
      : r === "needs_info" ? "warning"
      : r === "rejected" ? "error" : "neutral";
    var s2sub = {
      not_started: "not started",
      in_progress: "in progress · resume below",
      in_review: "with the review team",
      needs_info: "needs your input",
      approved: "approved",
      rejected: "declined"
    }[r] || "not started";
    var stages = [
      { kind: "positive", label: "Create account", sub: "email verified · MFA enrolled" },
      { kind: s2kind, label: "Verify and sign", sub: s2sub },
      { kind: r === "approved" ? "positive" : "neutral", label: "Start introducing",
        sub: r === "approved" ? "your referral link is live" : "opens at approval" }
    ];
    return '<div class="hub-spine">' + stages.map(function (s) {
      return '<div class="sp">' + UI.statusDot(s.kind, s.label) +
        '<span class="sp-sub">' + UI.esc(s.sub) + "</span></div>";
    }).join("") + "</div>";
  }

  function head(titleHtml, subHtml) {
    return '<h1 class="ob-title">' + titleHtml + "</h1>" +
      '<div class="hub-settle"></div>' +
      (subHtml ? '<p class="ob-sub">' + subHtml + "</p>" : "");
  }

  function stepList() {
    var done = J().stepsDone;
    return '<div class="ibj-steps">' + STEPS.map(function (s, i) {
      return "<div>" + UI.statusDot(i < done ? "positive" : "neutral", s.name) +
        '<span class="st-sub">' + UI.esc(s.sub) + "</span></div>";
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
      return head("Introduce clients to Fasset Prime.",
        "Four steps, as an individual. About ten minutes, and a human reviews it.") +
        stepList() + cta("Start", "ibjStart");
    }

    if (r === "in_progress") {
      return head("Pick up where you left off.",
        (j.stepsDone
          ? "You’re " + j.stepsDone + " of " + STEPS.length + " in."
          : "Your progress saves at every step.")) +
        stepList() + cta("Resume", "ibjStart");
    }

    if (r === "in_review") {
      return head("Your application is in review.",
        "Submitted <strong>" + UI.esc(UI.fmtDate(j.submittedIso || new Date().toISOString())) + "</strong>. A human reviewer is on it.");
    }

    if (r === "needs_info") {
      return head("The reviewer needs more information.",
        "Only the affected steps are unlocked.") +
        '<div class="ob-body">' + (j.comments || []).map(function (c) {
          return '<div class="ob-comment"><div class="cw">Step ' + (c.stepIdx + 1) + " · " +
            UI.esc(c.stepName) + " · " + UI.esc(c.target) + "</div>" + UI.esc(c.text) + "</div>";
        }).join("") + "</div>" +
        cta("Fix and resubmit", "ibjFix");
    }

    if (r === "approved") {
      return head("You’re approved. Your referral link is live.",
        "Clients who sign up through it appear in your portal once the desk confirms them.") +
        '<div class="ob-body">' +
        UI.copyRow("Referral link", refLink(), { copy: "https://" + refLink() }) +
        UI.copyRow("Payout account", Data.state.ib.payoutBank.bank + " · " + Data.state.ib.payoutBank.iban) +
        "</div>" +
        cta("Open your portal", "ibjGo");
    }

    if (r === "rejected") {
      return head("Application declined.",
        "Reason: <strong>" + UI.esc(j.rejectedReason || "Regulatory status could not be verified") + "</strong>.") +
        '<div class="ob-body">' +
        '<p class="ob-sub"><strong>What you can do</strong></p>' +
        '<ul class="ob-list">' +
        "<li>If your regulatory status has changed, reapply with the licence or registration attached.</li>" +
        "<li>If you believe the decision is wrong, reply to the decision email with supporting documents.</li>" +
        "<li>Write to partners@fasset.com and include the email you applied with.</li></ul></div>";
    }

    return '<div class="empty">No application yet.</div>';
  }

  // ————— the wizard drawer —————

  function attachRow(label, file) {
    return '<div class="ibw-attach" data-attach>' +
      UI.statusDot("positive", label) +
      '<span class="freshline">' + UI.esc(file) + " · attached</span></div>";
  }

  function openWizard() {
    var idx = Math.min(J().stepsDone, STEPS.length - 1);
    var vals = { agreed: false, payUsdt: Data.state.ib.payoutMethod === "usdt" };
    var h = UI.drawer("Introducing broker application", "", { width: 520 });

    function stepsBar() {
      return '<div class="steps">' + STEPS.map(function (s, i) {
        return '<span class="step' + (i === idx ? " active" : "") + '">' + UI.esc(s.name) + "</span>" +
          (i < STEPS.length - 1 ? '<span class="sep">·</span>' : "");
      }).join("") + "</div>";
    }

    function body() {
      var b = stepsBar();
      if (idx === 0) {
        b += '<div class="field"><label>Full legal name</label><input class="input" value="Karim Mansour"></div>' +
          '<div class="field"><label>Nationality</label><select class="select"><option>United Arab Emirates</option><option>Saudi Arabia</option><option>United Kingdom</option></select></div>' +
          '<div class="field"><label>Passport</label>' + attachRow("Passport scan", "passport.pdf") +
          '<div class="hint">A liveness check runs after upload.</div></div>';
      } else if (idx === 1) {
        b += '<div class="field"><label>Country of residence</label><select class="select"><option>United Arab Emirates</option><option>Saudi Arabia</option><option>Qatar</option></select></div>' +
          '<div class="field"><label>Residential address</label><input class="input" value="Villa 22, Al Wasl Road, Dubai"></div>' +
          '<div class="field"><label>Proof of address</label>' + attachRow("Utility bill", "dewa-august.pdf") +
          '<div class="hint">Issued in the last 3 months, in your name.</div></div>';
      } else if (idx === 2) {
        b += '<div class="field"><label>The agreement, in short</label>' +
          '<div class="ibw-terms">You earn <strong>0.10% of settled notional</strong> traded by clients you introduce. Accrued per trade, paid <strong>monthly</strong> to your verified payout account. Shared introductions pay your agreed split.</div>' +
          '<label class="ibw-ack"><input type="checkbox" id="ibwAgree"' + (vals.agreed ? " checked" : "") + ">" +
          "<span>I’ve read the full introducing broker agreement and I agree to it.</span></label>" +
          '<div class="hint err hide" id="ibwAgreeErr">Accept the agreement to continue.</div></div>';
      } else {
        b += '<div class="field"><label>How you want to be paid</label>' +
          '<button class="ibw-choice' + (!vals.payUsdt ? " sel" : "") + '" data-pay="bank" type="button">' +
            '<span><span class="wc-name">AED · bank account</span>' +
            '<span class="wc-sub">A bank account in your own name.</span></span></button>' +
          '<button class="ibw-choice' + (vals.payUsdt ? " sel" : "") + '" data-pay="usdt" type="button">' +
            '<span><span class="wc-name">USDT · Fireblocks container</span>' +
            '<span class="wc-sub">The desk creates referral-karim-mansour for you at approval.</span></span></button>' +
          "</div>" +
          (vals.payUsdt
            ? '<p class="freshline">Nothing to fill in.</p>'
            : '<div class="field"><label>Bank</label><input class="input" value="Emirates NBD"></div>' +
              '<div class="field"><label>IBAN</label><input class="input mono" value="AE12 0260 0009 8877 2210 034"></div>' +
              '<div class="field"><label>Account name</label><input class="input" value="Karim Mansour">' +
              '<div class="hint">Must match your legal name exactly.</div></div>');
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
        (idx === STEPS.length - 1 ? "Submit for review" : "Continue") + "</button>"
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
          Data.notify("Application submitted", "A human reviewer takes it from here.", "ib-onboard");
          h.close();
          return;
        }
        idx++;
        Data.ibSetJourney({ review: "in_progress", stepsDone: Math.max(J().stepsDone, idx) });
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

    var h = '<div class="bare-sheet ob-hub">' +
      '<div class="tile-label hub-eyebrow">Becoming an introducing broker</div>' +
      spine() +
      stateCard() +
      '<p class="freshline mt-24">Live · updates the moment the reviewer acts.</p>' +
      "</div>";

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
    if (fix) fix.addEventListener("click", openWizard);
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
    title: "IB onboarding",
    zone: "onboard",
    render: render
  });
})();
