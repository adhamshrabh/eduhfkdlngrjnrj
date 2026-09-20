/**
 * الأجهزة — ربط بطاقة مادّية بمعنىً في القصّة.
 *
 * ⚠️ الحدّ الذي تقوم عليه الصفحة كلّها:
 * رقم البطاقة لا يدخل `story.json` أبداً. القصّة تعرف «تفاحة»، وهذا الجدول
 * يعرف `786qaaa ← تفاحة`، والقارئ يعرف الرقم ولا شيء غيره. تُفقد البطاقة؟
 * تُربط أخرى بالاسم نفسه ولا تتغيّر القصّة بحرف.
 *
 * ولهذا «المعنى» هنا ليس اسماً حرّاً: هو **الاسم المستعار للأصل** الذي
 * تعرضه الصورة في «اختر الإجابة الصحيحة» — `PickCorrectRunner` يطابق عليه
 * مباشرةً، فلا طبقة ترجمة ثالثة بين ما تكتبه المعلّمة وما يفهمه المحرّك.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Cpu, Plug, Plus, PlugZap, RadioTower, Trash2, Usb, Wifi, WifiOff } from "lucide-react";

import { Badge, Button, Card, EmptyState, ErrorNote, Field, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { ar } from "@/lib/i18n";
import { useToast } from "@/lib/toast";

import { useCardReader } from "./useCardReader";
import { useSerialReader } from "./useSerialReader";

interface DeviceCard {
  id: number;
  uid: string;
  label: string;
}

interface DeviceButton {
  id: number;
  index: number;
  role: string;
}

/**
 * أدوار الزرّ — **مفردات مغلقة** يفهمها المحرّك (v1.0.24 §4).
 *
 * ⚠️ الفرق عن معنى البطاقة: ذاك اسم أصلٍ تكتبه المعلّمة بحرّية، وهذا يجب أن
 * يعرفه `Directions.ts`. فحقلٌ حرّ كان يسمح بكتابة «أعلى» فلا يتحرّك شيء
 * ولا يقول أحد لماذا — ولهذا قائمة لا حقل نصّ.
 */
const BUTTON_ROLES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "up", label: "فوق" },
  { value: "down", label: "تحت" },
  { value: "left", label: "يسار" },
  { value: "right", label: "يمين" },
  { value: "select", label: "تأكيد" },
];

function roleLabel(role: string): string {
  return BUTTON_ROLES.find((r) => r.value === role)?.label ?? role;
}

interface Device {
  id: number;
  name: string;
  kind: string;
  url: string;
  cards: DeviceCard[];
  buttons: DeviceButton[];
  card_count: number;
}

/** الأزرار تُجيب بالموضع بلا أي ربط، فحالتها ليست عطلاً بل انتظاراً. */
function usbLabel(status: string): string {
  if (status === "busy") return "المنفذ مشغول";
  if (status === "connecting") return "يتّصل…";
  if (status === "error") return "تعذّر الفتح";
  if (status === "unsupported") return "غير مدعوم";
  return "غير متّصل";
}

function wifiLabel(status: string): string {
  if (status === "connecting") return "يتّصل…";
  if (status === "error") return "تعذّر الاتصال";
  return "غير متّصل";
}

