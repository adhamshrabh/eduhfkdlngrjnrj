/** دفتر الصف — يحلّ محلّ تتبّع التقدّم الفردي الذي لا معنى له بلا جهاز لكل طفل. */
import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, NotebookPen, Plus } from "lucide-react";

import { Badge, Button, Card, EmptyState, ErrorNote, Field, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { ar } from "@/lib/i18n";
import type { Classroom, ClassroomLog, Paginated, StorySummary } from "@/lib/types";

export function ClassroomPage(): JSX.Element {
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [logs, setLogs] = useState<ClassroomLog[]>([]);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const active = classrooms?.[0] ?? null;

  const loadLogs = (classroomId: number): void => {
    api
      .get<Paginated<ClassroomLog>>(`/api/classrooms/logs/?classroom=${classroomId}`)
      .then((page) => setLogs(page.results))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : ar.common.error));
  };

  useEffect(() => {
    api.get<Classroom[]>("/api/classrooms/").then(setClassrooms).catch(() => setClassrooms([]));
    api.get<Paginated<StorySummary>>("/api/stories/").then((p) => setStories(p.results)).catch(() => setStories([]));
  }, []);

  useEffect(() => {
    if (active) loadLogs(active.id);
  }, [active?.id]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!active) return;
    const form = new FormData(event.currentTarget);
    const storyValue = String(form.get("story") ?? "");
    try {
      await api.post("/api/classrooms/logs/", {
        classroom: active.id,
        activity_type: storyValue ? "STORY" : "NOTE",
        story: storyValue ? Number(storyValue) : null,
        happened_on: String(form.get("happened_on")),
        duration_minutes: Number(form.get("duration_minutes") || 0),
        notes: String(form.get("notes") ?? ""),
      });
      setAdding(false);
      loadLogs(active.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.common.error);
    }
  };

  if (!classrooms) return <div className="grid place-items-center py-24"><Spinner size={28} /></div>;
  if (!active) return <EmptyState icon={<NotebookPen size={48} />} title={ar.classroom.noClassroom} />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-display">{active.name}</h1>
          <p className="text-body text-slate-500">
            {active.age_group} · {active.children_count} طفل
          </p>
        </div>
        <Button icon={<Plus size={18} />} onClick={() => setAdding((v) => !v)}>
          {ar.classroom.addLog}
        </Button>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {adding ? (
        <Card>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label={ar.classroom.date} name="happened_on" type="date" required
                   defaultValue={new Date().toISOString().slice(0, 10)} />
            <Field label={ar.classroom.duration} name="duration_minutes" type="number" min={0} defaultValue={15} />
            <label className="block sm:col-span-2">
              <span className="block mb-1.5 text-h3 text-slate-700">{ar.stories.title}</span>
              <select name="story" className="w-full min-h-touch px-4 py-3 rounded-xl border border-slate-200 bg-white text-body">
                <option value="">— {ar.classroom.notes} فقط —</option>
                {stories.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="block mb-1.5 text-h3 text-slate-700">{ar.classroom.notes}</span>
              <textarea name="notes" rows={3}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-body" />
            </label>
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit">{ar.classroom.save}</Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>{ar.common.cancel}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <section>
        <h2 className="text-h1 mb-4">{ar.classroom.logbook}</h2>
        {logs.length === 0 ? (
          <EmptyState icon={<CalendarDays size={40} />} title={ar.classroom.empty} />
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <Card key={log.id} className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone="primary">{log.activity_display}</Badge>
                    {log.story_title ? <span className="text-h3">{log.story_title}</span> : null}
                  </div>
                  {log.notes ? <p className="text-body text-slate-600">{log.notes}</p> : null}
                </div>
                <div className="text-caption text-slate-400 whitespace-nowrap">
                  {log.happened_on} · {log.duration_minutes} {ar.classroom.minutes}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
