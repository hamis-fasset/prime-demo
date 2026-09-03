/* ————————————————————————————————————————————————
   Fasset Prime — Public zone (J1, J2, J6). Built in wave 2.
   Ported from prime-v2.standalone.html.

   The grammar: ONE decision per screen. Each step is a centered
   single-column moment — the question as the 30px title, one
   reassuring gray subtitle, the minimal controls, one ink CTA, and a
   quiet "Account · Verify · Secure · Qualify" text progress. No
   multi-field walls.

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

   Wave-3: the landing sheet carries one typeset figure (the reference
   rate, per-digit assembled, labelled illustrative) because a page
   selling firm pricing that shows no price is the flattest screen in
   the app. And a step no longer replays its own entrance to show a
   validation error or a prefill: errors, the rate-limit note and the
   demo prefills patch in place. Only moving between steps repaints the
   page, because there the whole screen genuinely changed.
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

  // ————— local icons (16px grid, 1.5px stroke, round caps) —————
  var LP = {
    person: '<circle cx="8" cy="5" r="2.75"/><path d="M2.75 14.25a5.25 5.25 0 0 1 10.5 0"/>',
    mail: '<rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5"/><path d="m2.5 4.5 5.5 4.25L13.5 4.5"/>'
  };
  function li(name, size, cls) {
    return '<svg class="icon ' + (cls || "") + '" width="' + (size || 16) + '" height="' + (size || 16) +
      '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
      LP[name] + "</svg>";
  }

  // ————— pieces of the grammar —————

  var SPINE = ["Account", "Verify", "Secure", "Qualify"];
  function stepsLine(active) {
    if (active == null) return "";
    return '<div class="steps">' + SPINE.map(function (s, i) {
      return '<span class="step' + (i === active ? " active" : "") + '">' + s + "</span>";
    }).join('<span class="sep">·</span>') + "</div>";
  }

  function head(title, sub) {
    return '<h1 class="ob-title">' + title + "</h1>" +
      (sub ? '<p class="ob-sub">' + sub + "</p>" : "");
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
    return '<div class="bare-sheet ' + (cls || "") + '">' + inner + "</div>";
  }

  function demo(buttons, caption, wide) {
    return '<div class="ob-demo' + (wide ? " wide" : "") + '">' +
      (buttons ? '<div class="ob-demo-row">' + buttons + "</div>" : "") +
      '<span class="freshline">' + caption + "</span></div>";
  }

  function dbtn(id, label, armed) {
    return '<button class="db-btn' + (armed ? " armed" : "") + '" id="' + id + '" type="button">' + UI.esc(label) + "</button>";
  }

  function choices(items) {
    return '<div class="ob-choices">' + items.map(function (it) {
      return '<button class="ob-choice' + (it.sel ? " sel" : "") + '" data-choice="' + UI.esc(it.v) + '" type="button">' +
        (it.icon || "") +
        '<span class="oc-body"><span class="oc-name">' + UI.esc(it.label) + "</span>" +
        (it.sub ? '<span class="oc-sub">' + UI.esc(it.sub) + "</span>" : "") + "</span>" +
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

  // the one figure in the public zone. It is the reference rate, not a
  // quote: labelled illustrative, priced from Data.REF, and the lock
  // length comes from Data.LOCK_SECS so it can never drift from the
  // product. Two currency swatches, no fill, no chart: the point is that a
  // price exists and holds still.
  function specimen() {
    var rate = Data.REF["USDT/AED"];
    return '<div class="ob-figure">' +
      '<span class="ob-figure-label">A firm price, right now</span>' +
      '<span class="ob-figure-val">' + UI.digits(rate.toFixed(4), { stagger: 18 }) + "</span>" +
      '<span class="ob-figure-sub">' + UI.ccy("AED") + " per " + UI.ccy("USDT") +
      " · illustrative reference rate. Yours holds for " +
      Data.LOCK_SECS + " seconds while you decide.</span>" +
      "</div>";
  }

  function landing(el) {
    var points = [
      { i: icon("clock", 16), t: "Firm quotes, not indications", s: "A real rate for your exact size, locked while you decide." },
      { i: icon("activity", 16), t: "Money you can follow", s: "See exactly where every deposit and withdrawal is, at every step." },
      { i: icon("shieldCheck", 16), t: "Onboarding you can track", s: "Your application's status is always visible, reviewed by a human." }
    ];
    el.insertAdjacentHTML("beforeend", sheet(
      head("Institutional OTC, without the back-and-forth.",
        "Onboard without a salesperson, trade on a price that holds, and always know where your money is.") +
      specimen() +
      '<div class="ob-points">' + points.map(function (p) {
        return '<div class="ob-point">' + p.i + '<span><span class="pt-title">' + p.t + '</span><span class="pt-sub">' + p.s + "</span></span></div>";
      }).join("") + "</div>" +
      cta("Create your account", "obStart", { back: "login", backLabel: "I already have an account" }) +
      '<p class="ob-legal">Email and password only. No invitation code.</p>',
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
      head("What’s your work email?", "Your account takes about two minutes.") +
      '<div class="ob-body">' +
      '<div class="field"><label for="obName">Full name</label>' +
      '<input id="obName" class="input" placeholder="e.g. Reem Al Suwaidi" autocomplete="off" value="' + UI.esc(L.name) + '"></div>' +
      '<div class="field"><label for="obEmail">Work email</label>' +
      '<input id="obEmail" class="input' + (L.emailErr ? " invalid" : "") + '" placeholder="you@company.com" autocomplete="off" value="' + UI.esc(L.email) + '">' +
      '<div class="hint err' + (L.emailErr ? "" : " hide") + '" id="obEmailErr">' + emailErrHtml() +
      "</div></div>" +
      "</div>" +
      cta("Continue", "obNext", { back: "landing" })));

    el.insertAdjacentHTML("beforeend", demo(
      dbtn("obFill", "Fill sample details") + dbtn("obDup", "Prefill an existing email (duplicate)"),
      "Signup is open, rate limiting keeps it safe."));

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
        L.emailErr = "That doesn’t look like an email address we can send to.";
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
      UI.toast("Prefilled the seeded account’s email. Continue to see the duplicate state.");
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
      head("Choose a password.", "") +
      '<div class="ob-body">' +
      '<div class="field"><label for="obPass">Password</label>' +
      '<input id="obPass" class="input" type="password" autocomplete="off" value="' + UI.esc(L.pass) + '">' +
      '<ul class="ob-rules" id="obRules">' + RULES.map(function (r) {
        return '<li data-rule="' + r.k + '"' + (r.test(L.pass) ? ' class="ok"' : "") + ">" + r.label + "</li>";
      }).join("") + "</ul></div>" +
      '<div class="note note-error' + (L.rateErr ? "" : " hide") + '" id="obRate">Too many sign-ups from this network. Try again in about 15 minutes, or write to onboarding@fasset.com.</div>' +
      "</div>" +
      cta("Create account", "obCreate", { back: "email", disabled: !passOk(L.pass) }) +
      '<p class="ob-legal">By signing up you agree to the Fasset Prime terms.</p>'));

    el.insertAdjacentHTML("beforeend", demo(
      dbtn("obFillPass", "Fill a valid password") + dbtn("obArmRate", "Arm rate-limit on next submit", L.armRate),
      "Arm it to see the rate-limit failure state."));

    var pass = el.querySelector("#obPass"), btn = el.querySelector("#obCreate");
    var armBtn = el.querySelector("#obArmRate");
    pass.focus();

    // the four rule dots lighting up as you type is the best micro-interaction
    // in the app. It runs on the live element, never through a re-render.
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
      if (L.armRate) UI.toast("Armed. The next submit hits the rate limit.");
    });
  }

  function stepVerify(el) {
    var mail = L.email || Data.state.user.email;
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(1) +
      head("Check your inbox.",
        "We sent a verification link to <strong>" + UI.esc(mail) + "</strong>.") +
      '<div class="ob-body">' +
      '<div class="note note-positive' + (L.resent ? "" : " hide") + '" id="obResent">Verification email re-sent.</div>' +
      '<div class="ob-cta-row"><button class="btn btn-secondary" id="obResend" type="button">Resend email</button>' +
      '<span class="freshline" id="obCool"></span></div>' +
      "</div>"));

    el.insertAdjacentHTML("beforeend", demo(
      dbtn("obOpenLink", "Open the verification link"),
      "Stands in for clicking the emailed link."));

    var resend = el.querySelector("#obResend"), cool = el.querySelector("#obCool");

    function tick() {
      if (!document.body.contains(cool)) { clearInterval(cooldownIv); cooldownIv = null; return; }
      var left = Math.ceil((L.resendUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(cooldownIv); cooldownIv = null;
        cool.textContent = ""; resend.disabled = false;
      } else {
        cool.textContent = "Resend again in " + left + " s";
        resend.disabled = true;
      }
    }
    if (L.resendUntil > Date.now()) { tick(); cooldownIv = setInterval(tick, 250); }

    resend.addEventListener("click", function () {
      if (Date.now() < L.resendUntil) return;
      L.resent = true;
      el.querySelector("#obResent").classList.remove("hide");
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
      '<div class="field mt-16"><label for="obCode">Confirm with a code from the app</label>' +
      '<input id="obCode" class="input input-code" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="off">' +
      '<div class="hint err' + (L.codeErr ? "" : " hide") + '" id="obCodeErr">That code isn’t right. Check the app and try again.</div></div>' +
      "</div>" +
      cta("Confirm code", "obConfirm", { back: "verify" })));

    el.insertAdjacentHTML("beforeend", demo("", "Demo authenticator code 123456."));

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
      go("codes");
    }
    el.querySelector("#obConfirm").addEventListener("click", confirm);
    code.addEventListener("keydown", function (e) { if (e.key === "Enter") confirm(); });
  }

  function stepCodes(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(2) +
      head("Save your recovery codes.", "Shown once. Each one works a single time if you lose your authenticator.") +
      '<div class="ob-body">' +
      '<div class="note note-positive">Authenticator confirmed.</div>' +
      '<div class="ob-codes">' + UI.recoveryCodes.map(function (c) { return "<code>" + UI.esc(c) + "</code>"; }).join("") + "</div>" +
      '<label class="ob-ack"><input type="checkbox" id="obAck"' + (L.ack ? " checked" : "") +
      "><span>I’ve stored these somewhere safe. Fasset can’t show them again.</span></label>" +
      "</div>" +
      cta("Continue", "obCodesDone", { disabled: !L.ack })));

    var ack = el.querySelector("#obAck"), btn = el.querySelector("#obCodesDone");
    ack.addEventListener("change", function () { L.ack = ack.checked; btn.disabled = !L.ack; });
    btn.addEventListener("click", function () { go("qual-entity"); });
  }

  function stepQualEntity(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(3) +
      head("Are you onboarding as an institution or an individual?",
        "Three quick questions. Not a credit check.") +
      '<div class="ob-body">' +
      choices([
        { v: "institution", label: "An institution", sub: "A company, fund or trust.", icon: icon("building", 16), sel: L.entity === "institution" && !!L.vol },
        { v: "individual", label: "An individual", sub: "Yourself, in your own name.", icon: li("person", 16), sel: L.entity === "individual" && !!L.vol }
      ]) +
      '<p class="hint">You can’t change this later without contacting us.</p>' +
      "</div>" +
      '<div class="ob-cta-row"><button class="link" data-back="landing" type="button">Back</button></div>'));

    onChoice(el, function (v) { L.entity = v; go("qual-volume"); });
  }

  function stepQualVolume(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(3) +
      head("What monthly volume do you expect?", "An estimate is fine, it doesn’t cap you.") +
      '<div class="ob-body">' + choices(VOLS.map(function (v) {
        return { v: v, label: v, sel: L.vol === v };
      })) + "</div>" +
      '<div class="ob-cta-row"><button class="link" data-back="qual-entity" type="button">Back</button></div>'));

    onChoice(el, function (v) { L.vol = v; go("qual-jurisdiction"); });
  }

  function stepQualJurisdiction(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      stepsLine(3) +
      head("Where do your funds come from?", "The jurisdiction the money is sent from.") +
      '<div class="ob-body">' +
      '<div class="note note-info">Last question.</div>' +
      '<div class="mt-16">' + choices(JURS.map(function (v) {
        return { v: v, label: v, sel: L.jur === v };
      })) + "</div></div>" +
      '<div class="ob-cta-row"><button class="link" data-back="qual-volume" type="button">Back</button></div>'));

    el.insertAdjacentHTML("beforeend", demo(
      '<label class="ob-ack ob-ack-inline"><input type="checkbox" id="obPark"' + (L.armPark ? " checked" : "") +
      "><span>Triage outcome: this application gets parked before onboarding opens</span></label>",
      "Stands in for a compliance-team decision in Optimus."));

    el.querySelector("#obPark").addEventListener("change", function (e) { L.armPark = e.target.checked; });

    onChoice(el, function (v) {
      L.jur = v;
      if (L.armPark) {
        Data.setJourney({ entity: L.entity, review: "parked", comments: [] });
        UI.toast("Triage parked this application before onboarding opened.");
        App.go("hub");
        return;
      }
      Data.setJourney({ entity: L.entity, review: "in_progress", comments: [], submittedIso: null });
      App.go("kyc");
    });
  }

  function stepLogin(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      head("Welcome back.", "Fasset Prime client portal.") +
      '<div class="ob-body">' +
      '<div class="field"><label for="liEmail">Email</label>' +
      '<input id="liEmail" class="input" autocomplete="off" value="' + UI.esc(Data.state.user.email) + '"></div>' +
      '<div class="field"><label for="liPass">Password</label>' +
      '<input id="liPass" class="input" type="password" autocomplete="off" value="fifteencharacters"></div>' +
      "</div>" +
      cta("Continue", "liGo", { back: "landing", backLabel: "Create an account" })));

    el.querySelector("#liGo").addEventListener("click", function () { go("challenge"); });
    el.querySelector("#liPass").addEventListener("keydown", function (e) { if (e.key === "Enter") go("challenge"); });
  }

  function stepChallenge(el) {
    el.insertAdjacentHTML("beforeend", sheet(
      head("Enter your authenticator code.", "The 6-digit code from your app.") +
      '<div class="ob-body">' +
      '<div class="field"><input id="mcCode" class="input input-code" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="off">' +
      '<div class="hint err' + (L.codeErr ? "" : " hide") + '" id="mcErr">That code isn’t right. Check the app and try again.</div></div>' +
      '<div class="field' + (L.recOpen ? "" : " hide") + '" id="mcRecWrap"><label for="mcRec">Recovery code</label>' +
      '<input id="mcRec" class="input mono" placeholder="XXXX-XXXX" autocomplete="off"></div>' +
      "</div>" +
      cta("Verify", "mcGo", { back: "login" }) +
      '<div class="mt-12"><button class="link" id="mcRecLink" type="button">Use a recovery code instead</button></div>'));

    el.insertAdjacentHTML("beforeend", demo("",
      "Demo code 123456, or a seeded recovery code like 9F3K-22LQ."));

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
    var right = document.getElementById("bareRight");
    if (right && !right.getAttribute("data-ob-live")) {
      right.setAttribute("data-ob-live", "1");
      L.step = "landing";
    }
    if (right) {
      right.innerHTML = L.step === "landing"
        ? '<button class="link" data-back="login" type="button">Log in</button>'
        : (L.email ? UI.esc(L.email) : '<button class="link" data-back="landing" type="button">Create an account</button>');
      right.querySelectorAll("[data-back]").forEach(function (b) {
        b.addEventListener("click", function () { go(b.getAttribute("data-back")); });
      });
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
