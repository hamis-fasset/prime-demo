/* ————————————————————————————————————————————————
   Fasset Prime — KYC wizard (J3). Built in wave 2, ported from
   prime-v2.standalone.html.

   Both journeys: institution (5 steps, the last one leadership) and
   individual (4 steps), each plus a review of the answers before
   submitting. The spine on the left is the whole navigation model;
   the step body is one form at a time, because a KYC step genuinely
   is a form.

   Honest by construction:
   · uploads enforce the types their labels claim, split front/back
     where the document has two sides, show real progress, and
     surface rejection with what to do next (armable in demo)
   · a save that fails says so and keeps every answer on screen
   · leadership blocks a zero-director step, a missing required
     field, an ownership share outside 1 to 100, and any total over
     100 percent
   · no field is ever prefilled in a fresh journey: a defaulted fact
     is a wrong fact
   · resubmit mode unlocks only the steps the reviewer flagged, pins
     their comments to those steps, tags what changed "Updated", and
     keeps every untouched step read-only

   States per element: loading (one skeleton pass per app load) ·
   empty (leadership with no people yet; a step with nothing filled) ·
   error/failed (upload rejected, save failed, per-field and
   whole-step validation) · stale/degraded (the last-saved line, and
   the unsaved-step warning after a failed save) · permission-denied
   (a viewer teammate, and read-only steps in resubmit mode, and the
   whole wizard once the application is with the reviewer).

   Zone is "onboard". Submitting sets review = in_review and hands
   off to the hub. Data API: Data.state.journey · Data.setJourney.

   Wave-3: every local move (a step change, a finished upload, a save,
   adding a person, jumping to the review) used to call App.rerender(),
   which rebuilds .screen and replays the whole page entrance. Now the
   spine updates in place and only the step body repaints (UI.repaint,
   200ms), so filling a form never re-animates the page around you.
   Submitting carries the settle: the one moment in onboarding where the
   client hands over everything they have.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var NATS = ["United Arab Emirates", "Saudi Arabia", "United Kingdom", "Singapore", "Somewhere else"];
  var VOLS = ["Under AED 100,000", "AED 100,000 to 1,000,000", "AED 1,000,000 to 10,000,000", "Over AED 10,000,000"];

  var KYCDEF = {
    institution: [
      { id: "pd", title: "Personal details", sub: "About you, the applicant", fields: [
        { k: "name", label: "Full name", type: "text", sample: "Reem Al Suwaidi" },
        { k: "phone", label: "Phone", type: "text", sample: "+971 50 123 4567" },
        { k: "nat", label: "Nationality", type: "select", opts: NATS, sample: "United Arab Emirates" },
        { k: "role", label: "Role at the company", type: "text", sample: "Director, Treasury" },
        { k: "id", label: "Passport or Emirates ID", type: "uploadfb", types: "JPG or PNG" }
      ]},
      { id: "cd", title: "Company details", fields: [
        { k: "legal", label: "Legal name", type: "text", sample: "Delos Financial Limited" },
        { k: "reg", label: "Registration number", type: "text", sample: "DED-1048221", mono: true },
        { k: "cty", label: "Country of incorporation", type: "select", opts: NATS, sample: "United Arab Emirates" },
        { k: "est", label: "Date of establishment", type: "text", ph: "DD/MM/YYYY", sample: "14/03/2016", hint: "Enter the date exactly as it appears on your licence." },
        { k: "addr", label: "Registered address", type: "text", sample: "Level 12, ICD Brookfield Place, DIFC, Dubai" },
        { k: "tax", label: "Tax registration number", type: "text", sample: "100-3345-90812", mono: true }
      ]},
      { id: "ed", title: "Entity documents", fields: [
        { k: "lic", label: "Trade licence", type: "upload" },
        { k: "coi", label: "Certificate of incorporation", type: "upload" },
        { k: "moa", label: "Memorandum of association", type: "upload" },
        { k: "bod", label: "Board resolution", type: "upload", template: true, hint: "Download the template, sign it, and upload the signed copy." }
      ]},
      { id: "sf", title: "Source of funds", fields: [
        { k: "src", label: "Primary source", type: "select", opts: ["Operating revenue", "Investment proceeds", "Shareholder capital", "Other"], sample: "Operating revenue" },
        { k: "vol", label: "Expected monthly volume", type: "select", opts: VOLS, sample: "AED 1,000,000 to 10,000,000" },
        { k: "desc", label: "Describe the flow of funds", type: "textarea", sample: "Treasury conversion of AED operating revenue into USDT for settlement with regional partners." },
        { k: "stmt", label: "Bank statement, last 6 months", type: "upload" }
      ]},
      { id: "ld", title: "Leadership details", custom: "leadership" }
    ],
    individual: [
      { id: "pd", title: "Personal details", fields: [
        { k: "name", label: "Full name", type: "text", sample: "Reem Al Suwaidi" },
        { k: "dob", label: "Date of birth", type: "text", ph: "DD/MM/YYYY", sample: "02/11/1988" },
        { k: "nat", label: "Nationality", type: "select", opts: NATS, sample: "United Arab Emirates" },
        { k: "phone", label: "Phone", type: "text", sample: "+971 50 123 4567" },
        { k: "addr", label: "Residential address", type: "text", sample: "Villa 22, Al Wasl Road, Dubai" }
      ]},
      { id: "em", title: "Employment", fields: [
        { k: "status", label: "Employment status", type: "select", opts: ["Employed", "Self-employed", "Business owner", "Retired", "Not currently employed"], sample: "Business owner" },
        { k: "employer", label: "Company or employer", type: "text", sample: "Delos Capital Partners" },
        { k: "industry", label: "Industry", type: "select", opts: ["Financial services", "Real estate", "Trading", "Technology", "Other"], sample: "Financial services" },
        { k: "role", label: "Role", type: "text", sample: "Managing partner" }
      ]},
      { id: "si", title: "Source of income", fields: [
        { k: "src", label: "Primary source", type: "select", opts: ["Business income", "Salary", "Investments", "Inheritance", "Other"], sample: "Business income" },
        { k: "band", label: "Annual income", type: "select", opts: ["Under AED 500,000", "AED 500,000 to 2,000,000", "Over AED 2,000,000"], sample: "Over AED 2,000,000" },
        { k: "desc", label: "Describe the source", type: "textarea", sample: "Distributions from Delos Capital Partners, of which I am managing partner." },
        { k: "stmt", label: "Bank statement, last 6 months", type: "upload" }
      ]},
      { id: "dr", title: "Documents", fields: [
        { k: "pass", label: "Passport", type: "uploadfb", types: "JPG or PNG" },
        { k: "poa", label: "Proof of address, utility bill or bank letter under 3 months old", type: "upload" }
      ]}
    ]
  };

  var W = null;              // the live wizard, screen-local
  var loadedOnce = false;

  function sampleLeaders() {
    return [
      { name: "Reem Al Suwaidi", phone: "+971 50 123 4567", nat: "United Arab Emirates", own: "60", up: true },
      { name: "Lena Farouk", phone: "+971 55 900 2211", nat: "United Arab Emirates", own: "30", up: true }
    ];
  }

  function modeFor() { return Data.state.journey.review === "needs_info" ? "resub" : "fresh"; }

  function init(entity, mode) {
    var steps = KYCDEF[entity];
    W = {
      entity: entity, mode: mode, steps: steps, step: 0,
      values: {}, up: {}, leaders: [], errs: {}, changed: {}, visited: {},
      done: steps.map(function () { return mode === "resub"; }),
      unlocked: null, saveErr: false, armUp: false, armSave: false, lastSaved: null
    };
    if (mode === "resub") {
      var cs = Data.state.journey.comments || [];
      // guard: the seeded reviewer comments are indexed for the
      // institution journey (5 steps). On the individual journey (4)
      // an out-of-range index would unlock nothing real, so drop it.
      W.unlocked = cs.map(function (c) { return c.stepIdx; })
        .filter(function (i) { return i >= 0 && i < steps.length; });
      W.step = W.unlocked.length ? W.unlocked[0] : 0;
      // everything already submitted stands
      steps.forEach(function (st) {
        (st.fields || []).forEach(function (f) {
          if (f.type === "upload") W.up[f.k] = { done: true, fileName: fileName(f, false) };
          else if (f.type === "uploadfb") {
            W.up[f.k + ".f"] = { done: true, fileName: fileName(f, true) };
            W.up[f.k + ".b"] = { done: true, fileName: fileName(f, true) };
          } else W.values[f.k] = f.sample;
        });
      });
      if (entity === "institution") {
        W.leaders = sampleLeaders();
        W.leaders.forEach(function (Ld, i) { W.up["L" + i] = { done: true, fileName: "id-document.jpg" }; });
      }
      W.lastSaved = Data.state.journey.submittedIso;
    } else {
      W.unlocked = null;
    }
  }

  function ensure() {
    var entity = Data.state.journey.entity || "institution";
    var mode = modeFor();
    if (!W || W.entity !== entity || W.mode !== mode) init(entity, mode);
    return W;
  }

  function stepLocked(i) { return W.mode === "resub" && W.unlocked.indexOf(i) < 0; }
  function readOnly(i) { return Data.state.role === "viewer" || stepLocked(i); }
  function commentsFor(i) {
    if (W.mode !== "resub") return [];
    return (Data.state.journey.comments || []).filter(function (c) { return c.stepIdx === i; });
  }
  function fileName(f, isImg) {
    var slug = f.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-");
    return slug + (isImg ? ".jpg" : ".pdf");
  }

  // ————— published progress (the hub reads this; same owner) —————
  window.PrimeKyc = {
    progress: function () {
      if (!W) return null;
      return { done: W.done.filter(Boolean).length, total: W.steps.length, mode: W.mode };
    }
  };

  // ————— uploads: honest, typed, progressive, rejectable —————

  function upState(key) {
    if (!W.up[key]) W.up[key] = { done: false, err: null, fileName: null };
    return W.up[key];
  }
  function upDone(f) {
    if (f.type === "uploadfb") return upState(f.k + ".f").done && upState(f.k + ".b").done;
    return upState(f.k).done;
  }

  function upBoxHtml(key, f, isImg, ro) {
    var st = upState(key);
    var types = f.types || "PDF, JPG or PNG";
    if (st.err) {
      return '<div class="up-box up-err"><span class="up-meta"><strong>Upload rejected.</strong> ' + UI.esc(st.err) + "</span>" +
        (ro ? "" : '<button class="btn btn-sm btn-secondary" data-upgo="' + key + '" type="button">Try again</button>') + "</div>";
    }
    if (st.done) {
      return '<div class="up-box up-done"><span class="up-meta"><strong>' + UI.esc(st.fileName || fileName(f, isImg)) + "</strong> · uploaded</span>" +
        (ro ? "" : '<button class="btn btn-sm btn-secondary" data-upgo="' + key + '" type="button">Replace</button>') + "</div>";
    }
    if (ro) return '<div class="up-box"><span class="up-meta">Not uploaded.</span></div>';
    return '<div class="up-box"><span class="up-meta">' + UI.esc(f.label) + " · <strong>" + UI.esc(types) + "</strong> · max 10 MB</span>" +
      '<span class="up-bar"><i></i></span>' +
      '<button class="btn btn-sm btn-secondary" data-upgo="' + key + '" type="button">Choose file</button></div>';
  }

  function uploadHtml(f, ro) {
    if (f.type === "uploadfb") {
      return '<div class="up-fb">' +
        '<div><div class="up-side">Front</div><div data-upwrap="' + f.k + '.f">' + upBoxHtml(f.k + ".f", f, true, ro) + "</div></div>" +
        '<div><div class="up-side">Back</div><div data-upwrap="' + f.k + '.b">' + upBoxHtml(f.k + ".b", f, true, ro) + "</div></div>" +
        "</div>";
    }
    return '<div data-upwrap="' + f.k + '">' + upBoxHtml(f.k, f, false, ro) + "</div>";
  }

  // Wire exactly one upload box. On completion the screen re-renders, so
  // listeners are never attached twice and the state is the single source.
  function wireUpBox(body, key, f, isImg) {
    var wrap = body.querySelector('[data-upwrap="' + key + '"]');
    if (!wrap) return;
    var btn = wrap.querySelector("[data-upgo]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var st = upState(key);
      st.done = false; st.err = null;
      wrap.innerHTML = upBoxHtml(key, f, isImg, false);
      var bar = wrap.querySelector(".up-bar");
      var fill = bar.querySelector("i");
      bar.classList.add("on");
      var p = 0;
      var iv = setInterval(function () {
        p += 18;
        fill.style.width = Math.min(p, 100) + "%";
        if (p < 100) return;
        clearInterval(iv);
        if (W.armUp) {
          W.armUp = false;
          st.err = "This file is .heic, which isn’t accepted here. " + (f.types || "PDF, JPG or PNG") + " only.";
        } else {
          st.done = true;
          st.fileName = fileName(f, isImg);
        }
        if (W.mode === "resub") W.changed[W.step] = true;
        paint();
      }, 90);
    });
  }

  function wireField(body, f) {
    if (f.type === "uploadfb") {
      wireUpBox(body, f.k + ".f", f, true);
      wireUpBox(body, f.k + ".b", f, true);
    } else {
      wireUpBox(body, f.k, f, false);
    }
  }

  // ————— field rendering —————

  function fieldHtml(f, ro) {
    var v = W.values[f.k] || "";
    var err = W.errs[f.k];
    var dis = ro ? " disabled" : "";
    var h = '<div class="field"><label for="wf_' + f.k + '">' + UI.esc(f.label) + "</label>";
    if (f.type === "select") {
      h += '<select id="wf_' + f.k + '" class="select"' + dis + '><option value="">Select</option>' +
        f.opts.map(function (o) { return "<option" + (v === o ? " selected" : "") + ">" + UI.esc(o) + "</option>"; }).join("") + "</select>";
    } else if (f.type === "textarea") {
      h += '<textarea id="wf_' + f.k + '" class="input" rows="3"' + dis + ">" + UI.esc(v) + "</textarea>";
    } else if (f.type === "upload" || f.type === "uploadfb") {
      h += uploadHtml(f, ro);
    } else {
      h += '<input id="wf_' + f.k + '" class="input' + (f.mono ? " mono" : "") + '" value="' + UI.esc(v) +
        '" placeholder="' + UI.esc(f.ph || "") + '" autocomplete="off"' + dis + ">";
    }
    if (f.template) h += '<div class="hint">Sign the template and upload the signed copy. ' +
      '<button class="link link-underline" id="wfTemplate" type="button">Download the template</button></div>';
    else if (f.hint) h += '<div class="hint">' + UI.esc(f.hint) + "</div>";
    if (err) h += '<div class="hint err">' + UI.esc(err) + "</div>";
    return h + "</div>";
  }

  function leadershipHtml(ro) {
    var h = '<p class="ob-sub flush">Directors and ultimate beneficial owners. Each person needs a name, phone, ID document, and ownership share. The total can’t go over 100 percent.</p>';
    if (!W.leaders.length) {
      h += '<div class="empty">No directors or beneficial owners yet. Add at least one to continue.</div>';
    }
    W.leaders.forEach(function (Ld, i) {
      var e = W.errs["L" + i] || {};
      var dis = ro ? " disabled" : "";
      h += '<div class="lead-card"><div class="lead-head"><h4>Person ' + (i + 1) + "</h4>" +
        (ro ? "" : '<button class="link link-danger" data-rml="' + i + '" type="button">Remove</button>') + "</div>" +
        '<div class="field-row"><div class="field"><label>Full name</label>' +
        '<input class="input" data-lf="name" data-li="' + i + '" value="' + UI.esc(Ld.name || "") + '" autocomplete="off"' + dis + ">" +
        (e.name ? '<div class="hint err">' + UI.esc(e.name) + "</div>" : "") + "</div>" +
        '<div class="field"><label>Phone</label>' +
        '<input class="input" data-lf="phone" data-li="' + i + '" value="' + UI.esc(Ld.phone || "") + '" autocomplete="off"' + dis + ">" +
        (e.phone ? '<div class="hint err">' + UI.esc(e.phone) + "</div>" : "") + "</div></div>" +
        '<div class="field-row"><div class="field"><label>Nationality</label>' +
        '<input class="input" data-lf="nat" data-li="' + i + '" value="' + UI.esc(Ld.nat || "") + '" autocomplete="off"' + dis + "></div>" +
        '<div class="field field-own"><label>Ownership percent</label>' +
        '<input class="input" data-lf="own" data-li="' + i + '" inputmode="numeric" value="' + UI.esc(Ld.own || "") + '" autocomplete="off"' + dis + ">" +
        (e.own ? '<div class="hint err">' + UI.esc(e.own) + "</div>" : "") + "</div></div>" +
        '<div class="field field-flush"><label>ID document</label>' +
        '<div data-upwrap="L' + i + '">' + upBoxHtml("L" + i, { k: "L" + i, label: "ID document", types: "JPG or PNG" }, true, ro) + "</div>" +
        (e.up ? '<div class="hint err">' + UI.esc(e.up) + "</div>" : "") + "</div></div>";
    });
    var tot = W.leaders.reduce(function (a, Ld) { return a + (parseFloat(Ld.own) || 0); }, 0);
    h += '<div class="lead-total' + (tot > 100 ? " over" : "") + '">' +
      (ro ? "" : '<button class="btn btn-secondary btn-sm" id="addLeader" type="button">Add person</button>') +
      "<span>Ownership total <strong>" + tot + " percent</strong></span></div>";
    if (W.errs.Ltotal) h += '<div class="note note-error mt-12">' + UI.esc(W.errs.Ltotal) + "</div>";
    if (W.errs.Lnone) h += '<div class="note note-error mt-12">' + UI.esc(W.errs.Lnone) + "</div>";
    return h;
  }

  // ————— the spine —————

  function spineHtml() {
    return '<div class="wiz-spine">' + spineInner() + "</div>";
  }

  // the spine's contents alone: a step change rewrites these in place and
  // does not animate. A marker moving is a state change, not an entrance.
  function spineInner() {
    var totalSteps = W.steps.length;
    var h = "";
    h += W.steps.map(function (st, i) {
      var done = W.done[i] && W.step !== i;
      var cls = "wiz-step" + (W.step === i ? " cur" : "") + (done ? " donestep" : "") + (stepLocked(i) ? " lockstep" : "");
      return '<button class="' + cls + '" data-ws="' + i + '" type="button">' +
        '<span class="wiz-num">' + (done ? icon("check", 10) : (i + 1)) + "</span>" +
        "<span>" + UI.esc(st.title) + "</span>" +
        (stepLocked(i) ? '<span class="wiz-lock">read-only</span>' : "") + "</button>";
    }).join("");
    h += '<button class="wiz-step' + (W.step === totalSteps ? " cur" : "") + '" data-ws="' + totalSteps + '" type="button">' +
      '<span class="wiz-num">' + (totalSteps + 1) + "</span><span>Review and submit</span></button>";
    return h;
  }

  // ————— the step body —————

  function stepBodyHtml() {
    var i = W.step, st = W.steps[i], ro = readOnly(i);
    var h = '<h1 class="ob-title">' + UI.esc(st.title) + "</h1>" +
      '<p class="ob-sub">Step ' + (i + 1) + " of " + W.steps.length + (st.sub ? " · " + UI.esc(st.sub) : "") + "</p>";

    if (Data.state.role === "viewer") {
      h += '<div class="note note-warning mt-16">Only an admin can work on the application. This step is read-only for you.</div>';
    } else if (stepLocked(i)) {
      h += '<div class="note note-warning mt-16">This step wasn’t flagged, so it stays as you submitted it.</div>';
    }

    h += commentsFor(i).map(function (c) {
      return '<div class="ob-comment"><div class="cw">Reviewer comment · ' + UI.esc(c.target) + "</div>" + UI.esc(c.text) + "</div>";
    }).join("");

    h += '<div class="ob-body">';
    h += st.custom === "leadership" ? leadershipHtml(ro) : st.fields.map(function (f) { return fieldHtml(f, ro); }).join("");
    h += "</div>";

    if (ro) {
      h += '<div class="ob-cta-row">' +
        (W.mode === "resub" && W.unlocked.length
          ? '<button class="btn btn-secondary" id="wizToFlagged" type="button">Go to what the reviewer flagged</button>'
          : '<button class="btn btn-secondary" id="wizToHub" type="button">Back to your status</button>') + "</div>";
    } else {
      h += '<div class="ob-cta-row">' +
        (W.step > 0 ? '<button class="btn btn-secondary" id="wizBack" type="button">Back</button>' : "") +
        '<button class="btn btn-primary" id="wizSave" type="button">Save and continue</button>' +
        '<span class="freshline">' + (W.lastSaved
          ? "Last saved " + UI.esc(UI.fmtTs(W.lastSaved)) + ". You can leave and resume."
          : "Progress saves at every step. You can leave and resume.") + "</span></div>";
    }
    return h;
  }

  // ————— the review moment —————

  function reviewHtml() {
    var h = '<h1 class="ob-title">Review your application.</h1>' +
      '<p class="ob-sub">Everything you’re about to submit, in one place. Step ' + (W.steps.length + 1) + " of " + (W.steps.length + 1) + ".</p>";

    W.steps.forEach(function (st, i) {
      var chg = W.mode === "resub" && W.changed[i];
      h += '<div class="rev-group"><div class="rev-head"><span>' + (i + 1) + " · " + UI.esc(st.title) + "</span>" +
        (chg ? '<span class="tag">Updated</span>' : "") +
        (stepLocked(i) || Data.state.role === "viewer"
          ? '<span class="rev-ro">read-only</span>'
          : '<button class="link" data-rev="' + i + '" type="button">Edit</button>') +
        "</div>";
      if (st.custom === "leadership") {
        h += W.leaders.length ? W.leaders.map(function (Ld, n) {
          return '<div class="def-row"><span class="def-label">' + UI.esc(Ld.name || "Unnamed person") + "</span>" +
            '<span class="def-value">' + UI.esc((Ld.own || "0") + " percent · ID " + (upState("L" + n).done ? "uploaded" : "missing")) + "</span></div>";
        }).join("") : '<div class="def-row"><span class="def-label">Leadership</span><span class="def-value">nobody added yet</span></div>';
      } else {
        h += st.fields.map(function (f) {
          var v = (f.type === "upload" || f.type === "uploadfb")
            ? (upDone(f) ? "uploaded" : "missing")
            : (W.values[f.k] || "not answered");
          return '<div class="def-row"><span class="def-label">' + UI.esc(f.label) + "</span>" +
            '<span class="def-value">' + UI.esc(v) + "</span></div>";
        }).join("");
      }
      h += "</div>";
    });

    var allDone = W.done.every(Boolean);
    h += '<div class="note rev-note ' + (allDone ? "note-info" : "note-warning") + '">' +
      (allDone
        ? "Submitting sends this to the review team. You can follow it from your status page."
        : "Some steps aren’t complete yet. Finish them before submitting.") + "</div>";

    if (Data.state.role === "viewer") {
      h += '<p class="ob-sub">Only an admin can submit the application.</p>';
    } else {
      // the button sits in its own block so the settle hairline sweeps
      // under it rather than inside it
      h += '<div class="wiz-submit"><button class="btn btn-primary btn-lg" id="wizSubmit" type="button"' +
        (allDone ? "" : " disabled") + ">" +
        (W.mode === "resub" ? "Resubmit application" : "Submit application") + "</button></div>";
    }
    return h;
  }

  // ————— save —————

  function saveStep() {
    if (W.armSave) {
      W.armSave = false;
      W.saveErr = true;
      paint();
      return;
    }
    W.saveErr = false;
    var st = W.steps[W.step];
    W.errs = {};
    var bad = false;

    if (st.custom === "leadership") {
      if (!W.leaders.length) { W.errs.Lnone = "Add at least one director or beneficial owner before saving."; bad = true; }
      var tot = 0;
      W.leaders.forEach(function (Ld, i) {
        var e = {};
        if (!(Ld.name || "").trim()) { e.name = "Required."; bad = true; }
        if (!(Ld.phone || "").trim()) { e.phone = "Required."; bad = true; }
        var own = parseFloat(Ld.own);
        if (!(own >= 1 && own <= 100)) { e.own = "1 to 100 only."; bad = true; }
        else tot += own;
        if (!upState("L" + i).done) { e.up = "An ID document is required for every person."; bad = true; }
        if (Object.keys(e).length) W.errs["L" + i] = e;
      });
      if (tot > 100) {
        W.errs.Ltotal = "Ownership totals " + tot + " percent. Bring it to 100 or under to save.";
        bad = true;
      }
    } else {
      st.fields.forEach(function (f) {
        if (f.type === "upload" || f.type === "uploadfb") {
          if (!upDone(f)) {
            W.errs[f.k] = "Required. Upload " + (f.type === "uploadfb" ? "both sides" : "the document") + ".";
            bad = true;
          }
        } else if (!(W.values[f.k] || "").trim()) {
          W.errs[f.k] = "Required.";
          bad = true;
        }
      });
    }

    if (bad) { paint(); return; }

    W.done[W.step] = true;
    W.lastSaved = new Date().toISOString();
    if (W.mode === "resub") {
      W.visited[W.step] = true;
      var remaining = W.unlocked.filter(function (i) { return !W.visited[i]; });
      W.step = remaining.length ? remaining[0] : W.steps.length;
    } else {
      W.step = Math.min(W.step + 1, W.steps.length);
    }
    W.errs = {};
    paint();
  }

  function fillStep(i) {
    var st = W.steps[i];
    if (st.custom === "leadership") {
      W.leaders = sampleLeaders();
      W.leaders.forEach(function (Ld, n) { W.up["L" + n] = { done: true, fileName: "id-document.jpg" }; });
      return;
    }
    st.fields.forEach(function (f) {
      if (f.type === "upload") W.up[f.k] = { done: true, fileName: fileName(f, false) };
      else if (f.type === "uploadfb") {
        W.up[f.k + ".f"] = { done: true, fileName: fileName(f, true) };
        W.up[f.k + ".b"] = { done: true, fileName: fileName(f, true) };
      } else W.values[f.k] = f.sample;
    });
  }

  // ————— render —————

  function lockedZoneHtml() {
    var r = Data.state.journey.review;
    var line = {
      in_review: "Your application is with the review team.",
      parked: "Your application is being reviewed before onboarding opens.",
      approved: "Your application was approved.",
      rejected: "Your application was declined."
    }[r] || "There’s nothing to work on here right now.";
    return '<div class="bare-sheet">' +
      '<h1 class="ob-title">Nothing to fill in right now.</h1>' +
      '<p class="ob-sub">' + UI.esc(line) + "</p>" +
      '<div class="ob-cta-row"><button class="btn btn-primary" id="wizToHub" type="button">Back to your status</button></div>' +
      "</div>";
  }

  function skeletonHtml() {
    return '<div class="bare-sheet bare-sheet-wide"><div class="wiz-grid"><div>' +
      UI.skel("100%", "30px") + '<div class="mt-8">' + UI.skel("100%", "30px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "30px") + "</div></div><div>" +
      UI.skel("60%", "30px") + '<div class="mt-16">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div></div></div></div>";
  }

  function render(el) {
    var right = document.getElementById("bareRight");
    if (right) right.textContent = window.PrimeOnboarding ? PrimeOnboarding.email() : Data.state.user.email;

    var r = Data.state.journey.review;
    if (["in_review", "parked", "approved", "rejected"].indexOf(r) >= 0) {
      el.insertAdjacentHTML("beforeend", lockedZoneHtml());
      el.querySelector("#wizToHub").addEventListener("click", function () { App.go("hub"); });
      return;
    }

    if (!loadedOnce) {
      var pre = document.createElement("div");
      pre.innerHTML = skeletonHtml();
      el.appendChild(pre);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { pre.remove(); renderBody(el); }
      }, 320);
      return;
    }
    renderBody(el);
  }

  // the notes above the step body: resubmit mode, and a save that failed
  function notesHtml() {
    var notes = "";
    if (W.mode === "resub") {
      notes += '<div class="note note-warning wiz-note"><strong>Resubmit mode.</strong> Only the flagged steps are unlocked. Fix them, then resubmit from the review step.</div>';
    }
    if (W.saveErr) {
      notes += '<div class="note note-error wiz-note">We couldn’t save this step. Your answers are still here. ' +
        '<button class="link link-underline" id="wizRetry" type="button">Retry save</button></div>';
    }
    return notes;
  }

  function bodyHtml() {
    return notesHtml() + (W.step >= W.steps.length ? reviewHtml() : stepBodyHtml());
  }

  function renderBody(el) {
    ensure();

    var h = '<div class="bare-sheet bare-sheet-wide"><div class="wiz-grid" id="wizGrid">' +
      spineHtml() +
      '<div class="wiz-body">' + bodyHtml() + "</div>" +
      "</div></div>";

    h += '<div class="ob-demo wide"><div class="ob-demo-row">' +
      '<button class="db-btn" id="wizFill" type="button">Fill this step with sample data</button>' +
      '<button class="db-btn' + (W.armUp ? " armed" : "") + '" id="wizArmUp" type="button">Arm: next upload rejected</button>' +
      '<button class="db-btn' + (W.armSave ? " armed" : "") + '" id="wizArmSave" type="button">Arm: next save fails</button>' +
      '<button class="db-btn" id="wizJump" type="button">Complete every step, go to the review</button>' +
      "</div>" +
      '<span class="freshline">Demo · journey shortcuts and failure states.</span>' +
      "</div>";

    el.insertAdjacentHTML("beforeend", h);
    wireSpine(el.querySelector(".wiz-spine"));
    wireBody(el.querySelector(".wiz-body"));
    wireDemo(el);
  }

  // ————— the local repaint: spine in place, body over 200ms —————
  // Everything the wizard does to itself comes through here. App.rerender()
  // would rebuild .screen and replay the page entrance for what is, every
  // time, one region changing.
  function paint() {
    var grid = document.getElementById("wizGrid");
    var spine = grid && grid.querySelector(".wiz-spine");
    var body = grid && grid.querySelector(".wiz-body");
    if (!spine || !body) { App.rerender(); return; }   // not our DOM any more
    spine.innerHTML = spineInner();
    UI.repaint(body, bodyHtml());
    wireSpine(spine);
    wireBody(body);
    syncDemo();
  }

  function syncDemo() {
    if (!W) return;   // the journey went to the reviewer mid-interaction
    var up = document.getElementById("wizArmUp");
    var sv = document.getElementById("wizArmSave");
    if (up) up.classList.toggle("armed", !!W.armUp);
    if (sv) sv.classList.toggle("armed", !!W.armSave);
  }

  function wireSpine(spine) {
    if (!spine) return;
    spine.querySelectorAll("[data-ws]").forEach(function (b) {
      b.addEventListener("click", function () {
        W.step = +b.getAttribute("data-ws");
        W.errs = {};
        paint();
      });
    });
  }

  function wireBody(body) {
    if (!body) return;
    var atReview = W.step >= W.steps.length;

    var retry = body.querySelector("#wizRetry");
    if (retry) retry.addEventListener("click", function () { W.saveErr = false; saveStep(); });

    var toHub = body.querySelector("#wizToHub");
    if (toHub) toHub.addEventListener("click", function () { App.go("hub"); });
    var toFlagged = body.querySelector("#wizToFlagged");
    if (toFlagged) toFlagged.addEventListener("click", function () {
      W.step = W.unlocked[0]; paint();
    });

    if (atReview) {
      body.querySelectorAll("[data-rev]").forEach(function (b) {
        b.addEventListener("click", function () { W.step = +b.getAttribute("data-rev"); paint(); });
      });
      var sub = body.querySelector("#wizSubmit");
      if (sub) sub.addEventListener("click", function () {
        if (sub.disabled) return;
        var resub = W.mode === "resub";
        sub.disabled = true;
        // the completion mark: handing over an entire application is the
        // most consequential thing a client does in onboarding, so the
        // hairline runs before the hand-off to the status hub
        UI.settleFlash(sub.parentNode);
        UI.toast(resub ? "Resubmitted. Your application is back with the review team." : "Submitted. Your application is with the review team.", "done");
        setTimeout(function () {
          Data.setJourney({ review: "in_review", submittedIso: new Date().toISOString(), comments: [] });
          W = null; // the journey is with the reviewer now
          App.go("hub");
        }, 420);
      });
    } else {
      var st = W.steps[W.step], ro = readOnly(W.step);

      if (st.custom === "leadership") {
        body.querySelectorAll("[data-lf]").forEach(function (inp) {
          inp.addEventListener("input", function () {
            W.leaders[+inp.getAttribute("data-li")][inp.getAttribute("data-lf")] = inp.value;
            if (W.mode === "resub") W.changed[W.step] = true;
            if (inp.getAttribute("data-lf") === "own") updateTotal(body);
          });
        });
        body.querySelectorAll("[data-rml]").forEach(function (b) {
          b.addEventListener("click", function () {
            var i = +b.getAttribute("data-rml");
            W.leaders.splice(i, 1);
            // ID documents are keyed by position, so re-key them
            var moved = {};
            W.leaders.forEach(function (_, n) {
              moved["L" + n] = W.up["L" + (n >= i ? n + 1 : n)] || { done: false, err: null, fileName: null };
            });
            Object.keys(W.up).forEach(function (k) { if (/^L\d+$/.test(k)) delete W.up[k]; });
            Object.keys(moved).forEach(function (k) { W.up[k] = moved[k]; });
            W.errs = {};
            paint();
          });
        });
        if (!ro) W.leaders.forEach(function (Ld, i) {
          wireUpBox(body, "L" + i, { k: "L" + i, label: "ID document", types: "JPG or PNG" }, true);
        });
        var add = body.querySelector("#addLeader");
        if (add) add.addEventListener("click", function () {
          W.leaders.push({ up: false });
          paint();
        });
      } else {
        st.fields.forEach(function (f) {
          if (f.type === "upload" || f.type === "uploadfb") {
            if (!ro) wireField(body, f);
          } else {
            var inp = body.querySelector("#wf_" + f.k);
            if (!inp) return;
            var onInput = function () {
              W.values[f.k] = inp.value;
              if (W.mode === "resub") W.changed[W.step] = true;
            };
            inp.addEventListener("input", onInput);
            inp.addEventListener("change", onInput);
          }
        });
        var tmpl = body.querySelector("#wfTemplate");
        if (tmpl) tmpl.addEventListener("click", function () {
          UI.toast("Board resolution template downloaded. Upload the signed copy here.");
        });
      }

      var back = body.querySelector("#wizBack");
      if (back) back.addEventListener("click", function () { W.step--; W.errs = {}; paint(); });
      var save = body.querySelector("#wizSave");
      if (save) save.addEventListener("click", saveStep);
    }
  }

  // demo controls live outside the repainted region, so they are wired
  // once per render and keep their own armed state in sync
  function wireDemo(el) {
    el.querySelector("#wizFill").addEventListener("click", function () {
      if (W.step >= W.steps.length) { UI.toast("Nothing to fill on the review step.", "blocked"); return; }
      if (readOnly(W.step)) { UI.toast("This step is read-only.", "blocked"); return; }
      fillStep(W.step);
      if (W.mode === "resub") W.changed[W.step] = true;
      paint();
    });
    el.querySelector("#wizArmUp").addEventListener("click", function () {
      W.armUp = !W.armUp;
      syncDemo();
      if (W.armUp) UI.toast("Armed. The next upload comes back rejected.");
    });
    el.querySelector("#wizArmSave").addEventListener("click", function () {
      W.armSave = !W.armSave;
      syncDemo();
      if (W.armSave) UI.toast("Armed. The next save fails.");
    });
    el.querySelector("#wizJump").addEventListener("click", function () {
      W.steps.forEach(function (_, i) {
        if (readOnly(i)) return;
        fillStep(i);
        W.done[i] = true;
        if (W.mode === "resub") W.changed[i] = true;
      });
      if (W.mode === "resub") W.done = W.done.map(function () { return true; });
      W.lastSaved = new Date().toISOString();
      W.step = W.steps.length;
      paint();
    });
  }

  // live ownership total without re-rendering the form under the cursor
  function updateTotal(body) {
    var tot = W.leaders.reduce(function (a, Ld) { return a + (parseFloat(Ld.own) || 0); }, 0);
    var host = body.querySelector(".lead-total");
    if (!host) return;
    var out = host.querySelector("strong");
    if (out) out.textContent = tot + " percent";
    // over 100 is a failure, so it takes the failure hue, through a class.
    // Failure is the one kind of coloured text the law allows.
    host.classList.toggle("over", tot > 100);
  }

  App.registerScreen("kyc", {
    title: "Verification",
    zone: "onboard",
    render: render,
    // the wizard holds every in-progress answer locally and re-renders
    // itself; a notification must never wipe a half-filled form
    onData: function (scope) { return scope !== "journey"; }
  });
})();
