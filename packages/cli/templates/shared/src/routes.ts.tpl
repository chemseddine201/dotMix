import type { RouteRecord } from "@mix/router";
import RootLayout from "./layouts/RootLayout.{{compExt}}";
import HomePage from "./pages/HomePage.{{compExt}}";
import TasksPage from "./pages/TasksPage.{{compExt}}";
import FormsPage from "./pages/FormsPage.{{compExt}}";
import UnauthorizedPage from "./pages/UnauthorizedPage.{{compExt}}";
import NotFoundPage from "./pages/NotFoundPage.{{compExt}}";

export const routes: RouteRecord[] = [
  {
    path: "/",
    component: RootLayout,
    children: [
      {
        index: true,
        component: HomePage
      },
      {
        path: "tasks",
        component: TasksPage
      },
      {
        path: "forms",
        component: FormsPage
      },
      {
        path: "admin",
        component: UnauthorizedPage,
        permissions: {
          action: "manage",
          subject: "AdminPanel",
          redirectTo: "/unauthorized"
        }
      },
      {
        path: "unauthorized",
        component: UnauthorizedPage
      },
      {
        path: "*",
        component: NotFoundPage
      }
    ]
  }
];

