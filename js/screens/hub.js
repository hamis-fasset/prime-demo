/* ————————————————————————————————————————————————
   Fasset Prime — Onboarding status hub (J4 monitor + J5 act entry).
   Built in wave 2, ported from prime-v2.standalone.html.

   The three-stage journey spine (create account · complete
   verification · start trading) plus one state card that is the
   whole screen: the current state as the 30px title, one gray line
   under it, and at most one action.

   Every review state is reachable: not_started · in_progress ·
   parked (deliberately no progress figure: nothing is progressing,
   and the product won't pretend otherwise) · in_review · needs_info
   (the reviewer's exact comments, pinned; only affected steps
   reopen) · approved with rails being issued (nothing to copy yet)
   · approved with rails issued (copyable details, Data.ACCOUNT_NAME
   verbatim) · rejected (reason plus a path forward).

   Reviewer pushes come from Data.reviewerAction(state). The client
   side never asserts an outcome; the hub reflects a decision made in
   Optimus and pushed here.

   States per element: loading (one skeleton pass per app load) ·
   empty (not_started: no application yet) · error/failed (rejected;
   plus the "we may be showing you an old status" degraded note) ·
   stale/degraded (status feed interrupted, last-known status with
   its timestamp) · permission-denied (a viewer teammate can follow
   the application but can't work on it).
   Data API: Data.state.journey · Data.reviewerAction · Data.setJourney.

   Wave-3: approval is the most emotionally loaded moment in the
   product and it used to land as a text swap. It now carries the
   shared completion mark (UI.settleFlash: one accent hairline under
   the line that clears you), fired only on the transition into
   approved, never on arriving at an already-approved account. The
   journey spine finally has a spine: a hairline between the stage
   dots, which is data, not decoration.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var lastSig = null;   // the review signature last painted, for the settle

  function total() { return Data.state.journey.entity === "institution" ? 5 : 4; }

  function progress() {
    // kyc.js (same owner) publishes its step progress; the hub only reads it
    var p = window.PrimeKyc && window.PrimeKyc.progress ? window.PrimeKyc.progress() : null;
    return p && p.total ? p : null;
  }

  function spine() {
    var J = Data.state.journey, r = J.review;

    var s2kind = r === "approved" ? "positive"
      : (r === "in_review" || r === "needs_info" || r === "parked") ? "info"
      : r === "rejected" ? "error" : "neutral";
    var s2sub = {
      not_started: "not started",
      in_progress: "in progress · resume below",
      parked: "being reviewed before onboarding",
      in_review: "with the review team",
      needs_info: "needs your input",
      approved: "approved",
      rejected: "declined"
    }[r] || "not started";
    if (r === "needs_info") s2kind = "warning";

    var s3kind = r === "approved" ? (J.railsIssuing ? "info" : "positive") : "neutral";
    var s3sub = r === "approved"
      ? (J.railsIssuing ? "your deposit details are being issued" : "your deposit details are issued")
      : "opens at approval";

    var stages = [
      { kind: "positive", label: "Create account", sub: "email verified · MFA enrolled" },
      { kind: s2kind, label: "Complete verification", sub: s2sub },
      { kind: s3kind, label: "Start trading", sub: s3sub }
    ];

    return '<div class="hub-spine">' + stages.map(function (s) {
      return '<div class="sp">' + UI.statusDot(s.kind, s.label) +
        '<span class="sp-sub">' + UI.esc(s.sub) + "</span></div>";
    }).join("") + "</div>";
  }

  // title and sub are HTML, not text: the state copy carries one <strong>
  // around a date or a decision reason. Every value interpolated into them
  // at the call sites below is passed through UI.esc first. This is the one
  // function in the screen that trusts its arguments, deliberately, and it
  // must never be handed a string that came from outside Data.
  function head(titleHtml, subHtml) {
    return '<h1 class="ob-title">' + titleHtml + "</h1>" +
      // the settle's host. It reserves exactly the 9px the hairline occupies
      // (8px offset + 1px rule), so the completion mark arrives and leaves
      // without moving a word of the copy under it.
      '<div class="hub-settle"></div>' +
      (subHtml ? '<p class="ob-sub">' + subHtml + "</p>" : "");
  }

  // the review state, plus whether the rails exist yet. The two together
  // are what "approved" actually means to a client
  function sig() {
    var J = Data.state.journey;
    return J.review + (J.review === "approved" ? (J.railsIssuing ? ":issuing" : ":issued") : "");
  }

  function act(label, id) {
    if (Data.state.role === "viewer") {
      return '<p class="ob-sub">Only an admin can work on the application. You can follow its status here.</p>';
    }
    return '<div class="ob-cta-row"><button class="btn btn-primary btn-lg" id="' + id + '" type="button">' +
      UI.esc(label) + "</button></div>";
  }

  function stateCard() {
    var J = Data.state.journey, r = J.review;

    if (r === "not_started" || r === "in_progress") {
      var p = progress();
      var t = p ? p.total : total();
      var doneCount = p ? p.done : 0;
      return head(r === "not_started" ? "Ready when you are." : "Pick up where you left off.",
        t + " steps, then a review before you submit. Your progress saves as you go" +
        (r === "in_progress" && doneCount ? ", and you’re " + doneCount + " of " + t + " in" : "") + ".") +
        act(r === "not_started" ? "Start verification" : "Resume", "hubResume");
    }

    if (r === "parked") {
      return head("Your application is being reviewed before onboarding opens.",
        "Some applications get an extra look first. Nothing for you to do; we’ll email you the moment it moves.") +
        '<p class="ob-legal">Questions? Write to onboarding@fasset.com and include the email you signed up with.</p>';
    }

    if (r === "in_review") {
      return head("Your application is in review.",
        "Submitted <strong>" + UI.esc(UI.fmtDate(J.submittedIso || new Date().toISOString())) + "</strong>. A human reviewer is on it, and we’ll notify you the moment anything changes.") +
        '<div class="ob-body"><div class="note note-info">If anything needs fixing, the reviewer’s comments appear here.</div></div>' +
        '<div class="ob-cta-row"><button class="btn btn-secondary" id="hubMsg" type="button">Message us</button></div>';
    }

    if (r === "needs_info") {
      return head("The reviewer needs more information.",
        "Only the affected steps are unlocked.") +
        '<div class="ob-body">' + (J.comments || []).map(function (c) {
          return '<div class="ob-comment"><div class="cw">Step ' + (c.stepIdx + 1) + " · " +
            UI.esc(c.stepName) + " · " + UI.esc(c.target) + "</div>" + UI.esc(c.text) + "</div>";
        }).join("") + "</div>" +
        act("Fix and resubmit", "hubFix");
    }

    if (r === "approved" && J.railsIssuing) {
      return head("You’re approved. Your deposit details are being set up.",
        "Your AED vIBAN and USDT deposit address are being created. We’ll notify you the moment they’re ready.") +
        '<div class="ob-body"><div class="note note-info">Nothing to copy yet.</div></div>' +
        act("Go to dashboard", "hubGo");
    }

    if (r === "approved") {
      return head("You’re approved and ready to fund.",
        "Everything you need to fund is below.") +
        '<div class="ob-body">' +
        UI.copyRow("AED vIBAN", Data.VIBANS.AED.iban, { mono: true, copy: Data.VIBANS.AED.copy }) +
        UI.copyRow("Account name", Data.ACCOUNT_NAME) +
        UI.copyRow("USDT wallet", Data.USDT_ADDRS.TRC20 + " (TRC20)", { mono: true, copy: Data.USDT_ADDRS.TRC20 }) +
        '<p class="freshline mt-8">Copy the account name exactly as shown, or the transfer fails the bank’s name check.</p>' +
        "</div>" +
        act("Go to dashboard", "hubGo");
    }

    if (r === "rejected") {
      return head("Application declined.",
        "Reason: <strong>" + UI.esc(J.rejectedReason || "Source of funds could not be verified") + "</strong>.") +
        '<div class="ob-body"><div class="note note-error">This decision applies to the application as submitted.</div>' +
        '<p class="ob-sub"><strong>What you can do</strong></p>' +
        '<ul class="ob-list">' +
        "<li>Reapply after 30 days with bank statements covering the last 6 months.</li>" +
        "<li>If you believe the decision is wrong, reply to the decision email with supporting documents.</li>" +
        "<li>Write to onboarding@fasset.com and include the email you applied with.</li></ul></div>";
    }

    return '<div class="empty">No application on this account yet.</div>';
  }

  var PUSHES = [
    { s: "in_review", label: "Submitted → in review" },
    { s: "needs_info", label: "Reviewer: request info (2 comments)" },
    { s: "approved_issuing", label: "Reviewer: approve (rails being issued)" },
    { s: "approved", label: "Reviewer: approve (rails issued)" },
    { s: "rejected", label: "Reviewer: reject" },
    { s: "parked", label: "Triage: park" },
    { s: "in_progress", label: "Reset: journey in progress" }
  ];

  function skeletonHtml() {
    return '<div class="bare-sheet ob-hub">' +
      // the spine's own grid, so the wait is shaped like what lands
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
    if (right) right.textContent = window.PrimeOnboarding ? PrimeOnboarding.email() : Data.state.user.email;

    var S = Data.state;

    var h = '<div class="bare-sheet ob-hub">' +
      '<div class="tile-label hub-eyebrow">Your journey</div>' +
      spine() +
      (S.stale
        ? '<div class="note note-warning hub-note">Status feed interrupted. Showing the last status we received, at ' +
          UI.esc(UI.fmtTime(new Date(Date.now() - 9 * 60000).toISOString())) +
          '. It re-syncs automatically.</div>'
        : "") +
      stateCard() +
      '<p class="freshline mt-24">' + (S.stale
        ? "Last status received " + UI.esc(UI.fmtTs(new Date(Date.now() - 9 * 60000).toISOString()))
        : "Live · updates the moment the reviewer acts.") + "</p>" +
      "</div>";

    h += '<div class="ob-demo wide"><div class="ob-demo-row">' +
      PUSHES.map(function (p) {
        return '<button class="db-btn' + (S.journey.review === p.s ? " on" : "") + '" data-push="' + p.s + '" type="button">' +
          UI.esc(p.label) + "</button>";
      }).join("") + "</div>" +
      '<span class="freshline">Demo · stands in for the human review in Optimus.</span>' +
      "</div>";

    el.insertAdjacentHTML("beforeend", h);

    // — the completion moment. An application clearing compliance is the
    //   single biggest thing that happens to a client in this product, so
    //   the line that says so gets the settle: one accent hairline, 740ms,
    //   self-removing. It fires on the transition only. Landing on a hub
    //   that was already approved is not an event, and marking it would be
    //   a lie about when it happened. —
    var now = sig(), was = lastSig;
    lastSig = now;
    if (was && was !== now && now.indexOf("approved") === 0) {
      UI.settleFlash(el.querySelector(".hub-settle"));
    }

    var resume = el.querySelector("#hubResume");
    if (resume) resume.addEventListener("click", function () {
      if (Data.state.journey.review === "not_started") Data.setJourney({ review: "in_progress" });
      App.go("kyc");
    });
    var fix = el.querySelector("#hubFix");
    if (fix) fix.addEventListener("click", function () { App.go("kyc"); });
    var goApp = el.querySelector("#hubGo");
    if (goApp) goApp.addEventListener("click", function () { App.go("dashboard"); });
    var msg = el.querySelector("#hubMsg");
    if (msg) msg.addEventListener("click", function () {
      UI.toast("Message thread opened.");
    });

    el.querySelectorAll("[data-push]").forEach(function (b) {
      b.addEventListener("click", function () { Data.reviewerAction(b.getAttribute("data-push")); });
    });
  }

  App.registerScreen("hub", {
    title: "Status hub",
    zone: "onboard",
    render: render
  });
})();
