// ============================================================
// assessment.js — PHS Safety Knowledge (single-file logic)
// Preserves all existing features from your LAST working version,
// and ADDS:
//   ✅ Ctrl+S  -> export encrypted progress file (.puk)
//   ✅ Ctrl+L  -> import encrypted progress file (.puk) ONLY if Student ID matches
// Encryption: AES-GCM with PBKDF2 key derived from Student ID
// ============================================================

// ------------------------------------------------------------
// Local storage – now dynamic & versioned
// ------------------------------------------------------------
let STORAGE_KEY;                // set after questions load
let data = { answers: {} };     // default
let currentAssessmentId = null; // track which assessment is loaded
let APP_ID = "";
let APP_VERSION = "noversion";
let storageAvailable = true;

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    storageAvailable = false;
    console.warn("Browser storage is unavailable:", error);
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    storageAvailable = true;
    return true;
  } catch (error) {
    storageAvailable = false;
    console.warn("Browser storage could not save data:", error);
    return false;
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    storageAvailable = false;
    console.warn("Browser storage could not remove data:", error);
    return false;
  }
}

function storageKeys() {
  try {
    return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter(Boolean);
  } catch (error) {
    storageAvailable = false;
    console.warn("Browser storage could not be read:", error);
    return [];
  }
}

function initStorage(appId, version = "noversion") {
  STORAGE_KEY = `${appId}_${version}_DATA`;

  // Migrate from previous version key (if new key missing)
  if (!storageGet(STORAGE_KEY)) {
    const prevKey = findMostRecentStorageKeyForApp(appId, STORAGE_KEY);

    if (prevKey) {
      try {
        const prev = JSON.parse(storageGet(prevKey));
        if (prev && typeof prev === "object") {
          prev.migratedFrom = prevKey;
          prev.migratedAt = new Date().toISOString();
          storageSet(STORAGE_KEY, JSON.stringify(prev));
        }
      } catch (e) {
        console.warn("Migration from previous version failed:", e);
      }
    }
  }

  // Load data from current key
  data = { answers: {} };

  try {
    const saved = storageGet(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") data = parsed;
    }
  } catch (e) {
    console.warn("Failed to parse stored data:", e);
  }

  // OPTIONAL cleanup (⚠️ see warning below)
  // cleanupOldVersionsKeepLatest(appId, 3, STORAGE_KEY);
  // cleanupOldVersionsDeleteAll(appId, STORAGE_KEY);
}

// ------------------------------------------------------------
// Lightweight answer obfuscation (UTF-8 safe, with legacy decode)
// ------------------------------------------------------------
const XOR_KEY = 47;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const xorEncode = (value) => {
  if (!value) return "";
  const bytes = UTF8_ENCODER.encode(value);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= XOR_KEY;
  return `u8:${bytesToBase64(bytes)}`;
};

const xorDecode = (value) => {
  if (!value) return "";
  try {
    if (value.startsWith("u8:")) {
      const bytes = base64ToBytes(value.slice(3));
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= XOR_KEY;
      return UTF8_DECODER.decode(bytes);
    }

    // Backward compatibility with backups created by older builds.
    return atob(value)
      .split("")
      .map((character) => String.fromCharCode(character.charCodeAt(0) ^ XOR_KEY))
      .join("");
  } catch (error) {
    console.warn("A saved answer could not be decoded:", error);
    return "";
  }
};

// ------------------------------------------------------------
// Globals
// ------------------------------------------------------------
let APP_TITLE, APP_SUBTITLE, TEACHERS, ASSESSMENTS;
let DEADLINE = null; // from questions.json.DEADLINE

// ------------------------------------------------------------
// DEBUG MODE
// ------------------------------------------------------------
const DEBUG = false; // ← Debug logging off in production

// ------------------------------------------------------------
// Requirements
// ------------------------------------------------------------
const MIN_PCT_FOR_SUBMIT = 100; // Change to e.g. 80 if you want 80% or better

function findMostRecentStorageKeyForApp(appId, currentKey) {
  try {
    const prefix = `${appId}_`;
    let bestKey = null;
    let bestLastSaved = 0;

    for (const k of storageKeys()) {
      if (!k) continue;

      if (k.startsWith(prefix) && k.endsWith("_DATA") && k !== currentKey) {
        const raw = storageGet(k);
        let lastSaved = 0;

        try {
          const parsed = JSON.parse(raw);
          lastSaved = parsed?.lastSaved ? Date.parse(parsed.lastSaved) : 0;
        } catch {}

        if (!bestKey || lastSaved > bestLastSaved) {
          bestKey = k;
          bestLastSaved = lastSaved;
        }
      }
    }

    return bestKey;
  } catch (e) {
    console.warn("findMostRecentStorageKeyForApp failed:", e);
    return null;
  }
}

function cleanupOldVersionsDeleteAll(appId, currentKey) {
  try {
    const prefix = `${appId}_`;

    for (const k of storageKeys().reverse()) {
      if (!k) continue;

      if (k.startsWith(prefix) && k.endsWith("_DATA") && k !== currentKey) {
        storageRemove(k);
      }
    }
  } catch (e) {
    console.warn("cleanupOldVersionsDeleteAll failed:", e);
  }
}

// ------------------------------------------------------------
// Load questions.json (also extracts APP_ID & VERSION & DEADLINE)
// ------------------------------------------------------------
const scriptLoadPromises = new Map();

async function loadScriptOnce(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing?.dataset.loaded === "true") return;
  if (scriptLoadPromises.has(src)) return scriptLoadPromises.get(src);

  // Remove a previous failed script so a later button press can retry.
  if (existing) existing.remove();

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      script.remove();
      scriptLoadPromises.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });

  scriptLoadPromises.set(src, promise);
  return promise;
}

const PDF_LIBRARY_URLS = {
  jspdf: [
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  ],
  html2canvas: [
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
  ],
  pdfLib: [
    "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
  ],
};

