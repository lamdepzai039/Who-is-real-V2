// Small DOM helpers used across client modules.

const UI = (() => {
  function $(id) {
    return document.getElementById(id);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('screen--active'));
    const target = $(id);
    if (target) target.classList.add('screen--active');
  }

  function setError(el, message) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = message;
    el.hidden = false;
  }

  function glitchText(el, times = 2) {
    if (!el) return;
    el.classList.remove('glitching');
    // Force reflow so the animation can re-trigger.
    void el.offsetWidth;
    el.classList.add('glitching');
  }

  return { $, showScreen, setError, glitchText };
})();