export function DevicesPage(): JSX.Element {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const selected = devices?.find((d) => d.id === selectedId) ?? devices?.[0] ?? null;

  // ── الوسيلة تُقرأ من العنوان، لا من حقل ثالث ─────────────────────────
  //
  // عنوان فارغ = كبل USB، وعنوان موجود = شبكة. `kind` جديد كان سيعني هجرة
  // في قاعدة البيانات لتمثيل ما يقوله العنوان أصلاً — والأسوأ أنه يسمح
  // بحالة متناقضة: جهاز «USB» يحمل عنوان WebSocket.
  const overUsb = !selected?.url;
  const wifi = useCardReader(overUsb ? null : (selected?.url ?? null));
  const serial = useSerialReader(overUsb && Boolean(selected));

  const connected = overUsb ? serial.status === "connected" : wifi.status === "connected";
  const lastCard = overUsb ? serial.lastCard : wifi.lastCard;
  const lastPosition = overUsb ? serial.lastPosition : wifi.lastPosition;
  const signals = overUsb ? serial.signals : wifi.signals;
  const clearSignals = overUsb ? serial.clear : wifi.clear;

  const load = (): void => {
    api
      .get<{ results: Device[] }>("/api/devices/")
      .then((data) => setDevices(data.results))
      .catch((err: unknown) => {
        setDevices([]);
        setError(err instanceof Error ? err.message : ar.common.error);
      });
  };

  useEffect(load, []);

  const addDevice = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.post("/api/devices/", {
        name: String(form.get("name") ?? "").trim(),
        kind: "esp32",
        url: String(form.get("url") ?? "").trim(),
      });
      setAdding(false);
      load();
      toast.show("تم إضافة الجهاز.");
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.common.error);
    }
  };

  const bindCard = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selected || !lastCard) return;
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") ?? "").trim();
    if (!label) return;
    try {
      await api.post(`/api/devices/${selected.id}/cards/`, { uid: lastCard, label });
      clearSignals();
      load();
      toast.show(`ارتبطت البطاقة بـ«${label}».`);
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.common.error);
    }
  };

  /**
   * يربط الزرّ المضغوط بدوره.
   *
   * ⚠️ الضغط قبل التسمية لا العكس: أيُّ موضعٍ هو «فوق» خاصّيةُ **لحام هذا
   * الصندوق**، ولا سبيل إلى معرفتها بعد إغلاقه إلّا بالقياس. ولهذا لا يوجد
   * حقلٌ لكتابة رقم الزرّ — كما لا يوجد حقلٌ لكتابة رقم البطاقة.
   */
  const bindButton = async (role: string): Promise<void> => {
    if (!selected || lastPosition === null) return;
    try {
      await api.post(`/api/devices/${selected.id}/buttons/`, { index: lastPosition, role });
      clearSignals();
      load();
      toast.show(`صار الزرّ ${lastPosition} يعني «${roleLabel(role)}».`);
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.common.error);
    }
  };

  const unbindButton = async (button: DeviceButton): Promise<void> => {
    if (!selected) return;
    try {
      await api.delete(`/api/devices/${selected.id}/buttons/${button.id}/`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.common.error);
    }
  };

  const unbind = async (card: DeviceCard): Promise<void> => {
    if (!selected) return;
    try {
      await api.delete(`/api/devices/${selected.id}/cards/${card.id}/`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.common.error);
    }
  };

  if (!devices) return <div className="grid place-items-center py-24"><Spinner size={28} /></div>;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-h1 text-slate-800">الأجهزة</h1>
          <p className="text-body text-slate-500">
            اربطي كل بطاقة بالصورة التي تعنيها، فتصير البطاقة إجابةً داخل القصّة.
          </p>
        </div>
        <Button onClick={() => setAdding((v) => !v)}>
          <Plus size={18} /> إضافة قارئ
        </Button>
      </header>

      {error && <ErrorNote message={error} onRetry={load} />}

      {adding && (
        <Card>
          <form onSubmit={addDevice} className="p-4 grid gap-3 sm:grid-cols-2">
            <Field name="name" label="اسم القارئ" placeholder="قارئ الصف" required />
            {/* اتركيه فارغاً للكبل — وهو الحالة العادية. العنوان يُخزَّن مع
                الجهاز لا في متغيّر بيئة: القارئ ينتقل بين الغرف فيتغيّر
                عنوانه، وتغييره يجب ألّا يستلزم إعادة بناء. */}
            <Field name="url" label="العنوان (اتركيه فارغاً للكبل)" placeholder="ws://192.168.1.42:81" />
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit">حفظ</Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>إلغاء</Button>
            </div>
          </form>
        </Card>
      )}

      {devices.length === 0 && !adding && (
        <EmptyState
          icon={<Cpu size={48} />}
          title="لا يوجد قارئ بعد"
          hint="أضيفي قارئ ESP32 وعنوانه، ثم امسحي بطاقة لتعريفها. القصص تعمل باللمس بلا قارئ أصلاً."
        />
      )}

      {devices.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {devices.map((device) => (
            <Button
              key={device.id}
              variant={device.id === selected?.id ? "primary" : "ghost"}
              onClick={() => setSelectedId(device.id)}
            >
              {device.name}
            </Button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <Card>
            <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                {overUsb ? (
                  <Usb size={20} className={connected ? "text-emerald-600" : "text-slate-400"} />
                ) : connected ? (
                  <Wifi size={20} className="text-emerald-600" />
                ) : (
                  <WifiOff size={20} className="text-slate-400" />
                )}
                <div>
                  <div className="text-body text-slate-800">{selected.name}</div>
                  <div className="text-label text-slate-500">
                    {overUsb ? "متّصل بكبل USB" : selected.url}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* المتصفّح يشترط ضغطة مستخدم لفتح حوار اختيار المنفذ —
                    لا يمكن فتحه تلقائياً. لكن `getPorts()` يعيد منفذاً سبق
                    الإذن به، فالضغطة مرّة واحدة لا كل صباح. */}
                {overUsb && !connected && serial.status !== "unsupported" && (
                  <Button onClick={() => void serial.connect()}>
                    <Plug size={16} /> توصيل عبر USB
                  </Button>
                )}
                {/* ── فصل صريح ────────────────────────────────────────────
                    المنفذ حصريّ: صفحة واحدة تملكه. وتحريره عند مغادرة
                    الصفحة وحده لا يكفي — المعلّمة تُبقي «الأجهزة» مفتوحة
                    وتفتح القصّة في تبويب آخر، فتجد الصندوق «معطوباً» وهو
                    ممسوك من هنا. الفصل فعلٌ تملكه، لا أثرٌ جانبي للتنقّل. */}
                {overUsb && connected && (
                  <Button variant="ghost" onClick={() => void serial.disconnect()}>
                    <PlugZap size={16} /> فصل الاتصال
                  </Button>
                )}
                <Badge tone={connected ? "success" : serial.status === "busy" ? "warning" : "neutral"}>
                  {connected ? "متّصل" : overUsb ? usbLabel(serial.status) : wifiLabel(wifi.status)}
                </Badge>
              </div>
            </div>

            {overUsb && connected && (
              <div className="px-4 pb-4 text-label text-slate-500">
                القارئ يُسلَّم تلقائياً حين تنتقلين إلى القصّة، ويعود إليكِ هنا.
              </div>
            )}
            {overUsb && serial.error && (
              <div className="px-4 pb-4 text-label text-amber-700">{serial.error}</div>
            )}
            {overUsb && serial.status === "unsupported" && (
              <div className="px-4 pb-4 text-label text-slate-500">
                هذا المتصفّح لا يدعم قراءة المنفذ. افتحي المنصّة في Chrome أو Edge.
              </div>
            )}
          </Card>

          {/* ── الالتقاط ─────────────────────────────────────────────────
              المعلّمة لا تكتب رقم البطاقة ولا تراه إلا للتشخيص: تمسح،
              فيظهر الرقم، فتكتب معناه. كتابة رقمٍ من ستّ عشرة خانة يدوياً
              مصدر أخطاء لا يكشفها شيء حتى يقف المسح أمام الصف. */}
          <Card>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-body text-slate-800">
                <RadioTower size={18} /> امسحي بطاقة لتعريفها
              </div>

              {!connected && (
                <p className="text-label text-slate-500">
                  وصّلي القارئ أولاً — بلا اتصال لا تصل أي إشارة.
                </p>
              )}

              {lastCard ? (
                <form onSubmit={bindCard} className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
                  <Field
                    name="label"
                    label={`المعنى — اسم الصورة التي تعنيها البطاقة (${lastCard})`}
                    placeholder="تفاحة"
                    autoFocus
                    required
                  />
                  <Button type="submit">ربط</Button>
                </form>
              ) : (
                connected && <p className="text-label text-slate-500">بانتظار بطاقة…</p>
              )}

              {signals.length > 0 && (
                <details className="text-label text-slate-500">
                  <summary className="cursor-pointer">الإشارات الواصلة ({signals.length})</summary>
                  <ul className="mt-2 space-y-1 font-mono" dir="ltr">
                    {signals.map((signal) => (
                      <li key={signal.at} className="truncate">{signal.raw}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-4 space-y-3">
              <div className="text-body text-slate-800 flex items-center gap-2">
                <RadioTower size={18} /> اضغطي زرّاً لتحديد اتجاهه
              </div>

              <p className="text-label text-slate-500">
                الصندوق يرسل موضع الزرّ ولا يعرف «فوق». اضغطي الزرّ ثم اختاري ما يعنيه — فيُقاس
                اللحام بدل افتراضه. وحتى قبل الربط تعمل الأزرار بترتيبها الافتراضي:
                ١ فوق، ٢ تحت، ٣ يمين، ٤ يسار، ٥ تأكيد.
              </p>

              {lastPosition !== null ? (
                <div className="space-y-2">
                  <div className="text-label text-slate-600">
                    الزرّ <span className="font-mono">{lastPosition}</span> — ماذا يعني؟
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {BUTTON_ROLES.map((role) => (
                      <Button key={role.value} variant="ghost" onClick={() => void bindButton(role.value)}>
                        {role.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                connected && <p className="text-label text-slate-500">بانتظار ضغطة…</p>
              )}

              {selected.buttons.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {selected.buttons.map((button) => (
                    <li key={button.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <div className="text-body text-slate-800">{roleLabel(button.role)}</div>
                        <div className="text-label text-slate-400 font-mono" dir="ltr">
                          button {button.index}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => void unbindButton(button)}
                        aria-label={`فكّ ${roleLabel(button.role)}`}
                      >
                        فكّ
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <h2 className="text-body text-slate-800 mb-3">البطاقات ({selected.card_count})</h2>
              {selected.cards.length === 0 ? (
                <p className="text-label text-slate-500">لا بطاقات بعد.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {selected.cards.map((card) => (
                    <li key={card.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <div className="text-body text-slate-800">{card.label}</div>
                        <div className="text-label text-slate-400 font-mono" dir="ltr">{card.uid}</div>
                      </div>
                      <Button variant="ghost" onClick={() => void unbind(card)} aria-label={`فكّ ${card.label}`}>
                        <Trash2 size={16} />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