async function loadFirstAvailableScript(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      await loadScriptOnce(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No script source was available.");
}

function isAppleMobileDevice() {
  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function downloadBlob(blob, filename) {
  if (!blob) throw new Error("No file was created.");

  if (navigator.msSaveOrOpenBlob) {
    navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";

  // Safari on iPad may preview Blob URLs rather than honouring download.
  // Opening a separate tab keeps the assessment safe and gives the student
  // access to Safari's Share > Save to Files action.
  if (isAppleMobileDevice()) link.target = "_blank";

  document.body.appendChild(link);
  link.click();
  link.remove();

  // iPadOS can defer reading a Blob URL while it opens the preview. Keep the
  // URL alive long enough for that hand-off to complete.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function canShareFile(file) {
  if (!file || typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

async function fetchOptionalPdfBytes(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 100) return null;
    return buf;
  } catch {
    return null;
  }
}

function getStudentEmail(studentId) {
  const id = (studentId || "").trim();
  if (!id) return "";
  return `${id}@pukekohehigh.school.nz`;
}

async function fillPdfForm(pdfBytes, finalData) {
  if (!window.PDFLib) {
    await loadFirstAvailableScript(PDF_LIBRARY_URLS.pdfLib);
  }
  if (!window.PDFLib) throw new Error("pdf-lib failed to load");

  const { PDFDocument } = window.PDFLib;

  const doc = await PDFDocument.load(pdfBytes);
  const form = doc.getForm();

  const safeSetMany = (nameLike, value) => {
    try {
      form.getFields().forEach((f) => {
        try {
          const n = f.getName();
          if (n.toLowerCase().includes(nameLike.toLowerCase())) {
            if (typeof f.setText === "function") {
              f.setText(value || "");
            }
          }
        } catch {}
      });
    } catch (e) {
      console.warn(`safeSetMany failed for: ${nameLike}`, e);
    }
  };

  // (kept for compatibility / logs)
  const safeSet = (fieldName, value) => {
    try {
      form.getTextField(fieldName).setText(value || "");
    } catch (e) {
      console.warn(`Field not found: ${fieldName}`);
    }
  };

  const studentEmail = getStudentEmail(finalData.studentId);
  const studentCombined = `${finalData.studentName} ${studentEmail}`.trim();

  safeSetMany("StudentName", studentCombined);
  safeSetMany("AssessorName", finalData.teacherName);
  safeSetMany("Date", new Date().toLocaleDateString("en-NZ"));
  safeSetMany("Result", finalData.pct >= 100 ? "A" : "N");

  form.flatten();
  return await doc.save();
}

async function appendPdfBytesToBlob(mainPdfBlob, extraPdfBytes) {
  if (!window.PDFLib) {
    await loadFirstAvailableScript(PDF_LIBRARY_URLS.pdfLib);
  }
  if (!window.PDFLib) throw new Error("pdf-lib failed to load");

  const { PDFDocument } = window.PDFLib;

  const mainBytes = await mainPdfBlob.arrayBuffer();
  const mainDoc = await PDFDocument.load(mainBytes);
  const extraDoc = await PDFDocument.load(extraPdfBytes);

  const merged = await PDFDocument.create();

  const mainPages = await merged.copyPages(mainDoc, mainDoc.getPageIndices());
  mainPages.forEach((p) => merged.addPage(p));

  const extraPages = await merged.copyPages(extraDoc, extraDoc.getPageIndices());
  extraPages.forEach((p) => merged.addPage(p));

  const mergedBytes = await merged.save();
  return new Blob([mergedBytes], { type: "application/pdf" });
}

async function loadQuestions() {
  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.textContent = "Loading questions…";
  try {
    let json = null;
    let fetchError = null;

    if (location.protocol !== "file:") {
      try {
        const res = await fetch("questions.json", { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = await res.json();
      } catch (error) {
        fetchError = error;
      }
    }

    if (!json && window.PHS_QUESTIONS_DATA) {
      json = JSON.parse(JSON.stringify(window.PHS_QUESTIONS_DATA));
    }
    if (!json) throw fetchError || new Error("Assessment data could not be loaded.");
    if (DEBUG) console.log("Assessment data loaded:", json);

    APP_ID = json.APP_ID;
    APP_VERSION = json.VERSION || "noversion";
    if (!APP_ID) throw new Error("Assessment data is missing APP_ID");
    initStorage(APP_ID, APP_VERSION);

    APP_TITLE = json.APP_TITLE;
    APP_SUBTITLE = json.APP_SUBTITLE;
    TEACHERS = json.TEACHERS;
    DEADLINE = json.DEADLINE || null;

    ASSESSMENTS = (json.ASSESSMENTS || []).map((ass) => ({
      ...ass,
      questions: ass.questions.map((q) => ({
        ...q,
        rubric: (q.rubric || []).map((r) => ({
          ...r,
          check: new RegExp(r.check, r.flags || "i"),
        })),
      })),
    }));

    if (DEBUG) console.log("ASSESSMENTS ready:", ASSESSMENTS);
  } catch (err) {
    console.error("Failed to load assessment data:", err);
    document.body.replaceChildren();
    const box = document.createElement("main");
    box.className = "fatal-error";
    const heading = document.createElement("h1");
    heading.textContent = "Assessment could not open";
    const detail = document.createElement("p");
    detail.textContent = err.message || "The assessment data could not be loaded.";
    const help = document.createElement("p");
    help.textContent = "Open the app from the school website using Safari or another current browser. If using downloaded files, keep the complete folder together.";
    box.append(heading, detail, help);
    document.body.appendChild(box);
    throw err;
  } finally {
    if (loadingEl) loadingEl.remove();
  }
}

// ------------------------------------------------------------
// initApp
// ------------------------------------------------------------
function initApp() {
  document.getElementById("page-title").textContent = APP_TITLE;
  document.getElementById("app-title").textContent = APP_TITLE;
  document.getElementById("app-subtitle").textContent = APP_SUBTITLE;

  // Teacher dropdown
  const teacherSel = document.getElementById("teacher");
  TEACHERS.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    teacherSel.appendChild(opt);
  });

  // Assessment dropdown
  const assSel = document.getElementById("assessmentSelector");
  ASSESSMENTS.forEach((ass, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = ass.title;
    assSel.appendChild(opt);
  });

  // Restore stored basic info
  if (data.name) document.getElementById("name").value = data.name;
  if (data.id) {
    const idEl = document.getElementById("id");
    idEl.value = data.id;

    // ✅ Only lock if we've actually locked it before (after first assessment load)
    if (data.idLocked) {
      idEl.readOnly = true;
      idEl.classList.add("locked-field");
      document.getElementById("locked-msg").classList.remove("hidden");
      document.getElementById("locked-id").textContent = data.id;
    }
  }
  if (data.teacher) teacherSel.value = data.teacher;
  if (data.assessmentIndex !== undefined && data.assessmentIndex !== "") {
    assSel.value = String(data.assessmentIndex);
  }

  setupDeadlineBanner();
}

// ------------------------------------------------------------
// Save / load answers (per-assessment)
// ------------------------------------------------------------
function saveAnswer(qid) {
  if (!currentAssessmentId) return;
  const field = document.getElementById("q" + qid);
  if (!field) return;

  const val = field.value;

  if (!data.answers[currentAssessmentId]) {
    data.answers[currentAssessmentId] = {};
  }

  data.answers[currentAssessmentId][qid] = xorEncode(val);
  data.lastSaved = new Date().toISOString();
  storageSet(STORAGE_KEY, JSON.stringify(data));
}

function getAnswer(qid) {
  if (!currentAssessmentId) return "";
  const encVal = data.answers[currentAssessmentId]?.[qid];
  return xorDecode(encVal || "");
}

// ------------------------------------------------------------
// Toast
// ------------------------------------------------------------
let toastTimeout;
function showToast(msg, ok = true) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove("error", "show");
  if (!ok) toast.classList.add("error");
  void toast.offsetWidth;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3000);
}

const PASTE_BLOCKED_MESSAGE = "Pasting blocked – please type your own answer.";

// ------------------------------------------------------------
// Student info
// ------------------------------------------------------------
function saveStudentInfo() {
  data.name = document.getElementById("name").value.trim();
  data.id = document.getElementById("id").value.trim();
  data.teacher = document.getElementById("teacher").value;
  data.assessmentIndex = document.getElementById("assessmentSelector")?.value || "";
  data.lastSaved = new Date().toISOString();
  storageSet(STORAGE_KEY, JSON.stringify(data));
}

function loadAssessment() {
  const idx = document.getElementById("assessmentSelector").value;
  if (idx === "") {
    showToast("Please select an assessment first.", false);
    return;
  }

  const idEl = document.getElementById("id");
  if (!idEl.value.trim()) {
    showToast("Please enter your Student ID first.", false);
    return;
  }

  saveStudentInfo();

  // ✅ Lock ID to device after the FIRST assessment load
  if (data.id && !data.idLocked) {
    data.idLocked = true;
    storageSet(STORAGE_KEY, JSON.stringify(data));
    idEl.readOnly = true;
    idEl.classList.add("locked-field");
    document.getElementById("locked-msg").classList.remove("hidden");
    document.getElementById("locked-id").textContent = data.id;
    showToast("Student ID locked for this device.");
  }

  const ass = ASSESSMENTS[idx];
  currentAssessmentId = ass.id;

  const questionsDiv = document.getElementById("questions");
  questionsDiv.innerHTML = "";

  ass.questions.forEach((q) => {
    const wrap = document.createElement("div");
    wrap.className = "question";
    wrap.id = "q-" + q.id.toLowerCase();

    const header = document.createElement("div");
    header.className = "question-header";

    const markSpan = document.createElement("span");

    let displayId;
    const simpleMatch = q.id.match(/^q(\d+)$/i);
    if (simpleMatch) displayId = "Q" + simpleMatch[1];
    else displayId = q.id.toUpperCase();

    markSpan.textContent = `${displayId} – ${q.maxPoints} mark${q.maxPoints !== 1 ? "s" : ""}`;
    header.appendChild(markSpan);

    const typeSpan = document.createElement("span");
    typeSpan.textContent =
      q.type === "mc"
        ? "Multi-choice"
        : q.type === "short"
        ? "Short answer"
        : "Extended answer";
    header.appendChild(typeSpan);

    wrap.appendChild(header);

    const p = document.createElement("p");
    p.textContent = q.text;
    wrap.appendChild(p);

    if (q.image) {
      const img = document.createElement("img");
      img.alt = "Question image";
      img.loading = "lazy";

      img.onerror = function () {
        if (!this.dataset.fallbackTried) {
          this.dataset.fallbackTried = "1";
          this.src = "blank.jpg";
        } else {
          this.style.display = "none";
        }
      };

      img.src = q.image;
      wrap.appendChild(img);
    }

    let field;
    const fieldId = "q" + q.id;

    if (q.type === "mc") {
      field = document.createElement("select");
      field.id = fieldId;
      field.className = "answer-field";
      const blankOpt = document.createElement("option");
      blankOpt.value = "";
      blankOpt.textContent = "Select an answer";
      field.appendChild(blankOpt);
      (q.options || []).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        field.appendChild(o);
      });
    } else if (q.type === "short") {
      field = document.createElement("input");
      field.type = "text";
      field.id = fieldId;
      field.className = "answer-field";
      field.placeholder = "Type your answer";
    } else {
      field = document.createElement("textarea");
      field.id = fieldId;
      field.className = "answer-field";
      field.rows = 4;
      field.placeholder = "Write your answer here";
    }

    const prev = getAnswer(q.id);
    if (prev) field.value = prev;

    wrap.appendChild(field);
    questionsDiv.appendChild(wrap);
  });

  attachProtection();
  showToast("Assessment loaded.");
}

