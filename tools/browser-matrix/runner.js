/* global window, document, fetch, performance, setTimeout, clearTimeout, URLSearchParams */
const runToken = new URLSearchParams(window.location.search).get('run') || '';

async function executeScenarioSuite() {
  const statusElement = document.getElementById('status');
  statusElement.textContent = 'Fetching scenario list...';

  const listResponse = await fetch('/scenarios-list');
  const scenarioFileNames = await listResponse.json();

  for (const scenarioFileName of scenarioFileNames) {
    statusElement.textContent = `Running ${scenarioFileName}...`;
    const scenarioStartTime = performance.now();
    let scenarioOutcome = { pass: false, detail: 'Unknown error' };

    try {
      const scenarioModule = await import(`/scenarios/${scenarioFileName}`);
      const scenarioDefinition = scenarioModule.default;

      const scenarioContext = {
        baseUrl: window.location.origin,
        document,
        window,
        createIframe: async (iframeUrl) => {
          const containerElement = document.getElementById('iframe-container');
          const iframeElement = document.createElement('iframe');
          iframeElement.src = iframeUrl || '/empty.html';
          containerElement.appendChild(iframeElement);
          await new Promise((resolveLoaded) => {
            iframeElement.onload = () => resolveLoaded();
          });
          return {
            iframeElement,
            contentWindow: iframeElement.contentWindow,
            contentDocument: iframeElement.contentDocument,
            reload: async () => {
              iframeElement.contentWindow.location.reload();
              await new Promise((resolveReloaded) => {
                iframeElement.onload = () => resolveReloaded();
              });
            },
            remove: () => {
              containerElement.removeChild(iframeElement);
            }
          };
        }
      };

      let timeoutTimerIdentifier = null;
      const timeoutPromise = new Promise((_, rejectTimeout) => {
        timeoutTimerIdentifier = setTimeout(() => {
          rejectTimeout(new Error('Scenario exceeded 30-second execution timeout'));
        }, 30000);
      });

      try {
        scenarioOutcome = await Promise.race([
          scenarioDefinition.run(scenarioContext),
          timeoutPromise
        ]);
      } finally {
        if (timeoutTimerIdentifier) {
          clearTimeout(timeoutTimerIdentifier);
        }
      }
    } catch (executionError) {
      scenarioOutcome = {
        pass: false,
        detail: String(executionError?.stack || executionError?.message || executionError)
      };
    }

    const durationMilliseconds = Math.round(performance.now() - scenarioStartTime);
    await fetch('/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: scenarioFileName.replace(/\.js$/, ''),
        pass: Boolean(scenarioOutcome.pass),
        detail: String(scenarioOutcome.detail || ''),
        durationMs: durationMilliseconds,
        runToken
      })
    });
  }

  statusElement.textContent = 'All scenarios completed.';
  await fetch(`/done?run=${encodeURIComponent(runToken)}`, { method: 'POST' });
}

executeScenarioSuite().catch((fatalError) => {
  fetch('/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'fatal-runner-failure',
      pass: false,
      detail: String(fatalError?.stack || fatalError?.message || fatalError),
      durationMs: 0,
      runToken
    })
  }).finally(() => {
    fetch(`/done?run=${encodeURIComponent(runToken)}`, { method: 'POST' });
  });
});
