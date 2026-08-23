/** حماية المسارات. تذكير: هذه راحة للمستخدمة — المنع الحقيقي في الخادم. */
import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

export function RequireAuth(): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="grid place-items-center h-screen">
        <Spinner size={32} />
      </div>
    );
  }
  if (status === "anonymous") return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function RequireRole({ roles, children }: { roles: Role[]; children?: ReactNode }): JSX.Element {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return <Navigate to="/stories" replace />;
  return <>{children ?? <Outlet />}</>;
}