function gradeIt() {
  const idx = document.getElementById("assessmentSelector").value;
  if (idx === "") return { total: 0, results: [], totalPoints: 0 };

  const ass = ASSESSMENTS[idx];
  let total = 0;
  let totalPoints = 0;

  const results = ass.questions.map((q) => {
    const field = document.getElementById("q" + q.id);
    const ans = (field?.value || "").trim();
    saveAnswer(q.id);

    let earned = 0;
    let bestHint = q.hint || "";

    (q.rubric || []).forEach((rule) => {
      if (rule.check.test(ans)) {
        if (q.maxPoints === 1) earned = Math.max(earned, Math.min(rule.points, q.maxPoints));
        else earned += rule.points;
        if (rule.hint) bestHint = rule.hint;
      }
    });

    if (earned > q.maxPoints) earned = q.maxPoints;

    total += earned;
    totalPoints += q.maxPoints;

    return {
      id: q.id.toUpperCase(),
      earned,
      max: q.maxPoints,
      answer: ans,
      text: q.text,
      hint: bestHint,
    };
  });

  return { total, results, totalPoints };
}

// ------------------------------------------------------------
// Colour question cards + show hints UNDER questions only
// ------------------------------------------------------------
function colourQuestions(results) {
  results.forEach((r) => {
    const qid = r.id.toLowerCase();
    const box = document.getElementById("q-" + qid);
    if (!box) return;

    box.classList.remove("correct", "partial", "wrong");

    const status = r.earned === r.max ? "correct" : r.earned > 0 ? "partial" : "wrong";
    box.classList.add(status);

    const hintClass = "hint-inline";
    let hintEl = box.querySelector("." + hintClass);

    if (r.earned < r.max && r.hint) {
      if (!hintEl) {
        hintEl = document.createElement("div");
        hintEl.className = hintClass;
        box.appendChild(hintEl);
      }
      hintEl.replaceChildren();
      const hintLabel = document.createElement("strong");
      hintLabel.textContent = "Hint: ";
      hintEl.append(hintLabel, document.createTextNode(r.hint));
      hintEl.style.display = "block";
    } else if (hintEl) {
      hintEl.style.display = "none";
    }
  });
}

