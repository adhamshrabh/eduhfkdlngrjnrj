import { Suspense, lazy, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { Spinner } from "@/components/ui";
import { RequireAuth, RequireRole } from "@/features/auth/guards";
import { LoginPage } from "@/features/auth/LoginPage";
import { StoriesPage } from "@/features/stories/StoriesPage";
import { AppShell } from "@/shell/AppShell";

/**
 * ما يُحمَّل كسولاً ولماذا — قرار قياس لا ذوق:
 *
 *   PlayerPage  → يجرّ PixiJS + GSAP (626 كيلوبايت). لو حُمِّل مع الإقلاع
 *                 لدخل الحزمة الأولى ولو لم تفتح المعلّمة أي قصة.
 *   GamesPage   → يجرّ TensorFlow عبر ألعاب الكاميرا (1.8 ميغابايت).
 *   AdminPage   → لا تراه المعلّمة إطلاقاً.
 *
 * صفحتا الدخول والقصص تبقيان فورية — هما أول ما يُفتح، والانتظار فيهما
 * يُحسّ مباشرة.
 */
const PlayerPage = lazy(() => import("@/features/player/PlayerPage").then((m) => ({ default: m.PlayerPage })));
const GamesPage = lazy(() => import("@/features/games/GamesPage").then((m) => ({ default: m.GamesPage })));
const ClassroomPage = lazy(() =>
  import("@/features/classroom/ClassroomPage").then((m) => ({ default: m.ClassroomPage })),
);
const AdminPage = lazy(() => import("@/features/admin/AdminPage").then((m) => ({ default: m.AdminPage })));
const DevicesPage = lazy(() => import("@/features/devices/DevicesPage").then((m) => ({ default: m.DevicesPage })));
const AccountPage = lazy(() => import("@/features/account/AccountPage").then((m) => ({ default: m.AccountPage })));

function Loading(): JSX.Element {
  return (
    <div className="grid place-items-center py-24">
      <Spinner size={32} />
    </div>
  );
}

function deferred(node: ReactNode): JSX.Element {
  return <Suspense fallback={<Loading />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      // المشغّل خارج الهيكل عمداً: وضع العرض يحتاج الشاشة كاملة بلا أي إطار
      { path: "/stories/:slug/play", element: deferred(<PlayerPage />) },
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <Navigate to="/stories" replace /> },
          { path: "/stories", element: <StoriesPage /> },
          { path: "/games", element: deferred(<GamesPage />) },
          { path: "/classroom", element: deferred(<ClassroomPage />) },
          {
            element: <RequireRole roles={["TEACHER", "ADMIN"]} />,
            children: [{ path: "/devices", element: deferred(<DevicesPage />) }],
          },
          { path: "/account", element: deferred(<AccountPage />) },
          {
            element: <RequireRole roles={["ADMIN"]} />,
            children: [{ path: "/admin", element: deferred(<AdminPage />) }],
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/stories" replace /> },
]);
