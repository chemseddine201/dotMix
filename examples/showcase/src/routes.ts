import type { RouteRecord } from "@dotmix/router";
import HomePage from "./pages/start/HomePage.tix";
import ProjectStructurePage from "./pages/start/ProjectStructurePage.tix";
import FirstComponentPage from "./pages/start/FirstComponentPage.tix";
import ConditionalsPage from "./pages/directives/ConditionalsPage.tix";
import SwitchPage from "./pages/directives/SwitchPage.tix";
import LoopsPage from "./pages/directives/LoopsPage.tix";
import AsyncPage from "./pages/directives/AsyncPage.tix";
import AuthenticationPage from "./pages/directives/AuthenticationPage.tix";
import AuthorizationPage from "./pages/directives/AuthorizationPage.tix";
import EnvironmentContextPage from "./pages/directives/EnvironmentContextPage.tix";
import FormsDirectivesPage from "./pages/directives/FormsDirectivesPage.tix";
import LayoutsPage from "./pages/directives/LayoutsPage.tix";
import CompositionPage from "./pages/directives/CompositionPage.tix";
import RenderControlPage from "./pages/directives/RenderControlPage.tix";
import AttributesPage from "./pages/directives/AttributesPage.tix";
import ServerRenderingPage from "./pages/directives/ServerRenderingPage.tix";
import DebugTextPage from "./pages/directives/DebugTextPage.tix";
import SignalsPage from "./pages/features/SignalsPage.tix";
import ComponentsPage from "./pages/features/ComponentsPage.tix";
import ScopedStylesPage from "./pages/features/ScopedStylesPage.tix";
import RouterPage from "./pages/features/RouterPage.tix";
import PermissionsPage from "./pages/features/PermissionsPage.tix";
import FormsPage from "./pages/features/FormsPage.tix";
import SyncPage from "./pages/features/SyncPage.tix";
import HelpersPage from "./pages/features/HelpersPage.tix";
import InteropPage from "./pages/features/InteropPage.tix";
import SsrPage from "./pages/features/SsrPage.tix";

import NotFoundPage from "./pages/start/NotFoundPage.tix";

export type SectionName = "Getting started" | "Directives" | "Features";

export interface PageMeta {
  title: string;
  section: SectionName;
  order: number;
  keywords?: readonly string[];
}

function page(path: string, component: unknown, meta: PageMeta): RouteRecord {
  return { path, component, meta: { ...meta } };
}

export const routes: RouteRecord[] = [
  page("/", HomePage, { title: "Home", section: "Getting started", order: 1 }),
  page("/start/project-structure", ProjectStructurePage, { title: "Project structure", section: "Getting started", order: 2 }),
  page("/start/first-component", FirstComponentPage, { title: "Your first component", section: "Getting started", order: 3 }),
  page("/directives/conditionals", ConditionalsPage, { title: "Conditionals", section: "Directives", order: 1 }),
  page("/directives/switch", SwitchPage, { title: "Switch", section: "Directives", order: 2 }),
  page("/directives/loops", LoopsPage, { title: "Loops", section: "Directives", order: 3 }),
  page("/directives/async", AsyncPage, { title: "Async", section: "Directives", order: 4 }),
  page("/directives/authentication", AuthenticationPage, { title: "Authentication", section: "Directives", order: 5 }),
  page("/directives/authorization", AuthorizationPage, { title: "Authorization", section: "Directives", order: 6 }),
  page("/directives/environment-context", EnvironmentContextPage, { title: "Environment and context", section: "Directives", order: 7 }),
  page("/directives/forms", FormsDirectivesPage, { title: "Forms", section: "Directives", order: 8 }),
  page("/directives/layouts", LayoutsPage, { title: "Layouts, sections, stacks and head", section: "Directives", order: 9 }),
  page("/directives/composition", CompositionPage, { title: "Composition", section: "Directives", order: 10 }),
  page("/directives/render-control", RenderControlPage, { title: "Render control", section: "Directives", order: 11 }),
  page("/directives/attributes", AttributesPage, { title: "Attributes, classes, styles and events", section: "Directives", order: 12 }),
  page("/directives/server-rendering", ServerRenderingPage, { title: "Server rendering", section: "Directives", order: 13 }),
  page("/directives/debug-text", DebugTextPage, { title: "Debug and text", section: "Directives", order: 14 }),
  page("/features/signals", SignalsPage, { title: "Signals and reactivity", section: "Features", order: 1 }),
  page("/features/components", ComponentsPage, { title: "Components and props", section: "Features", order: 2 }),
  page("/features/scoped-styles", ScopedStylesPage, { title: "Scoped styles", section: "Features", order: 3 }),
  page("/features/router", RouterPage, { title: "Router", section: "Features", order: 4 }),
  page("/features/permissions", PermissionsPage, { title: "Permissions", section: "Features", order: 5 }),
  page("/features/forms", FormsPage, { title: "Forms", section: "Features", order: 6 }),
  page("/features/sync", SyncPage, { title: "Offline sync", section: "Features", order: 7 }),
  page("/features/helpers", HelpersPage, { title: "@dotmix/helpers", section: "Features", order: 8 }),
  page("/features/interop", InteropPage, { title: "Interop", section: "Features", order: 9 }),
  page("/features/ssr", SsrPage, { title: "SSR and streaming", section: "Features", order: 10 }),
  { path: "*", component: NotFoundPage }
];
