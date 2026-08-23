import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Pencil, Play } from "lucide-react";

import { Badge, Button, Card, EmptyState, ErrorNote, Pagination, SearchInput } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ar } from "@/lib/i18n";
import { withStudioToken } from "@/lib/studioUrl";
import type { Paginated, StorySummary } from "@/lib/types";

const STUDIO_URL = import.meta.env.VITE_STUDIO_URL ?? "/studio/";
const PAGE_SIZE = 50; // يطابق REST_FRAMEWORK.PAGE_SIZE بإعدادات Django

export function StoriesPage(): JSX.Element {
  const { hasRole } = useAuth();
  const [stories, setStories] = useState<StorySummary[] | null>(null);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    setError(null);
    const params = new URLSearchParams({ page: String(page) });
    if (search.trim()) params.set("search", search.trim());
    api
      .get<Paginated<StorySummary>>(`/api/stories/?${params.toString()}`)
      .then((res) => {
        setStories(res.results);
        setCount(res.count);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : ar.common.error));
  };

  useEffect(load, [page, search]);

  if (error) return <div className="p-6"><ErrorNote message={error} onRetry={load} /></div>;
  if (!stories) {
    return (
      <div className="p-6">
        <div className="h-8 w-40 skeleton mb-6" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white/75 backdrop-blur-xl border border-white/60 rounded-2xl shadow-card p-5 space-y-4">
              <div className="h-5 w-2/3 skeleton" />
              <div className="h-3 w-1/3 skeleton" />
              <div className="h-12 w-full skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const noStoriesAtAll = stories.length === 0 && !search.trim() && page === 1;
  if (noStoriesAtAll) {
    return (
      <EmptyState
        icon={<BookOpen size={48} />}
        title={ar.stories.empty}
        hint={ar.stories.emptyHint}
        action={hasRole("TEACHER", "ADMIN") ? <a href={withStudioToken(STUDIO_URL)}><Button>{ar.nav.studio}</Button></a> : undefined}
      />
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-display animate-slide-up">{ar.stories.title}</h1>
        <SearchInput
          value={search}
          onChange={(v) => { setPage(1); setSearch(v); }}
          placeholder="ابحثي بعنوان القصة…"
          className="w-full sm:w-64"
        />
      </div>

      {stories.length === 0 ? (
        <EmptyState icon={<BookOpen size={40} />} title="لا نتائج تطابق بحثك." />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 stagger-in">
          {stories.map((story) => (
            <Card key={story.slug} featured={story.is_published} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-h1 leading-snug">{story.title}</h2>
                <Badge tone={story.is_published ? "success" : "neutral"}>
                  {story.is_published ? ar.stories.published : ar.stories.draft}
                </Badge>
              </div>
              <p className="text-caption text-slate-500">
                {ar.stories.scenes(story.scene_count)} · {ar.stories.assets(story.asset_count)}
              </p>
              {story.description ? <p className="text-body text-slate-600 flex-1">{story.description}</p> : <div className="flex-1" />}
              <div className="flex gap-2">
                <Link to={`/stories/${story.slug}/play`} className="flex-1">
                  <Button icon={<Play size={18} />} pulse className="w-full">{ar.stories.play}</Button>
                </Link>
                {hasRole("TEACHER", "ADMIN") ? (
                  <a href={withStudioToken(`${STUDIO_URL}?story=${encodeURIComponent(story.slug)}`)}>
                    <Button variant="secondary" icon={<Pencil size={18} />} aria-label={ar.stories.edit} />
                  </a>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} count={count} onChange={setPage} />
    </div>
  );
}
