/**
 * اختيار معنى البطاقة من قائمتين: القصّة، ثم صورةٌ من أصولها.
 *
 * ⚠️ لماذا لا حقل نصّ: المعنى **هو** `alias` الأصل، و`PickCorrectRunner`
 * يطابق عليه حرفاً بحرف. حقلٌ حرّ يقبل «تفّاحة» بشدّة بينما الأصل «تفاحة»،
 * فتُربط البطاقة ولا تُجيب — ولا يقول أحد لماذا حتى يقف المسح أمام الصف.
 * الاختيار من أصول القصّة نفسها يجعل هذا الخطأ مستحيلاً.
 *
 * يبقى مخرجٌ يدويّ واحد: المعنى قد يكون معرّف فرعٍ لا صورة (انظر
 * `DeviceCard.label`)، ولا قائمة تعرف الفروع.
 */
import { useEffect, useRef, useState } from "react";

import { Button, Field } from "@/components/ui";
import { api } from "@/lib/api";
import type { Paginated, StoryAsset, StorySummary } from "@/lib/types";

const SELECT_CLASS =
  "w-full min-h-touch px-4 py-3 rounded-xl border border-slate-200 bg-white text-body disabled:opacity-60";

/** قيمة خاصّة في قائمة الأصول تفتح حقل الكتابة اليدوية. */
const MANUAL = "__manual__";

/**
 * كل القصص لا الصفحة الأولى: الترقيم 50، والمكتبة تتجاوزها — وقصّةٌ
 * لا تظهر في القائمة لا تُربط بطاقاتها إلا بالكتابة، وهو ما نتجنّبه.
 */
export async function loadAllStories(): Promise<StorySummary[]> {
  const all: StorySummary[] = [];
  for (let page = 1; ; page += 1) {
    const data = await api.get<Paginated<StorySummary>>(`/api/stories/?page=${page}`);
    all.push(...data.results);
    if (data.results.length === 0 || all.length >= data.count) break;
  }
  return all.sort((a, b) => a.title.localeCompare(b.title, "ar"));
}

/** أصول كل قصّة تُجلب مرّة — التبديل بين القصص ذهاباً وإياباً لا يعيد الطلب. */
const assetCache = new Map<string, Promise<StoryAsset[]>>();

function loadImages(slug: string): Promise<StoryAsset[]> {
  let pending = assetCache.get(slug);
  if (!pending) {
    pending = api
      .get<StoryAsset[]>(`/api/stories/${encodeURIComponent(slug)}/assets/`)
      .then((assets) =>
        assets
          .filter((a) => a.kind === "images")
          .sort((a, b) => a.alias.localeCompare(b.alias, "ar")),
      );
    pending.catch(() => assetCache.delete(slug));
    assetCache.set(slug, pending);
  }
  return pending;
}

export interface AssetLabelPickerProps {
  stories: StorySummary[] | null;
  /** القصّة مرفوعةٌ إلى الصفحة: المعلّمة تختارها مرّة ثم تمسح بطاقاتها واحدةً واحدة. */
  storySlug: string;
  onStoryChange: (slug: string) => void;
  /** المعاني المربوطة فعلاً على هذا الجهاز — تُعلَّم في القائمة. */
  boundLabels: ReadonlySet<string>;
  submitLabel: string;
  onSubmit: (label: string) => void | Promise<void>;
  onCancel?: () => void;
  initialLabel?: string;
}

export function AssetLabelPicker({
  stories,
  storySlug,
  onStoryChange,
  boundLabels,
  submitLabel,
  onSubmit,
  onCancel,
  initialLabel = "",
}: AssetLabelPickerProps): JSX.Element {
  const [assets, setAssets] = useState<StoryAsset[] | null>(null);
  const [assetError, setAssetError] = useState(false);
  const [choice, setChoice] = useState("");
  const [manual, setManual] = useState(initialLabel);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    setChoice("");
    setAssets(null);
    setAssetError(false);
    if (!storySlug) return;
    const id = ++request.current;
    loadImages(storySlug)
      .then((list) => {
        if (id !== request.current) return;
        setAssets(list);
        // المعنى الحالي للبطاقة يُختار سلفاً إن كان من هذه القصّة.
        if (initialLabel && list.some((a) => a.alias === initialLabel)) setChoice(initialLabel);
      })
      .catch(() => {
        if (id === request.current) setAssetError(true);
      });
  }, [storySlug, initialLabel]);

  const label = choice === MANUAL ? manual.trim() : choice;
  const preview = assets?.find((a) => a.alias === choice);

  const submit = async (): Promise<void> => {
    if (!label || busy) return;
    setBusy(true);
    try {
      await onSubmit(label);
      setChoice("");
      setManual("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block mb-1.5 text-h3 text-slate-700">القصّة</span>
          <select
            value={storySlug}
            onChange={(e) => onStoryChange(e.target.value)}
            disabled={!stories}
            className={SELECT_CLASS}
          >
            <option value="">{stories ? "— اختاري قصّة —" : "جارٍ تحميل القصص…"}</option>
            {stories?.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block mb-1.5 text-h3 text-slate-700">الصورة التي تعنيها البطاقة</span>
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">
              {!storySlug
                ? "— اختاري القصّة أولاً —"
                : assetError
                  ? "تعذّر تحميل الأصول"
                  : !assets
                    ? "جارٍ تحميل الأصول…"
                    : assets.length === 0
                      ? "لا صور في هذه القصّة"
                      : "— اختاري صورة —"}
            </option>
            {assets?.map((a) => (
              <option key={a.asset_id} value={a.alias}>
                {boundLabels.has(a.alias) ? `✓ ${a.alias}` : a.alias}
              </option>
            ))}
            <option value={MANUAL}>كتابة يدوية…</option>
          </select>
        </label>
      </div>

      {choice === MANUAL && (
        <Field
          name="label"
          label="المعنى — اسم الأصل أو معرّف الفرع"
          placeholder="تفاحة"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          autoFocus
        />
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {preview && (
          <img
            src={preview.url}
            alt={preview.alias}
            className="w-16 h-16 object-contain rounded-lg border border-slate-200 bg-white"
          />
        )}
        {preview && boundLabels.has(preview.alias) && (
          <span className="text-label text-amber-700">مربوطة ببطاقة أخرى أيضاً.</span>
        )}
        <div className="flex gap-2 ms-auto">
          <Button onClick={() => void submit()} disabled={!label || busy}>
            {submitLabel}
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              إلغاء
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
