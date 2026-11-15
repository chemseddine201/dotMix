/* global window, document, fetch, performance, setTimeout, URLSearchParams */
const queryParameters = new URLSearchParams(window.location.search);
const activeRunToken = queryParameters.get('run') || '';

function delayDuration(durationMilliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, durationMilliseconds);
  });
}

async function waitForCondition(
  evaluationPredicate,
  maximumWaitMilliseconds = 10000,
  conditionLabel = 'Condition'
) {
  const startTimestamp = performance.now();
  while (performance.now() - startTimestamp < maximumWaitMilliseconds) {
    try {
      const evaluationOutcome = evaluationPredicate();
      if (evaluationOutcome) {
        return evaluationOutcome;
      }
    } catch {
      // Continue polling until timeout
    }
    await delayDuration(50);
  }
  throw new Error(`${conditionLabel} timed out after ${maximumWaitMilliseconds} ms`);
}

function attachWindowErrorTracking(contentWindow, capturedErrors) {
  contentWindow.addEventListener('error', (eventItem) => {
    capturedErrors.push(
      `Window error: ${eventItem.message || eventItem.error || 'Unknown error'}`
    );
  });
  contentWindow.addEventListener('unhandledrejection', (rejectionEvent) => {
    capturedErrors.push(`Unhandled rejection: ${rejectionEvent.reason}`);
  });

  const originalConsoleError = contentWindow.console.error;
  contentWindow.console.error = function (...argumentList) {
    capturedErrors.push(`Console error: ${argumentList.map(String).join(' ')}`);
    originalConsoleError.apply(this, argumentList);
  };
}

function setInputValue(contentWindow, inputElement, nextValue) {
  inputElement.value = nextValue;
  inputElement.dispatchEvent(new contentWindow.Event('input', { bubbles: true }));
}

