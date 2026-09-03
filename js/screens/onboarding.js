/* ————————————————————————————————————————————————
   Fasset Prime — Public zone (J1, J2, J6). Built in wave 2.
   Ported from prime-v2.standalone.html.

   The grammar: ONE decision per screen. Each step is a centered
   single-column moment — the question as the 30px title, the minimal
   controls, one ink CTA, and a quiet "Account · Verify · Secure ·
   Qualify" text progress. No multi-field walls, no sentence under the
   title unless it is a fact the user needs right now (where a link
   was sent, that a choice is permanent).

   Steps: landing → email → password → verify (resend cooldown) →
   MFA enrollment (QR stand-in, confirm code) → recovery codes shown
   once behind an acknowledgment → qualification (entity, volume,
   jurisdiction) → hub or KYC. Separately: login → MFA challenge with
   the recovery-code path → dashboard.

   States per element: loading (n/a — no data fetch in the public
   zone; the step itself is the first paint) · empty (each step opens
   with nothing filled; no field is ever prefilled except the
   returning-user login, which is deliberate repeat-last) ·
   error/failed (duplicate email, rate limit, wrong authenticator
   code, wrong recovery code, password rules unmet) · stale/degraded
   (verify hold with a live resend cooldown; unverified accounts open
   nothing) · permission-denied (the whole zone is pre-auth; the
   duplicate-email path is the "you can't create this" case, and it
   routes to log in).

   Zone is "auth": no app shell. Sections are direct children of
   .screen so the 40ms stagger applies.
   Data API: Data.setJourney · Data.state.user · UI.recoveryCodes.

   2026-09-04 (Hamis taste pass): the landing is a front door, not a
   pitch. The lockup is in the zone header; the sheet is one headline,
   one ink action, Log in as the quiet secondary. The reference-rate
   specimen, the three feature points, the welcome line and the legal
   footnote are gone. Every step lost its subtitle unless the subtitle
   was a fact; choice rows lost their icons and their explanations.
   Errors, the rate-limit note and the demo prefills still patch in
   place; only moving between steps repaints the page.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var SETUP_KEY = "FSST-4Q7R-K2MD-9XLP";

  var VOLS = [
    "Under AED 100,000",
    "AED 100,000 to 1,000,000",
    "AED 1,000,000 to 10,000,000",
    "Over AED 10,000,000"
  ];
  var JURS = ["United Arab Emirates", "Saudi Arabia", "Qatar", "United Kingdom", "Singapore", "Somewhere else"];

  // screen-local transient state — re-applied on every render, so a
  // data change never eats a half-typed answer
  var L = {
    step: "landing",
    name: "", email: "", pass: "",
    entity: "institution", vol: "", jur: "",
    emailErr: "", emailDup: false, rateErr: false, codeErr: false, recOpen: false, ack: false,
    armRate: false, armPark: false,
    resendUntil: 0, resent: false
  };

  var cooldownIv = null;

  // published for hub.js and kyc.js (same owner): the email this
  // session signed up with, so the onboarding zone header says who
  // you are without mutating the seeded account in Data.
  window.PrimeOnboarding = {
    email: function () { return L.email || Data.state.user.email; }
  };

  function go(step) {
    L.step = step;
    L.codeErr = false;
    App.rerender();
  }

  // ————— pieces of the grammar —————

  var SPINE = ["Account", "Verify", "Secure", "Qualify"];
  function stepsLine(active) {
    if (active == null) return "";
    return '<div class="steps">' + SPINE.map(function (s, i) {
      return '<span class="step' + (i === active ? " active" : "") + '">' + s + "</span>";
    }).join('<span class="sep">·</span>') + "</div>";
  }

  // title is plain text; sub is html because the one fact it ever
  // carries (where the link went) wraps an escaped email in <strong>
  function head(title, subHtml) {
    return '<h1 class="ob-title">' + UI.esc(title) + "</h1>" +
      (subHtml ? '<p class="ob-sub">' + subHtml + "</p>" : "");
  }

  function cta(label, id, opts) {
    opts = opts || {};
    return '<div class="ob-cta-row">' +
      '<button class="btn btn-primary btn-lg" id="' + id + '" type="button"' + (opts.disabled ? " disabled" : "") + ">" +
      UI.esc(label) + "</button>" +
      (opts.back ? '<button class="link" data-back="' + opts.back + '" type="button">' + UI.esc(opts.backLabel || "Back") + "</button>" : "") +
      "</div>";
  }

  function sheet(inner, cls) {
    return '<div class="bare-sheet ob-sheet ' + (cls || "") + '">' + inner + "</div>";
  }

  // prototype furniture: everything demo lives inside .ob-demo, which the
  // Demo chip shows and hides (app.css). The product never shows these.
  function demo(buttons, caption, wide) {
    return '<div class="ob-demo' + (wide ? " wide" : "") + '">' +
      (buttons ? '<div class="ob-demo-row">' + buttons + "</div>" : "") +
      '<span class="freshline">' + caption + "</span></div>";
  }

  function dbtn(id, label, armed) {
    return '<button class="db-btn' + (armed ? " armed" : "") + '" id="' + id + '" type="button">' + UI.esc(label) + "</button>";
  }

  // one-decision rows: the label is the whole choice. No icon, no
  // explanation under it; if a choice needed one, the label was wrong.
  function choices(items) {
    return '<div class="ob-choices">' + items.map(function (it) {
      return '<button class="ob-choice' + (it.sel ? " sel" : "") + '" data-choice="' + UI.esc(it.v) + '" type="button">' +
        '<span class="oc-name">' + UI.esc(it.label) + "</span>" +
        icon("chevronRight", 14, "chev") + "</button>";
    }).join("") + "</div>";
  }

  function onChoice(el, fn) {
    el.querySelectorAll("[data-choice]").forEach(function (b) {
      b.addEventListener("click", function () { fn(b.getAttribute("data-choice")); });
    });
  }

  // QR stand-in: a real-looking module grid, always dark-on-white in
  // both themes (a scannable code is never theme-tinted).
  function qrSvg() {
    var n = 25, seed = 20260901, m = "";
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) / 32768; }
    function finder(x, y) { return (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9); }
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if (finder(x, y)) continue;
      if (rnd() > 0.52) m += '<rect x="' + x * 4 + '" y="' + y * 4 + '" width="4" height="4"/>';
    }
    function eye(cx, cy) {
      return '<path d="M' + cx + " " + cy + "h28v28h-28z" + "M" + (cx + 4) + " " + (cy + 4) + "v20h20v-20z" + '" fill-rule="evenodd"/>' +
        '<rect x="' + (cx + 8) + '" y="' + (cy + 8) + '" width="12" height="12"/>';
    }
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="oklch(0.2019 0.0108 145)">' +
      m + eye(0, 0) + eye(72, 0) + eye(0, 72) + "</g></svg>";
  }

  // ————— steps —————

  // the front door. One statement, one action, log in as the quiet
  // secondary. The lockup is already in the zone header above.
  function landing(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      '<h1 class="ob-title">Trade USDT at a firm price, from your own accounts.</h1>' +
      '<div class="ob-cta-row">' +
        '<button class="btn btn-primary btn-lg" id="obStart" type="button">Open an account</button>' +
        '<button class="btn btn-ghost" data-back="login" type="button">Log in</button>' +
      "</div>",
      "ob-landing"));
    el.querySelector("#obStart").addEventListener("click", function () { go("email"); });
  }

  // the duplicate-email case is the one refusal with a way out, so it
  // carries the route to log in inside the error line itself
  function emailErrHtml() {
    return UI.esc(L.emailErr) +
      (L.emailDup ? ' <button class="link link-underline" data-back="login" type="button">Log in instead</button>' : "");
  }

  function stepEmail(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(0) +
      head("Open an account.") +
      '<div class="ob-body">' +
      '<div class="field"><label for="obName">Full name</label>' +
      '<input id="obName" class="input" autocomplete="off" value="' + UI.esc(L.name) + '"></div>' +
      '<div class="field"><label for="obEmail">Work email</label>' +
      '<input id="obEmail" class="input' + (L.emailErr ? " invalid" : "") + '" autocomplete="off" value="' + UI.esc(L.email) + '">' +
      '<div class="hint err' + (L.emailErr ? "" : " hide") + '" id="obEmailErr">' + emailErrHtml() +
      "</div></div>" +
      "</div>" +
      cta("Continue", "obNext", { back: "landing" })));

    el.insertAdjacentHTML("beforeend", demo(
      dbtn("obFill", "Fill sample details") + dbtn("obDup", "Prefill an existing email"),
      "Demo · signup."));

    var nameI = el.querySelector("#obName"), emailI = el.querySelector("#obEmail");
    var err = el.querySelector("#obEmailErr");
    nameI.focus();
    function sync() {
      L.name = nameI.value; L.email = emailI.value;
      L.emailErr = ""; L.emailDup = false;
      err.classList.add("hide"); emailI.classList.remove("invalid");
    }
    nameI.addEventListener("input", sync);
    emailI.addEventListener("input", sync);

    // a validation message is not a new screen: it paints into the field it
    // belongs to, and the rest of the step holds still
    function showErr() {
      err.innerHTML = emailErrHtml();
      err.classList.remove("hide");
      emailI.classList.add("invalid");
      err.querySelectorAll("[data-back]").forEach(function (b) {
        b.addEventListener("click", function () { go(b.getAttribute("data-back")); });
      });
    }

    function next() {
      L.name = nameI.value.trim(); L.email = emailI.value.trim();
      if (!L.name) { nameI.classList.add("invalid"); nameI.focus(); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(L.email)) {
        L.emailErr = "That doesn’t look like an email address.";
        L.emailDup = false;
        showErr(); return;
      }
      if (L.email.toLowerCase() === Data.state.user.email) {
        L.emailErr = "An account already exists with this email.";
        L.emailDup = true;
        showErr(); return;
      }
      go("password");
    }
    el.querySelector("#obNext").addEventListener("click", next);
    emailI.addEventListener("keydown", function (e) { if (e.key === "Enter") next(); });

    function prefill(name, mail) {
      L.name = name; L.email = mail; L.emailErr = ""; L.emailDup = false;
      nameI.value = name; emailI.value = mail;
      err.classList.add("hide");
      emailI.classList.remove("invalid");
      nameI.classList.remove("invalid");
    }
    el.querySelector("#obFill").addEventListener("click", function () {
      prefill("Reem Al Suwaidi", "reem@delosnew.ae");
    });
    el.querySelector("#obDup").addEventListener("click", function () {
      prefill(L.name || "Reem Al Suwaidi", Data.state.user.email);
      UI.toast("Prefilled the seeded account’s email. Continue to see the duplicate state.", "note");
    });
  }

  var RULES = [
    { k: "len", label: "At least 12 characters", test: function (p) { return p.length >= 12; } },
    { k: "mix", label: "Upper and lower case letters", test: function (p) { return /[a-z]/.test(p) && /[A-Z]/.test(p); } },
    { k: "num", label: "At least one number", test: function (p) { return /\d/.test(p); } },
    { k: "sym", label: "At least one symbol", test: function (p) { return /[^A-Za-z0-9]/.test(p); } }
  ];
  function passOk(p) { return RULES.every(function (r) { return r.test(p); }); }

  function stepPassword(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(0) +
      head("Choose a password.") +
      '<div class="ob-body">' +
      '<div class="field"><label for="obPass">Password</label>' +
      '<input id="obPass" class="input" type="password" autocomplete="off" value="' + UI.esc(L.pass) + '">' +
      '<ul class="ob-rules" id="obRules">' + RULES.map(function (r) {
        return '<li data-rule="' + r.k + '"' + (r.test(L.pass) ? ' class="ok"' : "") + ">" + r.label + "</li>";
      }).join("") + "</ul></div>" +
      '<div class="hint err' + (L.rateErr ? "" : " hide") + '" id="obRate">Too many sign-ups from this network. Try again in 15 minutes.</div>' +
      "</div>" +
      cta("Create account", "obCreate", { back: "email", disabled: !passOk(L.pass) }) +
      '<p class="ob-legal">By creating an account you agree to the Fasset Prime terms.</p>'));

    el.insertAdjacentHTML("beforeend", demo(
      dbtn("obFillPass", "Fill a valid password") + dbtn("obArmRate", "Arm: rate limit on next submit", L.armRate),
      "Demo · failure states."));

    var pass = el.querySelector("#obPass"), btn = el.querySelector("#obCreate");
    var armBtn = el.querySelector("#obArmRate");
    pass.focus();

    // the four rule dots lighting up as you type run on the live element,
    // never through a re-render
    function syncRules() {
      L.pass = pass.value;
      el.querySelectorAll("#obRules li").forEach(function (liEl) {
        var r = RULES.filter(function (x) { return x.k === liEl.getAttribute("data-rule"); })[0];
        liEl.classList.toggle("ok", r.test(L.pass));
      });
      btn.disabled = !passOk(L.pass);
    }
    pass.addEventListener("input", syncRules);

    function create() {
      if (!passOk(L.pass)) return;
      if (L.armRate) {
        L.armRate = false; L.rateErr = true;
        armBtn.classList.remove("armed");
        el.querySelector("#obRate").classList.remove("hide");
        return;
      }
      L.rateErr = false;
      L.resendUntil = 0; L.resent = false;
      go("verify");
    }
    btn.addEventListener("click", create);
    pass.addEventListener("keydown", function (e) { if (e.key === "Enter") create(); });

    el.querySelector("#obFillPass").addEventListener("click", function () {
      pass.value = "Correct-Horse-77!";
      syncRules();
    });
    armBtn.addEventListener("click", function () {
      L.armRate = !L.armRate;
      armBtn.classList.toggle("armed", L.armRate);
      if (L.armRate) UI.toast("Armed. The next submit hits the rate limit.", "note");
    });
  }

  function stepVerify(el) {
    var mail = L.email || Data.state.user.email;
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(1) +
      head("Check your inbox.",
        "We sent a verification link to <strong>" + UI.esc(mail) + "</strong>.") +
      '<div class="ob-cta-row"><button class="btn btn-secondary" id="obResend" type="button">Resend email</button>' +
      '<span class="freshline" id="obCool"></span></div>'));

    el.insertAdjacentHTML("beforeend", demo(
      dbtn("obOpenLink", "Open the verification link"),
      "Demo · stands in for the emailed link."));

    var resend = el.querySelector("#obResend"), cool = el.querySelector("#obCool");

    function tick() {
      if (!document.body.contains(cool)) { clearInterval(cooldownIv); cooldownIv = null; return; }
      var left = Math.ceil((L.resendUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(cooldownIv); cooldownIv = null;
        cool.textContent = ""; resend.disabled = false;
      } else {
        cool.textContent = "Resend in " + left + " s";
        resend.disabled = true;
      }
    }
    if (L.resendUntil > Date.now()) { tick(); cooldownIv = setInterval(tick, 250); }

    resend.addEventListener("click", function () {
      if (Date.now() < L.resendUntil) return;
      L.resent = true;
      UI.toast("Verification email sent again.");
      L.resendUntil = Date.now() + 30000;
      tick();
      clearInterval(cooldownIv);
      cooldownIv = setInterval(tick, 250);
    });

    el.querySelector("#obOpenLink").addEventListener("click", function () {
      UI.toast("Email verified.", "done");
      go("mfa");
    });
  }

  function stepMfaEnroll(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(2) +
      head("Secure your account.", "Scan this with your authenticator app.") +
      '<div class="ob-body">' +
      '<div class="ob-qr">' + qrSvg() + "</div>" +
      UI.copyRow("Setup key", SETUP_KEY, { mono: true }) +
      '<div class="field mt-16"><label for="obCode">Code from the app</label>' +
      '<input id="obCode" class="input input-code" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="off">' +
      '<div class="hint err' + (L.codeErr ? "" : " hide") + '" id="obCodeErr">That code isn’t right. Check the app and try again.</div></div>' +
      "</div>" +
      cta("Confirm", "obConfirm", { back: "verify" })));

    el.insertAdjacentHTML("beforeend", demo("", "Demo · authenticator code 123456."));

    var code = el.querySelector("#obCode");
    code.focus();
    code.addEventListener("input", function () { el.querySelector("#obCodeErr").classList.add("hide"); });
    function confirm() {
      if (code.value !== "123456") {
        L.codeErr = true;
        el.querySelector("#obCodeErr").classList.remove("hide");
        return;
      }
      L.codeErr = false; L.ack = false;
      UI.toast("Authenticator confirmed.", "done");
      go("codes");
    }
    el.querySelector("#obConfirm").addEventListener("click", confirm);
    code.addEventListener("keydown", function (e) { if (e.key === "Enter") confirm(); });
  }

  function stepCodes(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(2) +
      head("Save your recovery codes.", "Shown once.") +
      '<div class="ob-body">' +
      '<div class="ob-codes">' + UI.recoveryCodes.map(function (c) { return "<code>" + UI.esc(c) + "</code>"; }).join("") + "</div>" +
      '<label class="ob-ack"><input type="checkbox" id="obAck"' + (L.ack ? " checked" : "") +
      "><span>I’ve saved these.</span></label>" +
      "</div>" +
      cta("Continue", "obCodesDone", { disabled: !L.ack })));

    var ack = el.querySelector("#obAck"), btn = el.querySelector("#obCodesDone");
    ack.addEventListener("change", function () { L.ack = ack.checked; btn.disabled = !L.ack; });
    btn.addEventListener("click", function () { go("qual-entity"); });
  }

  function stepQualEntity(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(3) +
      head("Are you an institution or an individual?") +
      '<div class="ob-body">' +
      choices([
        { v: "institution", label: "An institution", sel: L.entity === "institution" && !!L.vol },
        { v: "individual", label: "An individual", sel: L.entity === "individual" && !!L.vol }
      ]) +
      // the one consequence worth a sentence: this choice is permanent
      '<p class="hint">You can’t change this later without contacting us.</p>' +
      "</div>" +
      '<div class="ob-cta-row"><button class="link" data-back="landing" type="button">Back</button></div>'));

    onChoice(el, function (v) { L.entity = v; go("qual-volume"); });
  }

  function stepQualVolume(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(3) +
      head("What monthly volume do you expect?") +
      '<div class="ob-body">' + choices(VOLS.map(function (v) {
        return { v: v, label: v, sel: L.vol === v };
      })) + "</div>" +
      '<div class="ob-cta-row"><button class="link" data-back="qual-entity" type="button">Back</button></div>'));

    onChoice(el, function (v) { L.vol = v; go("qual-jurisdiction"); });
  }

  function stepQualJurisdiction(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(3) +
      head("Where will your funds be sent from?") +
      '<div class="ob-body">' + choices(JURS.map(function (v) {
        return { v: v, label: v, sel: L.jur === v };
      })) + "</div>" +
      '<div class="ob-cta-row"><button class="link" data-back="qual-volume" type="button">Back</button></div>'));

    el.insertAdjacentHTML("beforeend", demo(
      '<label class="ob-ack ob-ack-inline"><input type="checkbox" id="obPark"' + (L.armPark ? " checked" : "") +
      "><span>Triage parks this application before onboarding opens</span></label>",
      "Demo · a compliance decision in Optimus."));

    el.querySelector("#obPark").addEventListener("change", function (e) { L.armPark = e.target.checked; });

    onChoice(el, function (v) {
      L.jur = v;
      if (L.armPark) {
        Data.setJourney({ entity: L.entity, review: "parked", comments: [] });
        App.go("hub");
        return;
      }
      Data.setJourney({ entity: L.entity, review: "in_progress", comments: [], submittedIso: null });
      App.go("kyc");
    });
  }

  function stepLogin(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      head("Log in.") +
      '<div class="ob-body">' +
      '<div class="field"><label for="liEmail">Email</label>' +
      '<input id="liEmail" class="input" autocomplete="off" value="' + UI.esc(Data.state.user.email) + '"></div>' +
      '<div class="field"><label for="liPass">Password</label>' +
      '<input id="liPass" class="input" type="password" autocomplete="off" value="fifteencharacters"></div>' +
      "</div>" +
      cta("Continue", "liGo", { back: "landing", backLabel: "Open an account" })));

    el.querySelector("#liGo").addEventListener("click", function () { go("challenge"); });
    el.querySelector("#liPass").addEventListener("keydown", function (e) { if (e.key === "Enter") go("challenge"); });
  }

  function stepChallenge(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      head("Enter the code from your authenticator.") +
      '<div class="ob-body">' +
      '<div class="field"><input id="mcCode" class="input input-code" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="off">' +
      '<div class="hint err' + (L.codeErr ? "" : " hide") + '" id="mcErr">That code isn’t right. Check the app and try again.</div></div>' +
      '<div class="field' + (L.recOpen ? "" : " hide") + '" id="mcRecWrap"><label for="mcRec">Recovery code</label>' +
      '<input id="mcRec" class="input mono" placeholder="XXXX-XXXX" autocomplete="off"></div>' +
      "</div>" +
      cta("Verify", "mcGo", { back: "login" }) +
      '<div class="mt-12"><button class="link" id="mcRecLink" type="button">Use a recovery code instead</button></div>'));

    el.insertAdjacentHTML("beforeend", demo("",
      "Demo · code 123456, or a seeded recovery code like 9F3K-22LQ."));

    var code = el.querySelector("#mcCode"), rec = el.querySelector("#mcRec");
    code.focus();
    code.addEventListener("input", function () { el.querySelector("#mcErr").classList.add("hide"); });
    el.querySelector("#mcRecLink").addEventListener("click", function () {
      L.recOpen = true;
      el.querySelector("#mcRecWrap").classList.remove("hide");
      rec.focus();
    });
    function verify() {
      var ok = code.value === "123456" || UI.recoveryCodes.indexOf((rec.value || "").trim().toUpperCase()) >= 0;
      if (!ok) {
        L.codeErr = true;
        el.querySelector("#mcErr").classList.remove("hide");
        return;
      }
      L.codeErr = false;
      App.go("dashboard");
    }
    el.querySelector("#mcGo").addEventListener("click", verify);
    code.addEventListener("keydown", function (e) { if (e.key === "Enter") verify(); });
    rec.addEventListener("keydown", function (e) { if (e.key === "Enter") verify(); });
  }

  var STEPS = {
    landing: landing,
    email: stepEmail,
    password: stepPassword,
    verify: stepVerify,
    mfa: stepMfaEnroll,
    codes: stepCodes,
    "qual-entity": stepQualEntity,
    "qual-volume": stepQualVolume,
    "qual-jurisdiction": stepQualJurisdiction,
    login: stepLogin,
    challenge: stepChallenge
  };

  function render(el) {
    if (cooldownIv) { clearInterval(cooldownIv); cooldownIv = null; }

    // the zone header's right slot belongs to the screen. It is also the
    // entry sentinel: a fresh element means we arrived from another zone
    // (the demo bar's Landing jump), so the flow restarts at the top.
    // It shows one fact, who you are, once that is known. Navigation
    // (Log in, Open an account) lives in the sheet, not up here.
    var right = document.getElementById("bareRight");
    if (right && !right.getAttribute("data-ob-live")) {
      right.setAttribute("data-ob-live", "1");
      L.step = "landing";
    }
    if (right) {
      var signupStep = ["email", "password", "verify", "mfa", "codes", "qual-entity", "qual-volume", "qual-jurisdiction"].indexOf(L.step) >= 0;
      right.textContent = signupStep && L.email ? L.email : "";
    }

    (STEPS[L.step] || landing)(el);

    el.querySelectorAll("[data-back]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-back")); });
    });
  }

  App.registerScreen("onboarding", {
    title: "Welcome",
    zone: "auth",
    render: render,
    // nothing in the public zone reads live data, and every step holds
    // transient input — so a data event never re-renders it out from
    // under a half-typed answer
    onData: function () { return true; }
  });
})();
