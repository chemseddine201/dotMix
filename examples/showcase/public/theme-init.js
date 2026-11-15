/* global document, localStorage */
(function () {
  try {
    var stored = localStorage.getItem("dotmix-showcase-theme");
    var root = document.documentElement;
    if (stored === "light" || stored === "dark") {
      root.setAttribute("data-theme", stored);
      root.setAttribute("data-theme-choice", stored);
    } else {
      root.removeAttribute("data-theme");
      root.setAttribute("data-theme-choice", "system");
    }
  } catch (error) {
    void error;
  }
})();

