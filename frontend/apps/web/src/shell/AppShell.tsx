/**
 * الهيكل + شريط التابات.
 *
 * التابات مربوطة بالـ URL لا بحالة في الذاكرة: زر الرجوع في المتصفّح يعمل،
 * والرابط قابل للمشاركة، والمعلّمة تصل للتاب الصحيح مباشرة.
 * على الجوال يتحوّل الشريط إلى شريط سفلي — إبهام لا فأرة.
 */
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BookOpen, Gamepad2, LogOut, NotebookPen, Palette, Settings, User as UserIcon } from "lucide-react";

import { AuroraBackground } from "@/components/AuroraBackground";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { ar } from "@/lib/i18n";
import type { Role } from "@/lib/types";
import { withStudioToken } from "@/lib/studioUrl";

const STUDIO_URL = import.meta.env.VITE_STUDIO_URL ?? "/studio/";

interface TabDefinition {
  to: string;
  label: string;
  icon: JSX.Element;
  roles?: Role[];
  external?: boolean;
}

const TABS: TabDefinition[] = [
  { to: "/stories", label: ar.nav.stories, icon: <BookOpen size={20} /> },
  { to: "/games", label: ar.nav.games, icon: <Gamepad2 size={20} /> },
  { to: "/classroom", label: ar.nav.classroom, icon: <NotebookPen size={20} /> },
  { to: STUDIO_URL, label: ar.nav.studio, icon: <Palette size={20} />, roles: ["TEACHER", "ADMIN"], external: true },
  { to: "/admin", label: ar.nav.admin, icon: <Settings size={20} />, roles: ["ADMIN"] },
];

export function AppShell(): JSX.Element {
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();
  const visible = TABS.filter((tab) => !tab.roles || hasRole(...tab.roles));

  const tabClass = ({ isActive }: { isActive: boolean }): string =>
    `flex items-center gap-2 px-4 py-3 rounded-xl text-h3 min-h-touch transition-all duration-200 ease-spring ${
      isActive ? "bg-brand text-white shadow-card" : "text-slate-600 hover:bg-primary-light active:scale-95"
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <AuroraBackground />
      <header data-chrome className="bg-white/80 backdrop-blur border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-h1 text-primary-dark whitespace-nowrap">
            <Logo size={30} className="rounded-lg shrink-0" />
            {ar.app.name}
          </span>

          {/* سطح المكتب */}
          <nav className="hidden md:flex items-center gap-1">
            {visible.map((tab) =>
              tab.external ? (
                <a key={tab.to} href={withStudioToken(tab.to)} className="flex items-center gap-2 px-4 py-3 rounded-xl text-h3 min-h-touch text-slate-600 hover:bg-primary-light transition">
                  {tab.icon}{tab.label}
                </a>
              ) : (
                <NavLink key={tab.to} to={tab.to} className={tabClass}>{tab.icon}{tab.label}</NavLink>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/account"
              className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl text-caption text-slate-600
                hover:bg-primary-light transition-all duration-200 ease-spring active:scale-95"
            >
              <span className="grid place-items-center w-7 h-7 rounded-full bg-brand text-white">
                <UserIcon size={14} />
              </span>
              {user?.full_name}
            </Link>
            <button onClick={logout} aria-label={ar.nav.logout}
                    className="p-3 rounded-xl text-slate-500 hover:bg-slate-100 transition min-h-touch">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto pb-24 md:pb-0">
        <div key={location.pathname} className="animate-fade-in">
          <Outlet />
        </div>
      </main>

      {/* الجوال: شريط سفلي */}
      <nav data-chrome className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-100
                                   flex justify-around px-1 py-1 pb-[env(safe-area-inset-bottom)] z-40">
        {visible.map((tab) =>
          tab.external ? (
            <a key={tab.to} href={withStudioToken(tab.to)} className="flex flex-col items-center gap-0.5 px-3 py-2 min-h-touch text-slate-500 text-label">
              {tab.icon}{tab.label}
            </a>
          ) : (
            <NavLink key={tab.to} to={tab.to}
                     className={({ isActive }) =>
                       `flex flex-col items-center gap-0.5 px-3 py-2 min-h-touch text-label ${
                         isActive ? "text-primary" : "text-slate-500"
                       }`}>
              {tab.icon}{tab.label}
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );
}