function enablePdfMode() {
  if (window.ReadingComfort?.suspendForOutput) {
    window.ReadingComfort.suspendForOutput();
  }
  const result = document.getElementById("result");
  if (result) result.classList.add("pdf-mode");
}

function disablePdfMode() {
  const result = document.getElementById("result");
  if (result) result.classList.remove("pdf-mode");
  if (window.ReadingComfort?.resumeAfterOutput) {
    window.ReadingComfort.resumeAfterOutput();
  }
}

// ------------------------------------------------------------
// Encrypted progress save/load (ADDED)
// Ctrl+S = save progress (.puk)
// Ctrl+L = load progress (.puk) ONLY if student ID matches
// ------------------------------------------------------------
const __te = new TextEncoder();
const __td = new TextDecoder();

const __b64 = {
  fromBytes: bytesToBase64,
  toBytes: base64ToBytes,
};

async function __deriveAesKeyFromPassword(password, saltBytes, iterations = 150000) {
  const baseKey = await crypto.subtle.importKey("raw", __te.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function __encryptWithStudentId(obj, studentId) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await __deriveAesKeyFromPassword(studentId, salt);

  const plaintext = __te.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));

  return {
    format: "PHS_SID_ENC_V1",
    savedAt: new Date().toISOString(),
    studentId: studentId, // used for match check (not secret)
    salt: __b64.fromBytes(salt),
    iv: __b64.fromBytes(iv),
    ct: __b64.fromBytes(ct),
  };
}

async function __decryptWithStudentId(payload, studentId) {
  if (!payload || payload.format !== "PHS_SID_ENC_V1") throw new Error("Not a valid progress file.");

  const salt = __b64.toBytes(payload.salt);
  const iv = __b64.toBytes(payload.iv);
  const ct = __b64.toBytes(payload.ct);
  const key = await __deriveAesKeyFromPassword(studentId, salt);

  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    throw new Error("Cannot decrypt (wrong ID or corrupted file).");
  }

  return JSON.parse(__td.decode(new Uint8Array(pt)));
}

function safeFilePart(value, fallback = "file") {
  const cleaned = (value || "")
    .normalize("NFKC")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function __safeFilePart(value) {
  return safeFilePart(value, "student");
}

function __getCurrentStudentId() {
  return (data.id || document.getElementById("id")?.value || "").trim();
}

let __progressFileInput = null;

function __ensureProgressFileInput() {
  if (__progressFileInput) return __progressFileInput;

  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".puk,application/json,.json";
  inp.style.display = "none";

  (document.body || document.documentElement).appendChild(inp);

  inp.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await loadProgressEncryptedFile(file);
  });

  __progressFileInput = inp;
  return __progressFileInput;
}

async function saveProgressEncrypted() {
  const studentId = __getCurrentStudentId();
  if (!studentId) return showToast("Enter Student ID first.", false);
  if (!window.crypto?.subtle) {
    return showToast("Secure backup saving requires the HTTPS school website or installed app.", false);
  }

  const button = document.getElementById("settingsSaveProgress");
  if (button?.disabled) return;
  if (button) button.disabled = true;

  try {
    saveStudentInfo();
    if (currentAssessmentId) {
      const idx = document.getElementById("assessmentSelector")?.value;
      const ass = ASSESSMENTS?.[idx];
      (ass?.questions || []).forEach((q) => saveAnswer(q.id));
    }

    const payload = await __encryptWithStudentId(data, studentId);
    payload.appId = APP_ID;
    payload.appVersion = APP_VERSION;

    const filename = `${__safeFilePart(studentId)}_${safeFilePart(APP_TITLE || "assessment", "assessment")}.puk`;
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    downloadBlob(blob, filename);
    showToast(isAppleMobileDevice() ? "Backup opened. Use Share, then Save to Files." : "Backup download started.");
    updateAppSettingsStatus();
  } catch (error) {
    console.error("Backup download failed:", error);
    showToast("Backup could not be created. Check that the app is opened from the HTTPS school website.", false);
  } finally {
    if (button) button.disabled = false;
  }
}


