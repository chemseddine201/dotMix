/**
 * Gate 24 Test Suite — Cross-File Component Intelligence & External CSS Completions (@mix/language-server — D-127)
 *
 * Verifies:
 * 1. Multi-file Go-To-Definition: jumping from <MetricCard /> template tags and import statements to target files
 * 2. Nested block scope completions: {item} and {idx} suggested inside {#each}, {res} inside {#await}{:then}
 * 3. External CSS class completions: classes from linked <style src="./theme.css" /> and import "./cards.css"
 * 4. Workspace document cache: setWorkspaceFiles, setWorkspaceFile, and removeWorkspaceFile lifecycle
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MixLanguageService,
  offsetToPosition,
  CompletionItemKind,
} from "../../packages/language-server/dist/index.js";

describe("Gate 24: Cross-File Component Intelligence & External CSS Completions (D-127)", () => {
  const service = new MixLanguageService();

  test("1. Cross-file Go-To-Definition jumps from component tag and import statement to source file", () => {
    const dashboardSource = `
<script>
  import MetricCard from "./MetricCard.tix";
  import UserAvatar from "../shared/UserAvatar.mix";
  const count = signal(0);
</script>

<div class="dashboard">
  <MetricCard title="Revenue" value={count} />
  <UserAvatar userId="usr_123" />
</div>
`;
    const dashboardUri = "file:///workspace/src/views/Dashboard.mix";

    // 1a. Jump from <MetricCard in template
    const cardOffset = dashboardSource.indexOf("<MetricCard");
    const cardPos = offsetToPosition(dashboardSource, cardOffset + 3); // on 'MetricCard'
    const cardDef = service.doDefinition(dashboardUri, dashboardSource, cardPos);

    assert.ok(cardDef, "Definition must be resolved for <MetricCard /> component call");
    assert.strictEqual(cardDef.uri, "file:///workspace/src/views/MetricCard.tix");
    assert.strictEqual(cardDef.range.start.line, 0);

    // 1b. Jump from <UserAvatar in template (relative parent path ../)
    const avatarOffset = dashboardSource.indexOf("<UserAvatar");
    const avatarPos = offsetToPosition(dashboardSource, avatarOffset + 3);
    const avatarDef = service.doDefinition(dashboardUri, dashboardSource, avatarPos);

    assert.ok(avatarDef, "Definition must be resolved for <UserAvatar /> component call");
    assert.strictEqual(avatarDef.uri, "file:///workspace/src/shared/UserAvatar.mix");

    // 1c. Jump from import statement MetricCard identifier
    const importCardOffset = dashboardSource.indexOf("MetricCard from");
    const importCardPos = offsetToPosition(dashboardSource, importCardOffset + 2);
    const importCardDef = service.doDefinition(dashboardUri, dashboardSource, importCardPos);

    assert.ok(importCardDef, "Definition must be resolved from import clause");
    assert.strictEqual(importCardDef.uri, "file:///workspace/src/views/MetricCard.tix");

    // 1d. Jump to local variable (count)
    const countOffset = dashboardSource.indexOf("value={count}");
    const countPos = offsetToPosition(dashboardSource, countOffset + 8);
    const countDef = service.doDefinition(dashboardUri, dashboardSource, countPos);

    assert.ok(countDef, "Definition must be resolved for local signal");
    assert.strictEqual(countDef.uri, dashboardUri);
    assert.ok(countDef.range.start.line > 0);
  });

  test("2. Nested block completions suggest {#each} loop items and {#await} then/catch identifiers", () => {
    const source = `
<script>
  const users = signal([{ id: "1", name: "Alice" }]);
  const profilePromise = fetchProfile();
</script>

<div>
  {#each users as user, idx (user.id)}
    <p>{user.name}</p>
  {/each}

  {#await profilePromise}
    <span>Loading...</span>
  {:then profile}
    <h2>{profile.title}</h2>
  {:catch error}
    <p class="error">{error.message}</p>
  {/await}
</div>
`;
    const uri = "file:///workspace/src/NestedScopes.mix";

    // 2a. Position inside {#each} body
    const eachInnerOffset = source.indexOf("<p>{user.name}</p>") + 3;
    const eachPos = offsetToPosition(source, eachInnerOffset);
    const eachItems = service.doComplete(uri, source, eachPos);

    const userItem = eachItems.find((i) => i.label === "user");
    assert.ok(userItem, "Expected 'user' loop identifier in {#each} scope");
    assert.strictEqual(userItem.kind, CompletionItemKind.Variable);
    assert.ok(userItem.detail?.includes("loop item"));

    const idxItem = eachItems.find((i) => i.label === "idx");
    assert.ok(idxItem, "Expected 'idx' loop index in {#each} scope");
    assert.strictEqual(idxItem.kind, CompletionItemKind.Variable);
    assert.ok(idxItem.detail?.includes("loop index"));

    // 2b. Position outside {#each} body (should not suggest loop variables)
    const rootPos = offsetToPosition(source, source.indexOf("<div>") + 5);
    const rootItems = service.doComplete(uri, source, rootPos);
    assert.strictEqual(rootItems.some((i) => i.label === "user"), false);
    assert.strictEqual(rootItems.some((i) => i.label === "idx"), false);

    // 2c. Position inside {:then profile} branch
    const thenOffset = source.indexOf("<h2>{profile.title}</h2>") + 4;
    const thenPos = offsetToPosition(source, thenOffset);
    const thenItems = service.doComplete(uri, source, thenPos);

    const profileItem = thenItems.find((i) => i.label === "profile");
    assert.ok(profileItem, "Expected 'profile' resolved identifier in {:then} branch");
    assert.strictEqual(profileItem.kind, CompletionItemKind.Variable);
    assert.ok(profileItem.detail?.includes("resolved data"));

    // 2d. Position inside {:catch error} branch
    const catchOffset = source.indexOf('<p class="error">{error.message}</p>') + 3;
    const catchPos = offsetToPosition(source, catchOffset);
    const catchItems = service.doComplete(uri, source, catchPos);

    const errorItem = catchItems.find((i) => i.label === "error");
    assert.ok(errorItem, "Expected 'error' rejected identifier in {:catch} branch");
    assert.strictEqual(errorItem.kind, CompletionItemKind.Variable);
    assert.ok(errorItem.detail?.includes("error"));
  });

  test("3. External CSS completions suggest classes from linked and imported stylesheets", () => {
    const cssContent = `
.metric-card {
  padding: 1.5rem;
  border-radius: 8px;
}
.metric-title {
  font-size: 1.1rem;
}
.metric-value.highlighted {
  font-weight: bold;
}
.trend-positive {
  color: #10b981;
}
`;
    const cssUri = "file:///workspace/src/styles/metrics.css";
    service.setWorkspaceFile(cssUri, cssContent);

    const componentSource = `
<script>
  import "./styles/metrics.css";
</script>

<style src="./styles/metrics.css" />

<div class="metric-card">
  <span class=""></span>
</div>
`;
    const componentUri = "file:///workspace/src/MetricWidget.mix";

    const insideClassOffset = componentSource.indexOf('class=""') + 7;
    const classPos = offsetToPosition(componentSource, insideClassOffset);
    const completions = service.doComplete(componentUri, componentSource, classPos);

    const labels = completions.map((c) => c.label);
    assert.ok(labels.includes("metric-card"), `Expected 'metric-card' in completions: ${labels.join(", ")}`);
    assert.ok(labels.includes("metric-title"), `Expected 'metric-title' in completions: ${labels.join(", ")}`);
    assert.ok(labels.includes("metric-value"), `Expected 'metric-value' in completions: ${labels.join(", ")}`);
    assert.ok(labels.includes("highlighted"), `Expected 'highlighted' in completions: ${labels.join(", ")}`);
    assert.ok(labels.includes("trend-positive"), `Expected 'trend-positive' in completions: ${labels.join(", ")}`);

    const cardItem = completions.find((c) => c.label === "metric-card");
    assert.strictEqual(cardItem?.kind, CompletionItemKind.Property);
    assert.ok(cardItem?.detail?.includes("(css class) .metric-card"));
  });

  test("4. Workspace document index caching and eviction", () => {
    const docUri = "file:///workspace/src/temp/Temp.mix";
    service.setWorkspaceFile(docUri, "<script>const temp = signal(1);</script><div>{temp}</div>");

    assert.ok(service.getWorkspaceFiles().has(docUri));
    assert.strictEqual(service.getFileContent(docUri), "<script>const temp = signal(1);</script><div>{temp}</div>");

    service.removeWorkspaceFile(docUri);
    assert.strictEqual(service.getWorkspaceFiles().has(docUri), false);
    assert.strictEqual(service.getFileContent(docUri), null);
  });
});
