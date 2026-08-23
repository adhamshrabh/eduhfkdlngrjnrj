/** حسابي — الصفحة الوحيدة التي تتيح للمعلّمة/المديرة تغيير كلمة مرورها بنفسها،
 *  بدل الاضطرار للمديرة في كل مرة (كانت الواجهة الوحيدة قبل هذه الصفحة). */
import { useState, type FormEvent } from "react";
import { KeyRound, User as UserIcon } from "lucide-react";

import { Badge, Button, Card, ErrorNote, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ar } from "@/lib/i18n";
import { useToast } from "@/lib/toast";

export function AccountPage(): JSX.Element {
  const { user } = useAuth();
  const { show: showToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return <></>;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError(ar.account.mismatch);
      return;
    }

    setSaving(true);
    try {
      await api.post("/api/auth/change-password/", {
        old_password: currentPassword,
        new_password: newPassword,
      });
      showToast(ar.account.changed);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const message =
        err instanceof ApiError && err.fields?.old_password
          ? String(err.fields.old_password)
          : err instanceof Error
            ? err.message
            : ar.common.error;
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <h1 className="text-display animate-slide-up">{ar.account.title}</h1>

      <Card className="flex items-center gap-4">
        <div className="grid place-items-center w-14 h-14 rounded-2xl bg-brand text-white shrink-0">
          <UserIcon size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-h2 truncate">{user.full_name}</p>
          <p className="text-caption text-slate-500 truncate">{user.email}</p>
        </div>
        <Badge tone={user.role === "ADMIN" ? "primary" : "neutral"}>{user.role_display}</Badge>
      </Card>

      <Card>
        <h2 className="text-h1 mb-4 flex items-center gap-2">
          <KeyRound size={20} /> {ar.account.changePassword}
        </h2>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field
            label={ar.account.currentPassword}
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Field
            label={ar.account.newPassword}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Field
            label={ar.account.confirmPassword}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {error ? <ErrorNote message={error} /> : null}
          <Button type="submit" loading={saving}>
            {ar.account.changePassword}
          </Button>
        </form>
      </Card>
    </div>
  );
}