function readFileAsText(file) {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

function hasMeaningfulProgress() {
  if (data.name || data.teacher || data.assessmentIndex !== undefined) return true;
  return Object.values(data.answers || {}).some((assessment) => Object.keys(assessment || {}).length > 0);
}

function isValidEncryptedPayload(payload) {
  if (!payload || payload.format !== "PHS_SID_ENC_V1") return false;
  return [payload.salt, payload.iv, payload.ct].every((value) => typeof value === "string" && /^[A-Za-z0-9+/=]+$/.test(value));
}

async function loadProgressEncryptedFile(file) {
  if (!file) return;

  const studentId = __getCurrentStudentId();
  if (!studentId) return showToast("Enter Student ID first.", false);
  if (!window.crypto?.subtle) return showToast("Secure backup loading requires the HTTPS school website or installed app.", false);
  if (file.size > 5 * 1024 * 1024) return showToast("This backup is too large to be valid.", false);

  let payload;
  try {
    payload = JSON.parse(await readFileAsText(file));
  } catch {
    return showToast("The selected file is not a valid backup.", false);
  }
  if (!isValidEncryptedPayload(payload)) return showToast("The selected file is not a valid PHS backup.", false);
  if (payload.appId && payload.appId !== APP_ID) return showToast("This backup belongs to a different assessment app.", false);

  // Match check BEFORE decrypt
  const fileId = (payload.studentId || "").trim();
  if (!fileId || fileId !== studentId) {
    return showToast("Student ID mismatch — not loaded.", false);
  }

  let restored;
  try {
    restored = await __decryptWithStudentId(payload, studentId);
  } catch (e) {
    return showToast(e.message || "Decryption failed.", false);
  }

  // ✅ Safety: confirm decrypted id too
  if ((restored.id || "").trim() !== studentId) {
    return showToast("Decrypted ID mismatch — refusing to load.", false);
  }

  if (hasMeaningfulProgress()) {
    const confirmed = window.confirm("Loading this backup will replace the work currently stored in this browser. Continue?");
    if (!confirmed) {
      showToast("Backup loading cancelled.", false);
      return;
    }
  }

  data = restored;

  // IMPORTANT: STORAGE_KEY must already be initialised by loadQuestions()
  if (!STORAGE_KEY) {
    // Still restore UI so teacher can see it, but warn.
    if (DEBUG) console.warn("STORAGE_KEY not set yet; loadQuestions may not have run.");
  } else {
    storageSet(STORAGE_KEY, JSON.stringify(data));
  }

  // Restore UI
  if (data.name) document.getElementById("name").value = data.name;
  if (data.id) document.getElementById("id").value = data.id;
  if (data.teacher) document.getElementById("teacher").value = data.teacher;
  if (data.assessmentIndex !== undefined && data.assessmentIndex !== "") {
    document.getElementById("assessmentSelector").value = String(data.assessmentIndex);
  }

  // Re-apply lock
  const idEl = document.getElementById("id");
  if (data.idLocked) {
    idEl.readOnly = true;
    idEl.classList.add("locked-field");
    document.getElementById("locked-msg").classList.remove("hidden");
    document.getElementById("locked-id").textContent = data.id;
  }

  // Reload the assessment UI (uses restored answers)
  loadAssessment();
  updateAppSettingsStatus();
  closeAppSettings();
  showToast("Backup loaded successfully.");
}

function openProgressFilePicker() {
  const studentId = __getCurrentStudentId();
  if (!studentId) {
    showToast("Enter Student ID first.", false);
    document.getElementById("id")?.focus();
    return;
  }
  __ensureProgressFileInput().click();
}

function updateAppSettingsStatus() {
  const status = document.getElementById("appSettingsStatus");
  if (!status) return;

  const studentId = __getCurrentStudentId();
  if (!studentId) {
    status.textContent = "Enter the Student ID before saving or loading a backup.";
    status.classList.remove("ready");
    return;
  }

  const savedText = data.lastSaved
    ? new Date(data.lastSaved).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" })
    : "not yet";
  const storageMessage = storageAvailable
    ? `Last automatic save: ${savedText}.`
    : "Automatic browser saving is unavailable; download backup files regularly.";
  const securityMessage = window.crypto?.subtle
    ? ""
    : " Secure backups require the HTTPS school website.";
  status.textContent = `Student ID: ${studentId}. ${storageMessage}${securityMessage}`;
  status.classList.toggle("ready", storageAvailable && !!window.crypto?.subtle);
}

let appSettingsPreviousFocus = null;

function getSettingsFocusableElements() {
  const panel = document.getElementById("appSettingsPanel");
  if (!panel) return [];
  return Array.from(panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.classList.contains("hidden"));
}

function openAppSettings() {
  const panel = document.getElementById("appSettingsPanel");
  const backdrop = document.getElementById("appSettingsBackdrop");
  const toggle = document.getElementById("appSettingsToggle");
  if (!panel || !backdrop || !toggle) return;

  appSettingsPreviousFocus = document.activeElement;
  updateAppSettingsStatus();
  panel.classList.remove("hidden");
  backdrop.classList.remove("hidden");
  toggle.setAttribute("aria-expanded", "true");
  panel.setAttribute("aria-hidden", "false");
  backdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("app-settings-open");
  window.setTimeout(() => document.getElementById("appSettingsClose")?.focus(), 0);
}

function closeAppSettings() {
  const panel = document.getElementById("appSettingsPanel");
  const backdrop = document.getElementById("appSettingsBackdrop");
  const toggle = document.getElementById("appSettingsToggle");
  if (!panel || !backdrop || !toggle) return;

  panel.classList.add("hidden");
  backdrop.classList.add("hidden");
  toggle.setAttribute("aria-expanded", "false");
  panel.setAttribute("aria-hidden", "true");
  backdrop.setAttribute("aria-hidden", "true");
  document.body.classList.remove("app-settings-open");
  const focusTarget = appSettingsPreviousFocus instanceof HTMLElement ? appSettingsPreviousFocus : toggle;
  focusTarget?.focus();
}

function initAppSettings() {
  document.getElementById("appSettingsToggle")?.addEventListener("click", openAppSettings);
  document.getElementById("appSettingsClose")?.addEventListener("click", closeAppSettings);
  document.getElementById("appSettingsBackdrop")?.addEventListener("click", closeAppSettings);
  document.getElementById("settingsSaveProgress")?.addEventListener("click", saveProgressEncrypted);
  document.getElementById("settingsLoadProgress")?.addEventListener("click", openProgressFilePicker);
  document.getElementById("id")?.addEventListener("input", updateAppSettingsStatus);

  document.addEventListener("keydown", (event) => {
    const panel = document.getElementById("appSettingsPanel");
    if (!panel || panel.classList.contains("hidden")) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeAppSettings();
      return;
    }

    if (event.key === "Tab") {
      const focusable = getSettingsFocusableElements();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  updateAppSettingsStatus();
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod) return;

  const k = (e.key || "").toLowerCase();

  if (k === "s") {
    e.preventDefault();
    saveProgressEncrypted();
  }

  if (k === "l") {
    e.preventDefault();
    openProgressFilePicker();
  }
});

// ------------------------------------------------------------
// Deadline helpers
// ------------------------------------------------------------
function getDeadlineStatus(now = new Date()) {
  if (!DEADLINE) return null;

  const year = now.getFullYear();
  const d = parseInt(DEADLINE.day, 10);
  const m = parseInt(DEADLINE.month, 10) - 1;
  const label = DEADLINE.label || "Assessment deadline";

  const deadlineDate = new Date(year, m, d);
  const todayMid = new Date(year, now.getMonth(), now.getDate());

  const diffMs = deadlineDate - todayMid;
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 0) {
    return { status: "upcoming", daysLeft: diffDays, label, dateStr: deadlineDate.toLocaleDateString("en-NZ") };
  } else if (diffDays === 0) {
    return { status: "today", daysLeft: 0, label, dateStr: deadlineDate.toLocaleDateString("en-NZ") };
  } else {
    return { status: "overdue", overdueDays: Math.abs(diffDays), label, dateStr: deadlineDate.toLocaleDateString("en-NZ") };
  }
}

function lockAllFieldsForDeadline() {
  const questionsDiv = document.getElementById("questions");
  if (questionsDiv) {
    questionsDiv.querySelectorAll("input, textarea, select").forEach((el) => {
      el.readOnly = true;
      if (el.tagName === "SELECT") el.disabled = true;
      el.classList.add("locked-field");
    });
  }

  const nameEl = document.getElementById("name");
  const idEl = document.getElementById("id");
  const teacherEl = document.getElementById("teacher");
  const assSel = document.getElementById("assessmentSelector");
  const downloadBtn = document.getElementById("downloadBtn");
  const shareBtn = document.getElementById("shareBtn");

  [nameEl, idEl].forEach((el) => {
    if (el) {
      el.readOnly = true;
      el.classList.add("locked-field");
    }
  });

  [teacherEl, assSel].forEach((el) => {
    if (el) el.disabled = true;
  });

  if (downloadBtn) downloadBtn.disabled = true;
  if (shareBtn) shareBtn.disabled = true;
}

