(() => {
  "use strict";

  const STORAGE_KEY = "PHS_READING_COMFORT_CURRENT_V1";
  const PROFILE_KEY = "PHS_READING_COMFORT_PROFILES_V1";

  const DEFAULTS = Object.freeze({
    colour: "#fff4d6",
    colourName: "Cream",
    strength: 0,
    font: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    textSize: 100,
    letterSpacing: 0,
    lineSpacing: 1.6,
    brightness: 100,
    contrast: 100,
    darkMode: false,
    reducedGlare: false,
    rulerEnabled: false,
    rulerLines: 1,
    rulerTop: 42
  });

  let settings = { ...DEFAULTS };
  let dragActive = false;
  let previousFocus = null;
  let outputSnapshot = null;

  const el = {};

  function clamp(value, min, max, fallback = min) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function sanitise(raw) {
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };

    return {
      colour: /^#[0-9a-f]{6}$/i.test(raw.colour) ? raw.colour : DEFAULTS.colour,
      colourName: typeof raw.colourName === "string" ? raw.colourName.slice(0, 30) : DEFAULTS.colourName,
      strength: clamp(raw.strength, 0, 80, DEFAULTS.strength),
      font: typeof raw.font === "string" && raw.font.length < 150 ? raw.font : DEFAULTS.font,
      textSize: clamp(raw.textSize, 85, 150, DEFAULTS.textSize),
      letterSpacing: clamp(raw.letterSpacing, 0, 8, DEFAULTS.letterSpacing),
      lineSpacing: clamp(raw.lineSpacing, 1.2, 2.4, DEFAULTS.lineSpacing),
      brightness: clamp(raw.brightness, 70, 120, DEFAULTS.brightness),
      contrast: clamp(raw.contrast, 70, 130, DEFAULTS.contrast),
      darkMode: Boolean(raw.darkMode),
      reducedGlare: Boolean(raw.reducedGlare),
      rulerEnabled: Boolean(raw.rulerEnabled),
      rulerLines: clamp(raw.rulerLines, 1, 5, DEFAULTS.rulerLines),
      rulerTop: clamp(raw.rulerTop, 2, 92, DEFAULTS.rulerTop)
    };
  }

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn("Reading comfort storage could not be read.", error);
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("Reading comfort storage could not be saved.", error);
      return false;
    }
  }

  function cacheElements() {
    const ids = [
      "readingComfortToggle", "readingComfortRemove", "readingComfortPanel", "readingComfortClose",
      "readingTint", "readingColourName", "readingColourPresets", "readingCustomColour",
      "readingFilterStrength", "readingFilterStrengthValue", "readingFont", "readingTextSmaller",
      "readingTextLarger", "readingTextSizeValue", "readingLineTighter", "readingLineWider",
      "readingLineSpacingValue", "readingLetterSpacing", "readingLetterSpacingValue",
      "readingBrightness", "readingBrightnessValue", "readingContrast", "readingContrastValue",
      "readingDarkMode", "readingReducedGlare", "readingRuler", "readingRulerHandle",
      "readingRulerEnabled", "readingRulerLines", "readingRulerUp", "readingRulerDown",
      "readingProfileSlot", "readingProfileLoad", "readingProfileSave", "readingProfileDelete",
      "readingProfileStatus", "readingSaveSettings", "readingResetSettings"
    ];

    ids.forEach((id) => {
      el[id] = document.getElementById(id);
    });

    return ids.every((id) => el[id]);
  }

  function isDefaultVisualState() {
    return settings.strength === 0 &&
      settings.textSize === DEFAULTS.textSize &&
      settings.letterSpacing === DEFAULTS.letterSpacing &&
      settings.lineSpacing === DEFAULTS.lineSpacing &&
      settings.brightness === DEFAULTS.brightness &&
      settings.contrast === DEFAULTS.contrast &&
      settings.font === DEFAULTS.font &&
      !settings.darkMode &&
      !settings.reducedGlare &&
      !settings.rulerEnabled;
  }

  function applySettings({ updateControls = true, persist = false } = {}) {
    const root = document.documentElement;
    const body = document.body;

    body.classList.add("reading-comfort-enabled");
    body.classList.toggle("reading-dark-mode", settings.darkMode);
    body.classList.toggle("reading-reduced-glare", settings.reducedGlare);

    root.style.fontSize = `${16 * settings.textSize / 100}px`;
    root.style.setProperty("--reading-font-family", settings.font);
    root.style.setProperty("--reading-letter-spacing", `${settings.letterSpacing}px`);
    root.style.setProperty("--reading-line-height", settings.lineSpacing.toFixed(2));

    const glareBrightnessFactor = settings.reducedGlare ? 0.92 : 1;
    const glareContrastFactor = settings.reducedGlare ? 0.96 : 1;
    root.style.setProperty("--reading-brightness", (settings.brightness / 100 * glareBrightnessFactor).toFixed(3));
    root.style.setProperty("--reading-contrast", (settings.contrast / 100 * glareContrastFactor).toFixed(3));

    el.readingTint.style.backgroundColor = settings.colour;
    el.readingTint.style.opacity = String(settings.strength / 200);

    updateRuler();
    el.readingComfortRemove.classList.toggle("hidden", isDefaultVisualState());

    if (updateControls) syncControls();
    if (persist) writeJson(STORAGE_KEY, settings);
  }

  function syncControls() {
    el.readingColourName.value = settings.colourName;
    el.readingCustomColour.value = settings.colour;
    el.readingFilterStrength.value = String(settings.strength);
    el.readingFilterStrengthValue.value = `${settings.strength}%`;
    el.readingFont.value = settings.font;
    el.readingTextSizeValue.value = `${settings.textSize}%`;
    el.readingLineSpacingValue.value = settings.lineSpacing.toFixed(2);
    el.readingLetterSpacing.value = String(settings.letterSpacing);
    el.readingLetterSpacingValue.value = `${settings.letterSpacing} px`;
    el.readingBrightness.value = String(settings.brightness);
    el.readingBrightnessValue.value = `${settings.brightness}%`;
    el.readingContrast.value = String(settings.contrast);
    el.readingContrastValue.value = `${settings.contrast}%`;
    el.readingDarkMode.checked = settings.darkMode;
    el.readingReducedGlare.checked = settings.reducedGlare;
    el.readingRulerEnabled.checked = settings.rulerEnabled;
    el.readingRulerLines.value = String(settings.rulerLines);

    el.readingColourPresets.querySelectorAll("[data-colour]").forEach((button) => {
      const selected = button.dataset.colour.toLowerCase() === settings.colour.toLowerCase() && settings.colourName !== "Custom";
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function updateRuler() {
    const lineHeight = 16 * settings.textSize / 100 * settings.lineSpacing;
    const height = Math.max(28, lineHeight * settings.rulerLines + 8);
    el.readingRuler.style.height = `${height}px`;
    el.readingRuler.style.top = `${settings.rulerTop}%`;
    el.readingRuler.classList.toggle("hidden", !settings.rulerEnabled);
  }

  function setRulerFromClientY(clientY) {
    const topPercent = clamp(clientY / window.innerHeight * 100, 2, 92);
    settings.rulerTop = Math.round(topPercent * 10) / 10;
    updateRuler();
    writeJson(STORAGE_KEY, settings);
  }

  function moveRulerBy(direction) {
    const lineHeightPx = 16 * settings.textSize / 100 * settings.lineSpacing;
    const percentStep = lineHeightPx / window.innerHeight * 100;
    settings.rulerTop = clamp(settings.rulerTop + direction * Math.max(percentStep, 1.5), 2, 92);
    applySettings({ updateControls: false, persist: true });
  }

  function announce(message) {
    el.readingProfileStatus.textContent = message;
  }

  function openPanel() {
    previousFocus = document.activeElement;
    el.readingComfortPanel.classList.remove("hidden");
    el.readingComfortToggle.setAttribute("aria-expanded", "true");
    el.readingComfortClose.focus();
  }

  function closePanel({ restoreFocus = true } = {}) {
    el.readingComfortPanel.classList.add("hidden");
    el.readingComfortToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
  }

  function suspendForOutput() {
    if (outputSnapshot) return;

    const root = document.documentElement;
    const body = document.body;
    const variableNames = [
      "--reading-font-family",
      "--reading-letter-spacing",
      "--reading-line-height",
      "--reading-brightness",
      "--reading-contrast"
    ];
    const hiddenElements = [
      el.readingTint,
      el.readingRuler,
      el.readingComfortPanel,
      el.readingComfortToggle,
      el.readingComfortRemove
    ];

    outputSnapshot = {
      fontSize: root.style.fontSize,
      variables: Object.fromEntries(variableNames.map((name) => [name, root.style.getPropertyValue(name)])),
      darkMode: body.classList.contains("reading-dark-mode"),
      reducedGlare: body.classList.contains("reading-reduced-glare"),
      displays: hiddenElements.map((element) => element ? element.style.display : "")
    };

    root.style.fontSize = "16px";
    root.style.setProperty("--reading-font-family", DEFAULTS.font);
    root.style.setProperty("--reading-letter-spacing", "0px");
    root.style.setProperty("--reading-line-height", DEFAULTS.lineSpacing.toFixed(2));
    root.style.setProperty("--reading-brightness", "1");
    root.style.setProperty("--reading-contrast", "1");

    body.classList.remove("reading-dark-mode", "reading-reduced-glare");
    hiddenElements.forEach((element) => {
      if (element) element.style.display = "none";
    });
  }

  function resumeAfterOutput() {
    if (!outputSnapshot) return;

    const root = document.documentElement;
    const body = document.body;
    const hiddenElements = [
      el.readingTint,
      el.readingRuler,
      el.readingComfortPanel,
      el.readingComfortToggle,
      el.readingComfortRemove
    ];

    root.style.fontSize = outputSnapshot.fontSize;
    Object.entries(outputSnapshot.variables).forEach(([name, value]) => {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    });

    body.classList.toggle("reading-dark-mode", outputSnapshot.darkMode);
    body.classList.toggle("reading-reduced-glare", outputSnapshot.reducedGlare);
    hiddenElements.forEach((element, index) => {
      if (element) element.style.display = outputSnapshot.displays[index];
    });

    outputSnapshot = null;
  }

  function removeAllReadingChanges() {
    const preservedColour = settings.colour;
    const preservedColourName = settings.colourName;
    settings = { ...DEFAULTS, colour: preservedColour, colourName: preservedColourName, strength: 0 };
    applySettings({ persist: true });
    announce("Reading changes removed. Saved numbered profiles were not deleted.");
  }

  function updateSetting(key, value) {
    settings[key] = value;
    settings = sanitise(settings);
    applySettings({ persist: true });
  }

  function loadProfiles() {
    const raw = readJson(PROFILE_KEY, {});
    return raw && typeof raw === "object" ? raw : {};
  }

  function bindEvents() {
    el.readingComfortToggle.addEventListener("click", () => {
      if (el.readingComfortPanel.classList.contains("hidden")) openPanel();
      else closePanel();
    });
    el.readingComfortClose.addEventListener("click", closePanel);

    document.addEventListener("pointerdown", (event) => {
      if (el.readingComfortPanel.classList.contains("hidden")) return;
      if (el.readingComfortPanel.contains(event.target)) return;
      if (el.readingComfortToggle.contains(event.target)) return;
      closePanel({ restoreFocus: false });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !el.readingComfortPanel.classList.contains("hidden")) closePanel();
      if (settings.rulerEnabled && !el.readingComfortPanel.contains(document.activeElement)) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveRulerBy(-1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          moveRulerBy(1);
        }
      }
    });

    el.readingColourPresets.addEventListener("click", (event) => {
      const button = event.target.closest("[data-colour]");
      if (!button) return;
      settings.colour = button.dataset.colour;
      settings.colourName = button.dataset.name;
      if (settings.strength === 0) settings.strength = 25;
      applySettings({ persist: true });
    });

    el.readingCustomColour.addEventListener("input", () => {
      settings.colour = el.readingCustomColour.value;
      settings.colourName = "Custom";
      if (settings.strength === 0) settings.strength = 25;
      applySettings({ persist: true });
    });

    el.readingFilterStrength.addEventListener("input", () => updateSetting("strength", el.readingFilterStrength.value));
    el.readingFont.addEventListener("change", () => updateSetting("font", el.readingFont.value));
    el.readingLetterSpacing.addEventListener("input", () => updateSetting("letterSpacing", el.readingLetterSpacing.value));
    el.readingBrightness.addEventListener("input", () => updateSetting("brightness", el.readingBrightness.value));
    el.readingContrast.addEventListener("input", () => updateSetting("contrast", el.readingContrast.value));
    el.readingDarkMode.addEventListener("change", () => updateSetting("darkMode", el.readingDarkMode.checked));
    el.readingReducedGlare.addEventListener("change", () => updateSetting("reducedGlare", el.readingReducedGlare.checked));
    el.readingRulerEnabled.addEventListener("change", () => updateSetting("rulerEnabled", el.readingRulerEnabled.checked));
    el.readingRulerLines.addEventListener("change", () => updateSetting("rulerLines", el.readingRulerLines.value));

    el.readingTextSmaller.addEventListener("click", () => updateSetting("textSize", settings.textSize - 5));
    el.readingTextLarger.addEventListener("click", () => updateSetting("textSize", settings.textSize + 5));
    el.readingLineTighter.addEventListener("click", () => updateSetting("lineSpacing", Math.round((settings.lineSpacing - 0.1) * 10) / 10));
    el.readingLineWider.addEventListener("click", () => updateSetting("lineSpacing", Math.round((settings.lineSpacing + 0.1) * 10) / 10));

    el.readingRulerUp.addEventListener("click", () => moveRulerBy(-1));
    el.readingRulerDown.addEventListener("click", () => moveRulerBy(1));

    el.readingRulerHandle.addEventListener("pointerdown", (event) => {
      dragActive = true;
      el.readingRulerHandle.setPointerCapture(event.pointerId);
      setRulerFromClientY(event.clientY);
    });
    el.readingRulerHandle.addEventListener("pointermove", (event) => {
      if (dragActive) setRulerFromClientY(event.clientY);
    });
    el.readingRulerHandle.addEventListener("pointerup", (event) => {
      dragActive = false;
      try { el.readingRulerHandle.releasePointerCapture(event.pointerId); } catch (_) {}
    });
    el.readingRulerHandle.addEventListener("pointercancel", () => { dragActive = false; });

    el.readingSaveSettings.addEventListener("click", () => {
      const saved = writeJson(STORAGE_KEY, settings);
      announce(saved ? "Your current settings were saved on this device." : "The browser could not save these settings.");
      closePanel();
    });

    el.readingResetSettings.addEventListener("click", removeAllReadingChanges);
    el.readingComfortRemove.addEventListener("click", removeAllReadingChanges);

    el.readingProfileSave.addEventListener("click", () => {
      const slot = el.readingProfileSlot.value;
      const profiles = loadProfiles();
      profiles[slot] = { ...settings, savedAt: new Date().toISOString() };
      const saved = writeJson(PROFILE_KEY, profiles);
      announce(saved ? `Profile ${slot} saved on this device.` : `Profile ${slot} could not be saved.`);
    });

    el.readingProfileLoad.addEventListener("click", () => {
      const slot = el.readingProfileSlot.value;
      const profiles = loadProfiles();
      if (!profiles[slot]) {
        announce(`Profile ${slot} is empty.`);
        return;
      }
      settings = sanitise(profiles[slot]);
      applySettings({ persist: true });
      announce(`Profile ${slot} loaded.`);
    });

    el.readingProfileDelete.addEventListener("click", () => {
      const slot = el.readingProfileSlot.value;
      const profiles = loadProfiles();
      if (!profiles[slot]) {
        announce(`Profile ${slot} is already empty.`);
        return;
      }
      delete profiles[slot];
      writeJson(PROFILE_KEY, profiles);
      announce(`Profile ${slot} deleted.`);
    });
  }

  function init() {
    if (!cacheElements()) return;
    settings = sanitise(readJson(STORAGE_KEY, DEFAULTS));
    bindEvents();
    applySettings();

    window.ReadingComfort = {
      suspendForOutput,
      resumeAfterOutput
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