async function verifyShowcaseRouteInteractive(
  routePath,
  contentWindow,
  contentDocument,
  targetIframe,
  capturedErrors
) {
  const normalizedPath = routePath.replace(/^#/, '');
  if (normalizedPath === '/start/first-component') {
    const plusButton = Array.from(contentDocument.querySelectorAll('main button')).find(
      (button) => button.textContent.trim() === '+'
    );
    plusButton.click();
    await waitForCondition(
      () => contentDocument.querySelector('main .counter-value')?.textContent.trim() === '1',
      10000,
      'Counter increment on /start/first-component'
    );
    const previousWidth = targetIframe.style.width;
    targetIframe.style.width = '360px';
    await delayDuration(60);
    const mobileOverflow =
      contentDocument.documentElement.scrollWidth > contentWindow.innerWidth + 4;
    targetIframe.style.width = previousWidth;
    if (mobileOverflow) {
      throw new Error(`Mobile overflow at 360px on ${routePath}`);
    }
    return 1;
  }

  if (normalizedPath === '/directives/conditionals') {
    const paneTitles = Array.from(contentDocument.querySelectorAll('main h3')).map((heading) =>
      heading.textContent.trim()
    );
    if (!paneTitles.includes('Block form') || !paneTitles.includes('Component form')) {
      throw new Error('Missing FormTabs Block/Component panes on conditionals page');
    }
    const sellButton = Array.from(contentDocument.querySelectorAll('main button')).find(
      (button) => button.textContent.trim() === 'Sell out'
    );
    if (!sellButton) {
      throw new Error('Missing interactive buttons on conditionals page');
    }
    sellButton.click();
    await waitForCondition(
      () => contentDocument.querySelector('main .form-pane-live')?.textContent.includes('Sold out'),
      10000,
      'Conditionals Sold out state'
    );
    return 1;
  }

  if (normalizedPath === '/features/permissions') {
    await waitForCondition(
      () => contentDocument.querySelector('main .code-example-live')?.textContent.includes('Edit the article (own, not locked): allowed'),
      10000,
      'Permissions initial allowed state'
    );
    const lockButton = Array.from(contentDocument.querySelectorAll('main button')).find(
      (button) => button.textContent.trim() === 'Lock article'
    );
    lockButton.click();
    await waitForCondition(
      () => contentDocument.querySelector('main .code-example-live')?.textContent.includes('Edit the article (own, not locked): denied'),
      10000,
      'Permissions locked denied state'
    );
    return 1;
  }

  if (normalizedPath === '/features/helpers') {
    const fetchButton = await waitForCondition(
      () =>
        Array.from(contentDocument.querySelectorAll('main button')).find((button) =>
          button.textContent.includes('sample.json')
        ),
      10000,
      'Helpers sample.json button'
    );
    fetchButton.click();
    let helpersSnapshot = '';
    try {
      await waitForCondition(() => {
        const liveText = contentDocument.querySelector('main .code-example-live')?.textContent || '';
        helpersSnapshot = `baseURI=${contentDocument.baseURI} href=${contentWindow.location.href} live=${liveText.slice(0, 220)}`;
        return (
          liveText.includes('dotMix') &&
          liveText.includes('Offline collections') &&
          !liveText.includes('Not loaded yet')
        );
      }, 10000, 'Helpers sample.json fetch');
    } catch (helpersError) {
      throw new Error(`${helpersError.message} [${helpersSnapshot}]`);
    }
    return 1;
  }

  if (normalizedPath === '/features/sync') {
    const waitForSyncSettled = async (stepLabel) => {
      await waitForCondition(() => {
        const badges = contentDocument.querySelectorAll('main .task-demo .badge');
        return badges.length >= 3 && badges[2].textContent.trim() === '0';
      }, 10000, stepLabel);
    };

    await waitForCondition(() => {
      const rows = contentDocument.querySelectorAll('main .task-row');
      const badges = contentDocument.querySelectorAll('main .task-demo .badge');
      return rows.length >= 3 && badges.length >= 3 && badges[2].textContent.trim() === '0';
    }, 10000, 'Sync initial ready');

    const draftInput = contentDocument.querySelector('main input[placeholder="New task"]');
    const addButton = Array.from(contentDocument.querySelectorAll('main button')).find(
      (button) => button.textContent.trim() === 'Add'
    );
    setInputValue(contentWindow, draftInput, 'Persist task e2e');
    addButton.click();
    await waitForCondition(
      () => contentDocument.querySelector('main .task-list')?.textContent.includes('Persist task e2e'),
      10000,
      'Sync insert Persist task e2e'
    );
    await waitForSyncSettled('Sync commit after Add');

    const addedRow = Array.from(contentDocument.querySelectorAll('main .task-row')).find((row) =>
      row.textContent.includes('Persist task e2e')
    );
    const editButton = Array.from(addedRow.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Edit'
    );
    editButton.click();
    const editInput = await waitForCondition(
      () => contentDocument.querySelector('main .task-row input[type="text"]'),
      10000,
      'Sync edit input appearance'
    );
    setInputValue(contentWindow, editInput, 'Edited task e2e');
    const saveButton = Array.from(contentDocument.querySelectorAll('main .task-row button')).find(
      (button) => button.textContent.trim() === 'Save'
    );
    saveButton.click();
    await waitForCondition(
      () => contentDocument.querySelector('main .task-list')?.textContent.includes('Edited task e2e'),
      10000,
      'Sync save Edited task e2e'
    );
    await waitForSyncSettled('Sync commit after Save');

    const editedRow = Array.from(contentDocument.querySelectorAll('main .task-row')).find((row) =>
      row.textContent.includes('Edited task e2e')
    );
    const upButton = Array.from(editedRow.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Up'
    );
    upButton.click();
    await waitForCondition(() => {
      const titles = Array.from(contentDocument.querySelectorAll('main .task-title')).map((span) =>
        span.textContent.trim()
      );
      return titles.indexOf('Edited task e2e') < titles.length - 1;
    }, 10000, 'Sync reorder Up');
    await waitForSyncSettled('Sync commit after Up');

    const firstRow = contentDocument.querySelector('main .task-row');
    const deletedTitle = firstRow.querySelector('.task-title')?.textContent.trim();
    const deleteButton = Array.from(firstRow.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Delete'
    );
    deleteButton.click();
    await waitForCondition(
      () => !contentDocument.querySelector('main .task-list')?.textContent.includes(deletedTitle),
      10000,
      'Sync delete first row'
    );
    await waitForSyncSettled('Sync commit after Delete');

    const titlesBeforeReload = Array.from(contentDocument.querySelectorAll('main .task-title')).map((span) =>
      span.textContent.trim()
    );

    if (Array.isArray(contentWindow.__e2e_errors)) {
      for (const injectedError of contentWindow.__e2e_errors) {
        capturedErrors.push(injectedError);
      }
      contentWindow.__e2e_errors.length = 0;
    }

    const reloadPromise = new Promise((resolveReload) => {
      targetIframe.onload = () => resolveReload();
    });
    contentWindow.location.reload();
    await reloadPromise;

    const reloadedWindow = targetIframe.contentWindow;
    const reloadedDocument = targetIframe.contentDocument;
    attachWindowErrorTracking(reloadedWindow, capturedErrors);

    let lastReloadSnapshot = '';
    try {
      await waitForCondition(() => {
        const heading = reloadedDocument.querySelector('main h1')?.textContent || '';
        const reloadedTitles = Array.from(reloadedDocument.querySelectorAll('main .task-title')).map((span) =>
          span.textContent.trim()
        );
        const badges = Array.from(reloadedDocument.querySelectorAll('main .task-demo .badge')).map((badge) =>
          badge.textContent.trim()
        );
        lastReloadSnapshot = `h1=${heading} badges=${JSON.stringify(badges)} before=${JSON.stringify(titlesBeforeReload)} after=${JSON.stringify(reloadedTitles)}`;
        return (
          heading.includes('Offline sync') &&
          reloadedTitles.includes('Edited task e2e') &&
          !reloadedTitles.includes(deletedTitle) &&
          JSON.stringify(reloadedTitles) === JSON.stringify(titlesBeforeReload)
        );
      }, 10000, 'Sync persistence after reload');
    } catch (reloadError) {
      throw new Error(`${reloadError.message} [${lastReloadSnapshot}]`);
    }
    const badgesText = Array.from(reloadedDocument.querySelectorAll('main .badge')).map((badge) =>
      badge.textContent.trim()
    );
    if (badgesText.length < 2) {
      throw new Error('SyncPage missing status/errorCode badges after reload');
    }
    return 5;
  }

  return 0;
}

async function executeShowcaseInteractions(
  contentWindow,
  contentDocument,
  targetIframe,
  capturedErrors
) {
  // Wait for the showcase shell and its generated sidebar navigation.
  const navigationLinks = await waitForCondition(() => {
    const links = Array.from(contentDocument.querySelectorAll('nav a'));
    return links.length > 0 ? links : null;
  }, 10000, 'Showcase sidebar links');
  const routePaths = navigationLinks.map((anchor) => anchor.getAttribute('href'));

  let completedInteractions = 0;
  for (const routePath of routePaths) {
    const activeWindow = targetIframe.contentWindow;
    const activeDocument = targetIframe.contentDocument;
    const targetLink = Array.from(activeDocument.querySelectorAll('nav a')).find(
      (anchor) => anchor.getAttribute('href') === routePath
    );
    targetLink.click();

    // Every route must activate its sidebar link, render a heading and load all example sources.
    await waitForCondition(() => {
      const activeLink = activeDocument.querySelector('nav a[aria-current="page"]');
      const heading = activeDocument.querySelector('main h1');
      if (
        !activeLink ||
        activeLink.getAttribute('href') !== routePath ||
        !activeLink.classList.contains('active') ||
        !heading ||
        heading.textContent.trim() === ''
      ) {
        return false;
      }
      const sourceBlocks = Array.from(activeDocument.querySelectorAll('main pre code'));
      return sourceBlocks.every(
        (block) => !block.textContent.startsWith('Loading source')
      );
    }, 10000, `Showcase route ${routePath}`);

    const sourceBlocks = Array.from(activeDocument.querySelectorAll('main pre code'));
    const failedSources = sourceBlocks.filter((block) => {
      const text = block.textContent;
      return (
        text.includes('could not be loaded') ||
        text.startsWith('Not found') ||
        text.trim().length < 10
      );
    });
    if (failedSources.length > 0) {
      throw new Error(
        `Route ${routePath} has ${failedSources.length} example source(s) that failed to load: ${failedSources[0].textContent.slice(0, 80)}`
      );
    }

    completedInteractions += 1;
    completedInteractions += await verifyShowcaseRouteInteractive(
      routePath,
      activeWindow,
      activeDocument,
      targetIframe,
      capturedErrors
    );
  }

  completedInteractions += await verifyShowcaseUiFeatures(
    targetIframe,
    routePaths,
    capturedErrors
  );
  return completedInteractions;
}

async function verifyShowcaseUiFeatures(targetIframe, routePaths, capturedErrors) {
  let uiChecks = 0;
  const previousWidth = targetIframe.style.width;
  const previousHeight = targetIframe.style.height;

  const getActiveWindow = () => targetIframe.contentWindow;
  const getActiveDocument = () => getActiveWindow().document;
  const normalizeRoute = (raw) => (raw && raw.startsWith('#') ? raw.slice(1) : raw || '/');
  const navigateHash = (routePath) => {
    const cleanPath = normalizeRoute(routePath);
    const w = getActiveWindow();
    w.location.hash = cleanPath === '/' ? '#/' : `#${cleanPath}`;
  };

  try {
    // 1. Desktop 1280x800: Home hero + live counter visible above the fold.
    targetIframe.style.width = '1280px';
    targetIframe.style.height = '800px';
    navigateHash('/');
    const heroHeading = await waitForCondition(() => {
      const doc = getActiveDocument();
      const h1 = doc.querySelector('main h1');
      return h1 && h1.textContent.includes('dotMix') ? h1 : null;
    }, 10000, 'Home hero heading');
    const heroRect = heroHeading.getBoundingClientRect();
    const counterEl = getActiveDocument().querySelector('main .counter-value');
    if (!counterEl) {
      throw new Error('Home counter demo is missing');
    }
    const counterRect = counterEl.getBoundingClientRect();
    if (heroRect.bottom > 800 || counterRect.bottom > 800) {
      throw new Error(
        `Home hero (${Math.round(heroRect.bottom)}px) or counter (${Math.round(counterRect.bottom)}px) fell below 800px fold`
      );
    }
    const pageTitle = getActiveDocument().title;
    if (!pageTitle.includes('dotMix')) {
      throw new Error(`Unexpected home document.title "${pageTitle}"`);
    }
    uiChecks += 1;

    // 2. CodeExample Reset button remounts demo state back to 0.
    const plusButton = Array.from(getActiveDocument().querySelectorAll('main .counter button')).find(
      (btn) => btn.textContent.trim() === '+'
    );
    const resetButton = getActiveDocument().querySelector('main .code-example-reset');
    if (!plusButton || !resetButton) {
      throw new Error('Home CounterDemo or CodeExample Reset button missing');
    }
    plusButton.click();
    await waitForCondition(
      () => getActiveDocument().querySelector('main .counter-value')?.textContent.trim() === '1',
      5000,
      'Counter increment before Reset'
    );
    resetButton.click();
    await waitForCondition(
      () => getActiveDocument().querySelector('main .counter-value')?.textContent.trim() === '0',
      5000,
      'CodeExample Reset remount'
    );
    uiChecks += 1;

    // 3. Copy button click feedback + no runtime/clipboard unhandled errors.
    const copyButton = getActiveDocument().querySelector('main .code-copy-button');
    if (!copyButton) {
      throw new Error('CodeBlock Copy button missing');
    }
    // A scripted click carries no user activation, so the browser's clipboard refuses it
    // (NotAllowedError; execCommand("copy") returns false). Record the written text instead.
    const copiedTexts = [];
    Object.defineProperty(getActiveDocument().defaultView.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (copiedText) => {
          copiedTexts.push(copiedText);
          return Promise.resolve();
        }
      }
    });
    copyButton.click();
    await waitForCondition(
      () => copyButton.textContent.trim() === 'Copied',
      3000,
      'CodeBlock Copy button feedback Copied'
    );
    if (copiedTexts.length !== 1 || typeof copiedTexts[0] !== 'string' || copiedTexts[0].trim() === '') {
      throw new Error(`CodeBlock Copy button must write its code once to the clipboard, got: ${JSON.stringify(copiedTexts)}`);
    }
    uiChecks += 1;

    // 4. Prev / Next page navigation footer + head title + NotFoundPage (*).
    const nextPager = await waitForCondition(
      () => getActiveDocument().querySelector('nav[aria-label="Page navigation"] a.pager-next'),
      5000,
      'Home Next pager link'
    );
    nextPager.click();
    await waitForCondition(
      () => getActiveWindow().location.hash === '#/start/project-structure',
      5000,
      'Next pager navigation to /start/project-structure'
    );
    const prevPager = await waitForCondition(
      () => getActiveDocument().querySelector('nav[aria-label="Page navigation"] a.pager-prev'),
      5000,
      'Previous pager link on /start/project-structure'
    );
    prevPager.click();
    await waitForCondition(
      () => getActiveWindow().location.hash === '#/' || getActiveWindow().location.hash === '',
      5000,
      'Previous pager return to /'
    );
    navigateHash('/non-existent-route-e2e');
    await waitForCondition(
      () => getActiveDocument().querySelector('main h1')?.textContent.includes('Page not found'),
      5000,
      'NotFoundPage fallback route'
    );
    if (getActiveDocument().querySelector('nav[aria-label="Page navigation"]')) {
      throw new Error('Pager navigation should not appear on NotFoundPage');
    }
    uiChecks += 1;

    // 5. FormTabs ARIA roles & arrow-key tab switch on /directives/conditionals + document.title.
    navigateHash('/directives/conditionals');
    const compTab = await waitForCondition(() => {
      const tabs = getActiveDocument().querySelectorAll('[role="tablist"] [role="tab"]');
      return tabs.length >= 2 ? tabs[1] : null;
    }, 5000, 'FormTabs ARIA tabs');
    await waitForCondition(
      () => getActiveDocument().title.includes('Conditionals · dotMix'),
      5000,
      'Route document.title update on /directives/conditionals'
    );
    const blockTab = getActiveDocument().querySelector('[role="tablist"] [role="tab"]');
    if (blockTab?.getAttribute('aria-selected') !== 'true') {
      throw new Error('Initial Block form tab aria-selected is not true');
    }
    blockTab.focus();
    blockTab.dispatchEvent(new (getActiveWindow().KeyboardEvent)('keydown', { key: 'ArrowRight', bubbles: true }));
    await waitForCondition(
      () => compTab.getAttribute('aria-selected') === 'true',
      5000,
      'FormTabs ArrowRight switch'
    );
    uiChecks += 1;

    // 6. Search modal via Ctrl+K, type query, Enter navigates cleanly.
    const activeWin = getActiveWindow();
    activeWin.dispatchEvent(new activeWin.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    const searchInput = await waitForCondition(
      () => getActiveDocument().querySelector('[role="dialog"] input.search-input'),
      5000,
      'SearchModal open via Ctrl+K'
    );
    setInputValue(activeWin, searchInput, 'Signals and reactivity');
    await delayDuration(50);
    searchInput.dispatchEvent(new activeWin.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitForCondition(
      () => getActiveWindow().location.hash === '#/features/signals',
      5000,
      'SearchModal Enter navigation'
    );
    await waitForCondition(
      () => !getActiveDocument().querySelector('[role="dialog"]'),
      5000,
      'SearchModal closed after Enter'
    );
    uiChecks += 1;

    // 7. Theme switch persists across reload (Dark -> reload -> System).
    const darkBtn = await waitForCondition(() => {
      const buttons = Array.from(getActiveDocument().querySelectorAll('[aria-label="Color theme"] button'));
      return buttons.find((b) => b.textContent.trim() === 'Dark') ?? null;
    }, 5000, 'Dark theme button');
    darkBtn.click();
    await waitForCondition(
      () => getActiveDocument().documentElement.getAttribute('data-theme') === 'dark',
      5000,
      'Dark theme applied'
    );
    // The old document already has data-theme="dark", so wait for the reloaded document itself;
    // otherwise later steps can run on the old page while the reload is still in flight.
    const documentBeforeReload = getActiveDocument();
    getActiveWindow().location.reload();
    await waitForCondition(() => {
      try {
        const w = targetIframe.contentWindow;
        return Boolean(
          w &&
            w.document &&
            w.document !== documentBeforeReload &&
            w.document.readyState === 'complete' &&
            w.document.documentElement.getAttribute('data-theme') === 'dark' &&
            w.document.querySelector('[aria-label="Color theme"]')
        );
      } catch {
        return false;
      }
    }, 10000, 'Dark theme persisted across reload');
    attachWindowErrorTracking(getActiveWindow(), capturedErrors);
    const systemBtn = Array.from(getActiveDocument().querySelectorAll('[aria-label="Color theme"] button')).find(
      (b) => b.textContent.trim() === 'System'
    );
    systemBtn?.click();
    uiChecks += 1;

    // 8. Mobile 360px drawer open/navigate/close AND 0 horizontal overflow on every route.
    targetIframe.style.width = '360px';
    targetIframe.style.height = '740px';
    const menuBtn = await waitForCondition(
      () => getActiveDocument().querySelector('button.mobile-menu-button'),
      5000,
      'Mobile menu button at 360px'
    );
    menuBtn.click();
    await waitForCondition(() => {
      const sidebar = getActiveDocument().getElementById('site-sidebar');
      return sidebar && sidebar.classList.contains('layout-sidebar-open');
    }, 5000, 'Mobile drawer open at 360px');

    const drawerNavLink = Array.from(getActiveDocument().querySelectorAll('#site-sidebar nav a')).find(
      (a) => normalizeRoute(a.getAttribute('href')) === '/features/router'
    );
    if (!drawerNavLink) {
      throw new Error('Mobile drawer link to /features/router missing');
    }
    drawerNavLink.click();
    await waitForCondition(() => {
      const sidebar = getActiveDocument().getElementById('site-sidebar');
      return (
        getActiveWindow().location.hash === '#/features/router' &&
        sidebar &&
        !sidebar.classList.contains('layout-sidebar-open')
      );
    }, 5000, 'Mobile drawer close after navigation');

    for (const rawRoutePath of routePaths) {
      const routePath = normalizeRoute(rawRoutePath);
      navigateHash(routePath);
      try {
        await waitForCondition(() => {
          const doc = getActiveDocument();
          const activeLink = doc.querySelector('nav a[aria-current="page"]');
          const href = activeLink?.getAttribute('href');
          const normalizedHref = normalizeRoute(href);
          const h1 = doc.querySelector('main h1');
          return Boolean(activeLink && normalizedHref === routePath && h1 && h1.textContent.trim().length > 0);
        }, 5000, `360px route ${routePath}`);
      } catch (error) {
        const doc = getActiveDocument();
        const activeHrefs = Array.from(doc.querySelectorAll('nav a[aria-current="page"]')).map((anchor) => anchor.getAttribute('href'));
        const heading = doc.querySelector('main h1');
        throw new Error(
          `${error.message} (hash=${getActiveWindow().location.hash}, active links=${JSON.stringify(activeHrefs)}, main h1=${JSON.stringify(heading ? heading.textContent.trim() : null)})`
        );
      }
      await delayDuration(20);
      const doc = getActiveDocument();
      const win = getActiveWindow();
      const scrollWidth = doc.documentElement.scrollWidth;
      const clientWidth = win.innerWidth;
      if (scrollWidth > clientWidth) {
        throw new Error(
          `Horizontal overflow at 360px on showcase route ${routePath}: scrollWidth=${scrollWidth} innerWidth=${clientWidth}`
        );
      }
      uiChecks += 1;
    }
  } finally {
    targetIframe.style.width = previousWidth;
    targetIframe.style.height = previousHeight;
  }

  return uiChecks;
}

async function executeScaffoldInteractions(contentWindow, contentDocument) {
  // Wait for Scaffold RootLayout mount
  await waitForCondition(() => {
    const rootContainer = contentDocument.getElementById('root');
    return (
      rootContainer &&
      rootContainer.innerHTML.includes('Mix Framework App') &&
      rootContainer.innerHTML.includes('Compiler-Native Web Application')
    );
  });

  const rootContainer = contentDocument.getElementById('root');

  // Interaction 1: Navigate to /tasks via NavLink
  const linkToTasks = await waitForCondition(() => {
    const anchorElements = Array.from(rootContainer.querySelectorAll('a'));
    return anchorElements.find((anchor) => anchor.getAttribute('href') === '/tasks');
  });
  linkToTasks.click();

  await waitForCondition(() => {
    return rootContainer.innerHTML.includes('Offline-First CRDT Tasks');
  });

  // Interaction 2: Navigate to /forms via NavLink
  const linkToForms = await waitForCondition(() => {
    const anchorElements = Array.from(rootContainer.querySelectorAll('a'));
    return anchorElements.find((anchor) => anchor.getAttribute('href') === '/forms');
  });
  linkToForms.click();

  await waitForCondition(() => {
    return rootContainer.innerHTML.includes('Reactive Form Validation');
  });

  // Interaction 3: Navigate back to / via NavLink
  const linkToHome = await waitForCondition(() => {
    const anchorElements = Array.from(rootContainer.querySelectorAll('a'));
    return anchorElements.find((anchor) => anchor.getAttribute('href') === '/');
  });
  linkToHome.click();

  await waitForCondition(() => {
    return rootContainer.innerHTML.includes('Compiler-Native Web Application');
  });

  return 3;
}

async function runEndToEndScenario(scenarioItem, targetIframe) {
  const scenarioStartTime = performance.now();
  const capturedErrors = [];

  const iframeLoadPromise = new Promise((resolveLoaded) => {
    targetIframe.onload = () => resolveLoaded();
  });

  targetIframe.src = scenarioItem.pageUrl;
  await iframeLoadPromise;

  const contentWindow = targetIframe.contentWindow;
  const contentDocument = targetIframe.contentDocument;

  // Track window errors and rejections directly
  attachWindowErrorTracking(contentWindow, capturedErrors);

  let completedInteractionCount = 0;
  let testOutcomeDetail = '';

  try {
    if (scenarioItem.applicationType === 'showcase') {
      completedInteractionCount = await executeShowcaseInteractions(
        contentWindow,
        contentDocument,
        targetIframe,
        capturedErrors
      );
    } else {
      completedInteractionCount = await executeScaffoldInteractions(
        contentWindow,
        contentDocument
      );
    }

    // Also collect any errors captured by the early injected script if present
    const latestWindow = targetIframe.contentWindow;
    if (latestWindow && Array.isArray(latestWindow.__e2e_errors)) {
      for (const injectedError of latestWindow.__e2e_errors) {
        capturedErrors.push(injectedError);
      }
    }

    if (capturedErrors.length === 0) {
      testOutcomeDetail = `Clean load with 0 console errors, 0 unhandled rejections; ${completedInteractionCount} interactions succeeded.`;
    } else {
      testOutcomeDetail = `Errors detected: ${capturedErrors.join(' | ')}`;
    }
  } catch (executionException) {
    capturedErrors.push(`Execution error: ${executionException?.message || executionException}`);
    testOutcomeDetail = `Failed during interaction: ${executionException?.message || executionException}`;
  }

  const executionDurationMilliseconds = Math.round(performance.now() - scenarioStartTime);
  const isPassOutcome = capturedErrors.length === 0 && completedInteractionCount >= 2;

  await fetch('/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: scenarioItem.identifier,
      title: scenarioItem.title,
      pass: isPassOutcome,
      interactionCount: completedInteractionCount,
      errorCount: capturedErrors.length,
      detail: testOutcomeDetail,
      durationMs: executionDurationMilliseconds,
      runToken: activeRunToken
    })
  });
}

async function executeEndToEndSuite() {
  const statusElement = document.getElementById('status');
  const targetIframe = document.getElementById('test-frame');

  statusElement.textContent = 'Retrieving scenario list...';
  const listResponse = await fetch('/e2e-scenarios-list');
  const scenarioDefinitions = await listResponse.json();

  for (const scenarioDefinition of scenarioDefinitions) {
    statusElement.textContent = `Testing: ${scenarioDefinition.title}...`;
    await runEndToEndScenario(scenarioDefinition, targetIframe);
  }

  statusElement.textContent = 'All scenarios completed.';
  await fetch(`/done?run=${encodeURIComponent(activeRunToken)}`, { method: 'POST' });
}

executeEndToEndSuite().catch(async (suiteFatalError) => {
  const statusElement = document.getElementById('status');
  statusElement.textContent = `Fatal suite failure: ${suiteFatalError?.message || suiteFatalError}`;
  await fetch('/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'fatal-suite-error',
      title: 'Fatal Suite Failure',
      pass: false,
      detail: String(suiteFatalError?.stack || suiteFatalError),
      durationMs: 0,
      runToken: activeRunToken
    })
  });
  await fetch(`/done?run=${encodeURIComponent(activeRunToken)}`, { method: 'POST' });
});