function setupDeadlineBanner() {
  const banner = document.getElementById("deadline-banner");
  if (!banner) return;

  const stored = (() => {
    try {
      return JSON.parse(storageGet(STORAGE_KEY)) || data;
    } catch {
      return data;
    }
  })();

  if (!stored.deadlineInfo) stored.deadlineInfo = {};

  if (!stored.deadlineInfo.firstSeen) {
    stored.deadlineInfo.firstSeen = new Date().toISOString();
    storageSet(STORAGE_KEY, JSON.stringify(stored));
  }

  const now = new Date();
  const deadlineStatus = getDeadlineStatus(now);
  if (!deadlineStatus) {
    banner.classList.add("hidden");
    return;
  }

  const firstSeen = new Date(stored.deadlineInfo.firstSeen);
  const daysSinceStart = Math.floor((now - firstSeen) / 86400000);

  let cls = "info";
  let text = "";

  const { status: st, label, dateStr, daysLeft, overdueDays } = {
    status: deadlineStatus.status,
    label: deadlineStatus.label,
    dateStr: deadlineStatus.dateStr,
    daysLeft: deadlineStatus.daysLeft ?? null,
    overdueDays: deadlineStatus.overdueDays ?? null,
  };

  if (st === "upcoming") {
    if (daysLeft <= 7) cls = "hot";
    else if (daysLeft <= 28) cls = "warn";
    else cls = "info";

    text = `${label}: ${dateStr} – ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`;
    if (daysSinceStart !== null && daysSinceStart >= 0) {
      text += ` You started ${daysSinceStart} day${daysSinceStart === 1 ? "" : "s"} ago.`;
    }

    if (daysLeft > 0 && daysLeft <= 7) {
      showToast(`Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} left to complete this assessment.`, false);
    }
  } else if (st === "today") {
    cls = "hot";
    text = `${label}: ${dateStr} – Deadline is today!`;
    showToast("Deadline is today – make sure you submit your work.", false);
  } else if (st === "overdue") {
    cls = "over";
    text = `${label}: ${dateStr} – Deadline has passed. You are ${overdueDays} day${overdueDays === 1 ? "" : "s"} late.`;
    lockAllFieldsForDeadline();
  }

  banner.className = `deadline-banner ${cls}`;
  banner.textContent = text;
  banner.classList.remove("hidden");
}

function applyDeadlineLockIfNeeded() {
  const status = getDeadlineStatus(new Date());
  if (status && status.status === "overdue") lockAllFieldsForDeadline();
}

// ------------------------------------------------------------
// Submit / result rendering
// ------------------------------------------------------------
let finalData = null;
let preparedPdfResult = null;
let pdfPreparationToken = 0;
let pdfActionInProgress = false;
let pdfPreparationInProgress = false;

function clearPreparedPdf() {
  pdfPreparationToken += 1;
  preparedPdfResult = null;
}

function canExportCurrentResult() {
  const deadlineNow = getDeadlineStatus(new Date());
  return !!finalData && finalData.pct >= MIN_PCT_FOR_SUBMIT && (!deadlineNow || deadlineNow.status !== "overdue");
}

function updatePdfActionState() {
  const ready = !!preparedPdfResult;
  const canExport = canExportCurrentResult();
  const busy = pdfActionInProgress || pdfPreparationInProgress;
  const downloadBtn = document.getElementById("downloadBtn");
  const shareBtn = document.getElementById("shareBtn");
  [downloadBtn, shareBtn].forEach((button) => {
    if (!button) return;
    button.disabled = !canExport || !ready || busy;
    button.setAttribute("aria-busy", String(busy));
  });
  const status = document.getElementById("pdfStatus");
  if (status) {
    if (!canExport) status.textContent = "";
    else if (pdfPreparationInProgress) status.textContent = "Preparing the PDF for download and iPad sharing…";
    else if (ready) status.textContent = isAppleMobileDevice()
      ? "PDF ready. Share PDF opens the iPad share sheet; Download PDF may open a preview where you can choose Save to Files."
      : "PDF ready to download or share.";
    else status.textContent = "PDF preparation did not finish. Submit again to retry.";
  }
}

async function preparePdfForExport() {
  if (!canExportCurrentResult()) return;
  const token = ++pdfPreparationToken;
  pdfPreparationInProgress = true;
  updatePdfActionState();
  try {
    const result = await createAssessmentPdf();
    if (!result || token !== pdfPreparationToken) return;
    preparedPdfResult = {
      ...result,
      pdfFile: typeof File === "function" ? new File([result.pdfBlob], result.fileName, { type: "application/pdf" }) : null,
    };
    showToast("PDF ready.");
  } catch (error) {
    if (token === pdfPreparationToken) {
      console.error("PDF preparation failed:", error);
      showToast("PDF could not be prepared. Check the connection and submit again.", false);
    }
  } finally {
    if (token === pdfPreparationToken) {
      pdfPreparationInProgress = false;
      updatePdfActionState();
    }
  }
}

