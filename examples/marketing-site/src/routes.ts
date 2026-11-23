import type { RouteRecord } from "@dotmix/router";
import HomePage from "./pages/HomePage.tix";
import FeaturesPage from "./pages/FeaturesPage.tix";
import PricingPage from "./pages/PricingPage.tix";
import AboutPage from "./pages/AboutPage.tix";
import NotFoundPage from "./pages/NotFoundPage.tix";

export const routes: RouteRecord[] = [
  { path: "/", component: HomePage },
  { path: "/features", component: FeaturesPage },
  { path: "/pricing", component: PricingPage },
  { path: "/about", component: AboutPage },
  { path: "/404", component: NotFoundPage, meta: { i18n: false, noindex: true } }
];

