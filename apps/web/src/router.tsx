import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { Dashboard } from "./screens/Dashboard.js";
import { EvalAdmin } from "./screens/EvalAdmin.js";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/conversations/$conversationId", params: { conversationId: "conv_demo" } });
  },
});

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/conversations/$conversationId",
  component: Dashboard,
});

const evalAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/evals",
  component: EvalAdmin,
});

const routeTree = rootRoute.addChildren([indexRoute, conversationRoute, evalAdminRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