function submitWork() {
  clearPreparedPdf();
  const teacherSel = document.getElementById("teacher");
  const assSel = document.getElementById("assessmentSelector");

  if (!document.getElementById("name").value.trim()) return showToast("Please enter your name.", false);
  if (!document.getElementById("id").value.trim()) return showToast("Please enter your Student ID.", false);
  if (!teacherSel.value) return showToast("Please select your teacher.", false);
  if (!assSel.value) return showToast("Please select an assessment.", false);

  const { total, results, totalPoints } = gradeIt();
  const pct = totalPoints > 0 ? Math.round((total / totalPoints) * 100) : 0;

  colourQuestions(results);

  const studentName = document.getElementById("name").value.trim();
  const teacherName = TEACHERS.find((t) => t.id === teacherSel.value)?.name || "";

  document.getElementById("student").textContent = studentName;
  document.getElementById("teacher-name").textContent = teacherName;
  const gradeEl = document.getElementById("grade");
  gradeEl.replaceChildren(document.createTextNode(`${total}/${totalPoints} `));
  const gradeSmall = document.createElement("small");
  gradeSmall.textContent = `(${pct}%)`;
  gradeEl.appendChild(gradeSmall);

  const answersDiv = document.getElementById("answers");
  answersDiv.innerHTML = "";

  results.forEach((r) => {
    const fb = document.createElement("div");

    const status = r.earned === r.max ? "correct" : r.earned > 0 ? "partial" : "wrong";
    fb.className = `feedback ${status}`;

    const h3 = document.createElement("h3");
    h3.textContent = `${r.id}: ${r.text}`;
    fb.appendChild(h3);

    const pAns = document.createElement("p");
    const strongAns = document.createElement("strong");
    strongAns.textContent = "Your answer: ";
    pAns.appendChild(strongAns);

    const ansSpan = document.createElement("span");
    ansSpan.textContent = r.answer ? r.answer : "No answer provided";
    pAns.appendChild(ansSpan);
    fb.appendChild(pAns);

    const pRes = document.createElement("p");
    const strongRes = document.createElement("strong");
    strongRes.textContent = "Result: ";
    pRes.appendChild(strongRes);

    const statusText = status === "correct" ? "Correct" : status === "partial" ? "Partially correct" : "Incorrect";

    const resSpan = document.createElement("span");
    resSpan.textContent = `${statusText} (${r.earned}/${r.max} marks)`;
    pRes.appendChild(resSpan);

    fb.appendChild(pRes);
    answersDiv.appendChild(fb);
  });

  const deadlineNow = getDeadlineStatus(new Date());

  finalData = {
    studentName,
    studentId: document.getElementById("id").value.trim(),
    teacherName,
    assessmentTitle: ASSESSMENTS[assSel.value].title,
    assessmentSubtitle: ASSESSMENTS[assSel.value].subtitle || "",
    attachSignoff: !!ASSESSMENTS[assSel.value].attachSignoff,
    points: total,
    totalPoints,
    pct,
    deadlineInfo: deadlineNow,
  };

  const canExport = pct >= MIN_PCT_FOR_SUBMIT && (!deadlineNow || deadlineNow.status !== "overdue");
  updatePdfActionState();

  if (canExport) {
    showToast("Great job! Preparing your PDF…", true);
  } else if (pct < MIN_PCT_FOR_SUBMIT) {
    showToast(`You have ${pct}%. You need at least ${MIN_PCT_FOR_SUBMIT}% to export your work.`, false);
  } else if (deadlineNow && deadlineNow.status === "overdue") {
    showToast("The deadline has passed – exporting is disabled.", false);
  }

  document.getElementById("form").classList.add("hidden");
  document.getElementById("result").classList.remove("hidden");
  if (canExport) window.setTimeout(preparePdfForExport, 0);
}

function back() {
  clearPreparedPdf();
  document.getElementById("result").classList.add("hidden");
  document.getElementById("form").classList.remove("hidden");
}

// ------------------------------------------------------------
// Email / PDF (existing behaviour preserved)
// ------------------------------------------------------------
async function createAssessmentPdf() {
  if (!finalData) return alert("Submit first!");

  if (finalData.pct < MIN_PCT_FOR_SUBMIT) {
    alert(`You must reach at least ${MIN_PCT_FOR_SUBMIT}% before exporting your work.`);
    return null;
  }

  const deadlineNow = getDeadlineStatus(new Date());
  if (deadlineNow && deadlineNow.status === "overdue") {
    alert("The submission deadline has passed – exporting is now disabled until next year.");
    return null;
  }

  if (!(window.jspdf && window.html2canvas)) {
    await loadFirstAvailableScript(PDF_LIBRARY_URLS.jspdf);
    await loadFirstAvailableScript(PDF_LIBRARY_URLS.html2canvas);
  }

  if (!window.jspdf || !window.html2canvas) {
    alert("PDF libraries failed to load. Please check your internet connection.");
    return;
  }

  const { jsPDF } = window.jspdf;

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const crestImg = document.querySelector("header img.crest");
  let crestDataUrl = null;

  if (crestImg && crestImg.src) {
    try {
      const crestCanvas = document.createElement("canvas");
      crestCanvas.width = 60;
      crestCanvas.height = 60;
      const ctx = crestCanvas.getContext("2d");
      const tmpImg = new Image();
      tmpImg.crossOrigin = "anonymous";
      tmpImg.src = crestImg.src;
      await new Promise((res, rej) => {
        tmpImg.onload = res;
        tmpImg.onerror = rej;
      });
      ctx.drawImage(tmpImg, 0, 0, 60, 60);
      crestDataUrl = crestCanvas.toDataURL("image/png");
    } catch (e) {
      if (DEBUG) console.log("Crest image failed, continuing without:", e);
    }
  }

  const drawHeader = (isFirstPage = false) => {
    pdf.setFillColor(110, 24, 24);
    pdf.rect(0, 0, pageWidth, 30, "F");

    if (crestDataUrl) pdf.addImage(crestDataUrl, "PNG", 10, 5, 20, 20);

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.text(APP_TITLE || "Pukekohe High School", 35, 15);
    pdf.setFontSize(12);
    pdf.text(APP_SUBTITLE || "Technology Assessment", 35, 22);

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(12);

    const y = 40;

    if (isFirstPage) {
      pdf.text(`Student: ${finalData.studentName}`, 10, y);
      pdf.text(`ID: ${finalData.studentId}`, 10, y + 7);
      pdf.text(`Teacher: ${finalData.teacherName}`, 110, y);
      pdf.text(`Assessment: ${finalData.assessmentTitle}`, 10, y + 15);
      if (finalData.assessmentSubtitle) pdf.text(`Part: ${finalData.assessmentSubtitle}`, 10, y + 22);
      pdf.text(`Score: ${finalData.points}/${finalData.totalPoints} (${finalData.pct}%)`, 10, y + 29);

      const infoY = y + 38;
      const info = finalData.deadlineInfo;

      if (info) {
        pdf.setFontSize(11);
        pdf.setTextColor(0, 0, 0);

        if (info.status === "upcoming") {
          pdf.text(
            `Submitted early: ${info.daysLeft} day${info.daysLeft === 1 ? "" : "s"} before deadline (${info.dateStr}).`,
            10,
            infoY
          );
        } else if (info.status === "today") {
          pdf.text(`Submitted on the deadline date (${info.dateStr}).`, 10, infoY);
        } else if (info.status === "overdue") {
          pdf.text(
            `Late submission: ${info.overdueDays} day${info.overdueDays === 1 ? "" : "s"} after deadline (${info.dateStr}).`,
            10,
            infoY
          );
        }
      }
    } else {
      pdf.text(`Student: ${finalData.studentName} (${finalData.studentId})`, 10, y);
      pdf.text(`Assessment: ${finalData.assessmentTitle}`, 10, y + 7);
      if (finalData.assessmentSubtitle) {
        pdf.setFontSize(11);
        pdf.text(`Part: ${finalData.assessmentSubtitle}`, 10, y + 14);
        pdf.setFontSize(12);
      }
    }
  };

  const marginLeft = 10;
  const marginRight = 10;
  const marginTop = 80;
  const marginBottom = 10;
  const usableHeight = pageHeight - marginTop - marginBottom;

  const TARGET_WIDTH = isAppleMobileDevice() ? 820 : 900;

  const resultSection = document.getElementById("result");
  const blocks = [];

  const resultHeader = resultSection.querySelector(".result-header");
  if (resultHeader) blocks.push(resultHeader);

  resultSection.querySelectorAll(".feedback").forEach((el) => blocks.push(el));
  if (blocks.length === 0) blocks.push(resultSection);

  drawHeader(true);
  let currentY = marginTop;

  enablePdfMode();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    for (const block of blocks) {
      const canvas = await window.html2canvas(block, {
        scale: isAppleMobileDevice() ? 1.2 : 1.5,
        width: TARGET_WIDTH,
        windowWidth: TARGET_WIDTH,
        useCORS: true,
        scrollX: 0,
        scrollY: -window.scrollY,
      });

      let imgData = canvas.toDataURL("image/jpeg", 0.8);
      const imgProps = pdf.getImageProperties(imgData);

      const maxContentWidth = pageWidth - marginLeft - marginRight;
      let imgWidth = maxContentWidth;
      let imgHeight = (imgProps.height * imgWidth) / imgProps.width;

      const maxBlockHeight = usableHeight * 0.9;
      if (imgHeight > maxBlockHeight) {
        const scale = maxBlockHeight / imgHeight;
        imgWidth *= scale;
        imgHeight = maxBlockHeight;
      }

      const xPos = (pageWidth - imgWidth) / 2;

      if (currentY + imgHeight > pageHeight - marginBottom) {
        pdf.addPage();
        drawHeader(false);
        currentY = marginTop;
      }

      pdf.addImage(imgData, "JPEG", xPos, currentY, imgWidth, imgHeight);
      currentY += imgHeight + 5;

      // Release canvas backing stores promptly; this matters on memory-limited iPads.
      canvas.width = 1;
      canvas.height = 1;
      imgData = "";
    }
  } finally {
    disablePdfMode();
  }

  const pageCount = pdf.getNumberOfPages();
  pdf.setFontSize(9);
  pdf.setTextColor(120, 130, 140);
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 6, { align: "center" });
  }

  let pdfBlob = pdf.output("blob");

  // Attach signoff sheet if flagged
  if (finalData.attachSignoff) {
    try {
      const signoffBytes = await fetchOptionalPdfBytes("assessment.pdf");
      if (signoffBytes) {
        const filledBytes = await fillPdfForm(signoffBytes, finalData);
        pdfBlob = await appendPdfBytesToBlob(pdfBlob, filledBytes);
      }
    } catch (e) {
      console.warn("Sign-off sheet fill/append failed, continuing without it:", e);
    }
  }

  const fileName =
    `${safeFilePart(finalData.studentId || "student", "student")}_` +
    `${safeFilePart(finalData.studentName || "name", "name")}_` +
    `${safeFilePart(finalData.assessmentTitle || "assessment", "assessment")}.pdf`;

  return { pdfBlob, fileName };
}

