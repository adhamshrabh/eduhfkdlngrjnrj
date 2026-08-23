/** لوحة الأدمن داخل التطبيق — للمديرة التربوية، لا للمبرمج (تلك Django Admin). */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BarChart3, BookCheck, Plus, Users } from "lucide-react";

import { Badge, Button, Card, ErrorNote, Field, Pagination, SearchInput, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { ar } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { Paginated, Role, StorySummary, User } from "@/lib/types";

const PAGE_SIZE = 50; // يطابق REST_FRAMEWORK.PAGE_SIZE بإعدادات Django

interface GameStat {
  game_id: string;
  game_title: string;
  sessions: number;
  total_minutes: number;
  avg_items: number;
}

export function AdminPage(): JSX.Element {
  const { show: showToast } = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [userCount, setUserCount] = useState(0);
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [stats, setStats] = useState<GameStat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);

  const loadUsers = (): void => {
    const params = new URLSearchParams({ page: String(userPage) });
    if (userSearch.trim()) params.set("search", userSearch.trim());
    api
      .get<Paginated<User>>(`/api/auth/users/?${params.toString()}`)
      .then((p) => { setUsers(p.results); setUserCount(p.count); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : ar.common.error));
  };

  const load = (): void => {
    loadUsers();
    api.get<Paginated<StorySummary>>("/api/stories/").then((p) => setStories(p.results)).catch(() => setStories([]));
    api.get<GameStat[]>("/api/games/sessions/stats/").then(setStats).catch(() => setStats([]));
  };

  // يُحمَّل المستخدمات مرّة عند الإقلاع ضمن load()، ثم مرّة أخرى فقط عند
  // تغيّر الصفحة أو البحث — بلا طلب مكرّر عند أول رسم.
  const isFirstRender = useRef(true);
  useEffect(load, []);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    loadUsers();
  }, [userPage, userSearch]);

  const togglePublish = async (story: StorySummary): Promise<void> => {
    try {
      await api.patch(`/api/stories/${story.slug}/`, { version: story.version, is_published: !story.is_published });
      showToast(story.is_published ? `أُلغي نشر «${story.title}».` : `نُشرت «${story.title}».`);
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : ar.common.error;
      setError(msg);
      showToast(msg, "error");
    }
  };

  const disableUser = async (user: User): Promise<void> => {
    try {
      await api.delete(`/api/auth/users/${user.id}/`);
      showToast(`تم تعطيل حساب ${user.full_name}.`);
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : ar.common.error;
      setError(msg);
      showToast(msg, "error");
    }
  };

  const resetPassword = async (user: User): Promise<void> => {
    const newPassword = window.prompt(`كلمة مرور جديدة لـ ${user.full_name} (٨ محارف على الأقل):`);
    if (!newPassword) return;
    try {
      await api.post(`/api/auth/users/${user.id}/reset-password/`, { new_password: newPassword });
      showToast(`تم تعيين كلمة مرور جديدة لـ ${user.full_name}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : ar.common.error;
      setError(msg);
      showToast(msg, "error");
    }
  };

  if (!users) return <div className="grid place-items-center py-24"><Spinner size={28} /></div>;

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-display">{ar.admin.title}</h1>
      {error ? <ErrorNote message={error} /> : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-label text-slate-500">{ar.admin.users}</p><p className="text-display">{userCount}</p></Card>
        <Card><p className="text-label text-slate-500">{ar.stories.title}</p><p className="text-display">{stories.length}</p></Card>
        <Card>
          <p className="text-label text-slate-500">{ar.games.title}</p>
          <p className="text-display">{stats.reduce((sum, s) => sum + s.sessions, 0)}</p>
        </Card>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h1 flex items-center gap-2"><Users size={20} /> {ar.admin.users}</h2>
          <div className="flex items-center gap-2">
            <SearchInput
              value={userSearch}
              onChange={(v) => { setUserPage(1); setUserSearch(v); }}
              placeholder="بحث بالاسم أو البريد…"
              className="w-56"
            />
            <Button size="sm" icon={<Plus size={16} />} onClick={() => setShowAddUser((v) => !v)}>
              {ar.admin.addUser}
            </Button>
          </div>
        </div>

        {showAddUser ? (
          <AddUserForm
            onCreated={(name) => {
              setShowAddUser(false);
              showToast(`تم إنشاء حساب ${name}.`);
              load();
            }}
            onError={(msg) => {
              setError(msg);
              showToast(msg, "error");
            }}
            className="mb-4"
          />
        ) : null}

        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-h3">{u.full_name}</p>
                <p className="text-caption text-slate-500">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={u.role === "ADMIN" ? "primary" : "neutral"}>{u.role_display}</Badge>
                {!u.is_active ? <Badge tone="warning">معطّل</Badge> : null}
                <Button size="sm" variant="ghost" onClick={() => void resetPassword(u)}>
                  {ar.admin.resetPassword}
                </Button>
                {u.is_active ? (
                  <Button size="sm" variant="danger" onClick={() => void disableUser(u)}>
                    {ar.admin.disable}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
        <Pagination page={userPage} pageSize={PAGE_SIZE} count={userCount} onChange={setUserPage} />
      </section>

      <section>
        <h2 className="text-h1 mb-4 flex items-center gap-2"><BookCheck size={20} /> {ar.admin.review}</h2>
        <div className="space-y-2">
          {stories.map((s) => (
            <Card key={s.slug} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-h3">{s.title}</p>
                <p className="text-caption text-slate-500">{s.owner_name} · {ar.stories.scenes(s.scene_count)}</p>
              </div>
              <Button size="sm" variant={s.is_published ? "ghost" : "primary"} onClick={() => void togglePublish(s)}>
                {s.is_published ? ar.admin.unpublish : ar.admin.publish}
              </Button>
            </Card>
          ))}
        </div>
      </section>

      {stats.length > 0 ? (
        <section>
          <h2 className="text-h1 mb-4 flex items-center gap-2"><BarChart3 size={20} /> {ar.admin.stats}</h2>
          <div className="space-y-2">
            {stats.map((s) => (
              <Card key={s.game_id} className="flex items-center justify-between gap-4 py-3">
                <p className="text-h3">{s.game_title || s.game_id}</p>
                <p className="text-caption text-slate-500">{s.sessions} جلسة · {s.total_minutes} دقيقة</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- AddUserForm

interface AddUserFormProps {
  onCreated: (fullName: string) => void;
  onError: (message: string) => void;
  className?: string;
}

/** نموذج إنشاء حساب معلّمة/مديرة — للمديرة فقط، لا تسجيل ذاتياً في صفحة الدخول. */
function AddUserForm({ onCreated, onError, className = "" }: AddUserFormProps): JSX.Element {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("TEACHER");
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/auth/users/", { full_name: fullName, email, password, role });
      onCreated(fullName);
    } catch (err) {
      onError(err instanceof Error ? err.message : ar.common.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={className}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
        <Field label="الاسم الكامل" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <Field
          label="البريد الإلكتروني"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="كلمة المرور"
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <label className="block">
          <span className="block mb-1.5 text-h3 text-slate-700">الدور</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full min-h-touch px-4 py-3 rounded-xl border border-slate-200 bg-white text-body"
          >
            <option value="TEACHER">معلّمة</option>
            <option value="ADMIN">مديرة</option>
          </select>
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" loading={saving}>
            {ar.admin.addUser}
          </Button>
        </div>
      </form>
    </Card>
  );
}
