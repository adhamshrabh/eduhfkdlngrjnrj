/** تاب الألعاب — يُخفي ما لا يعمل على هذا الجهاز بدل أن يتركه يفشل. */
import { Suspense, useEffect, useMemo, useState } from "react";
import { Camera, Gamepad2, Play } from "lucide-react";

import { Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { ar } from "@/lib/i18n";
import type { Classroom, GameSessionResult } from "@/lib/types";

import { GAMES, detectCapabilities, isPlayable, type GameCapability, type GameModule, type GameResult } from "./registry";

const SUBJECT_STYLES: Record<GameModule["subject"], string> = {
  math: "bg-subject-math-bg text-subject-math-fg",
  science: "bg-subject-science-bg text-subject-science-fg",
  art: "bg-subject-art-bg text-subject-art-fg",
  language: "bg-subject-language-bg text-subject-language-fg",
  motor: "bg-subject-motor-bg text-subject-motor-fg",
  story: "bg-subject-story-bg text-subject-story-fg",
};

export function GamesPage(): JSX.Element {
  const [capabilities, setCapabilities] = useState<Set<GameCapability> | null>(null);
  const [active, setActive] = useState<GameModule | null>(null);
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const startedAt = useState(() => ({ value: 0 }))[0];

  useEffect(() => {
    void detectCapabilities().then(setCapabilities);
    api
      .get<Classroom[]>("/api/classrooms/")
      .then((rooms) => setClassroom(rooms[0] ?? null))
      .catch(() => setClassroom(null));
  }, []);

  const playable = useMemo(
    () => (capabilities ? GAMES.filter((g) => isPlayable(g, capabilities)) : []),
    [capabilities],
  );

  /** نقطة التسجيل الوحيدة لكل الألعاب — لا مسار خاص بكل لعبة. */
  const handleComplete = (game: GameModule, result: GameResult): void => {
    if (!classroom) return;
    const payload: GameSessionResult = {
      classroom: classroom.id,
      game_id: game.id,
      game_title: game.title,
      duration_seconds: result.durationSeconds,
      completed_items: result.completedItems,
      total_items: result.totalItems,
    };
    void api.post("/api/games/sessions/", payload).catch(() => {
      /* فشل التسجيل لا يُفسد الحصّة — يُعاد المحاولة لاحقاً عبر الطابور */
    });
  };

  if (active) {
    const Game = active.Component;
    return (
      <Suspense
        fallback={
          <div className="grid place-items-center h-full gap-3 text-slate-600">
            <Spinner size={32} />
            <p className="text-h2">{ar.common.loading}</p>
          </div>
        }
      >
        <Game
          onBack={() => setActive(null)}
          onComplete={(result) => handleComplete(active, result)}
        />
      </Suspense>
    );
  }

  if (!capabilities) {
    return (
      <div className="p-6">
        <div className="h-8 w-32 skeleton mb-6" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white/75 backdrop-blur-xl border border-white/60 rounded-2xl shadow-card p-5 space-y-4">
              <div className="h-6 w-1/2 skeleton rounded-xl" />
              <div className="h-3 w-full skeleton" />
              <div className="h-12 w-full skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (playable.length === 0) {
    return <EmptyState icon={<Gamepad2 size={48} />} title={ar.games.empty} hint={ar.games.cameraUnavailable} />;
  }

  return (
    <div className="p-6">
      <h1 className="text-display mb-6 animate-slide-up">{ar.games.title}</h1>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 stagger-in">
        {playable.map((game) => (
          <Card key={game.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <span className={`px-3 py-1.5 rounded-xl text-label ${SUBJECT_STYLES[game.subject]}`}>
                {game.title}
              </span>
              {game.requires.includes("camera") ? (
                <Badge tone="warning">
                  <span className="inline-flex items-center gap-1">
                    <Camera size={12} /> {ar.games.needsCamera}
                  </span>
                </Badge>
              ) : null}
            </div>
            <p className="text-body text-slate-600 flex-1">{game.description}</p>
            <Button
              icon={<Play size={18} />}
              pulse
              onClick={() => {
                startedAt.value = Date.now();
                setActive(game);
              }}
            >
              {ar.games.play}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