function setPdfActionBusy(isBusy) {
  pdfActionInProgress = isBusy;
  updatePdfActionState();
}

function downloadPreparedPdf() {
  if (!preparedPdfResult) {
    showToast("The PDF is still being prepared. Please try again in a moment.", false);
    return;
  }
  try {
    downloadBlob(preparedPdfResult.pdfBlob, preparedPdfResult.fileName);
    showToast(isAppleMobileDevice() ? "PDF opened. Use Share, then Save to Files." : "PDF download started.");
  } catch (error) {
    console.error("PDF download failed:", error);
    showToast("PDF could not be downloaded.", false);
  }
}

function downloadWork() {
  if (pdfActionInProgress || pdfPreparationInProgress) return;
  downloadPreparedPdf();
}

function shareWork() {
  if (pdfActionInProgress || pdfPreparationInProgress) return;
  if (!preparedPdfResult) {
    showToast("The PDF is still being prepared. Please try again in a moment.", false);
    return;
  }

  const pdfFile = preparedPdfResult.pdfFile;
  if (!canShareFile(pdfFile)) {
    downloadPreparedPdf();
    showToast("Direct file sharing is unavailable. The PDF was opened for saving instead.", false);
    return;
  }

  // Do not await any PDF work before this call. Safari requires navigator.share
  // to run directly from the student's tap, otherwise it can throw NotAllowedError.
  setPdfActionBusy(true);
  navigator.share({
    title: "Assessment PDF",
    text: "Here is my completed assessment.",
    files: [pdfFile],
  }).then(() => {
    showToast("PDF shared successfully.");
  }).catch((error) => {
    if (error?.name === "AbortError") {
      showToast("Sharing cancelled.", false);
      return;
    }
    console.warn("Native file sharing failed:", error);
    showToast("Sharing was blocked. Use Download PDF, then Share or Save to Files.", false);
  }).finally(() => {
    setPdfActionBusy(false);
  });
}

// Keep the old function name for any bookmarked or older HTML version.
async function emailWork() {
  return shareWork();
}

// ------------------------------------------------------------
// Attach protection to inputs (softened anti-cheat)
// ------------------------------------------------------------
function attachProtection() {
  document.querySelectorAll(".answer-field").forEach((f) => {
    f.addEventListener("input", () => saveAnswer(f.id.slice(1)));
    f.addEventListener("paste", (e) => {
      e.preventDefault();
      showToast(PASTE_BLOCKED_MESSAGE, false);
    });
  });
}

// Limit context menu blocking to the question area only (still allow on inputs)
document.addEventListener("contextmenu", (e) => {
  const inQuestionsArea = e.target.closest("#questions");
  if (inQuestionsArea && !e.target.matches("input, textarea")) {
    e.preventDefault();
  }
});

// ------------------------------------------------------------
// Service worker registration for offline/PWA
// ------------------------------------------------------------
if ("serviceWorker" in navigator && isSecureContext && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      if (DEBUG) console.log("Service worker registration failed:", err);
    });
  });
}

// ------------------------------------------------------------
// Export
// ------------------------------------------------------------
window.loadAssessment = loadAssessment;
window.submitWork = submitWork;
window.back = back;
window.emailWork = emailWork;
window.downloadWork = downloadWork;
window.shareWork = shareWork;

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await loadQuestions();
  initApp();
  initAppSettings();
  applyDeadlineLockIfNeeded();

  // Preload libs quietly
  loadFirstAvailableScript(PDF_LIBRARY_URLS.jspdf).catch(() => {});
  loadFirstAvailableScript(PDF_LIBRARY_URLS.html2canvas).catch(() => {});
  loadFirstAvailableScript(PDF_LIBRARY_URLS.pdfLib).catch(() => {});
});
