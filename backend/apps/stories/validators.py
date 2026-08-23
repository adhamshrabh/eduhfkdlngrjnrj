"""
تحقّق من بنية عقد المحتوى قبل الحفظ.

⚠️ درس مدفوع الثمن — البنية الحقيقية لـ story.json:

النسخة الأولى من هذا الملف افترضت أن مصفوفة المشاهد في جذر الملف. الافتراض
خاطئ، واكتُشف عند تشغيل المحرّك فعلياً لا عند قراءة الكود. البنية الحقيقية
التي يقرأها `StoryLoader` و`YaraBedScene`:

    {
      "id": "birds", "title": "…", "language": "ar",
      "startScene": "s1",
      "scenes": ["s1", "s2"],          ← معرّفات نصية فقط (فهرس)
      "story": {                        ← StoryDefinition
        "kind": "story", "scene": "YaraBedScene", "bundle": "…",
        "assets": [{ "alias": "…", "src": "…" }],
        "scenes": [ { id, background, elements[], lines[], activity } ]  ← المشاهد الفعلية
      }
    }

لو بقي الافتراض الأول لَرُفض استيراد كل قصة حقيقية أو حُسبت مشاهدها صفراً.
لذلك نتحقّق من الموضعين، ونقبل الشكلين — بعض المحتوى القديم يضع المشاهد في
الجذر مباشرة.

العقد الكامل والمرجعي يبقى `SchemaValidator.ts` في جانب العميل (32 كيلوبايت).
ما هنا شبكة أمان بنيوية تمنع حفظ JSON يُعطب المحرّك وقت العرض أمام الصف، لا
نسخة ثانية من العقد. الخطوة المخطّطة لاحقاً: تصدير JSON Schema من ذلك الملف
واستهلاكه هنا، فيبقى العقد معرّفاً في مكان واحد. حتى ذلك الحين هذا دَيْن تقني
معروف لا مفاجأة.
"""

from typing import Any

from rest_framework.exceptions import ValidationError


def extract_scene_objects(payload: Any) -> list[dict]:
    """
    يعيد مصفوفة المشاهد الفعلية أينما كانت — الموضع القياسي أولاً.

    يُستخدم من المُتحقِّق ومن `Story.scene_count` معاً حتى لا يختلف تعريف
    «كم مشهداً في هذه القصة» بين مكانين.
    """
    if not isinstance(payload, dict):
        return []

    nested = payload.get("story")
    if isinstance(nested, dict):
        scenes = nested.get("scenes")
        if isinstance(scenes, list):
            return [s for s in scenes if isinstance(s, dict)]

    scenes = payload.get("scenes")
    if isinstance(scenes, list):
        # مصفوفة معرّفات نصية = فهرس لا مشاهد
        return [s for s in scenes if isinstance(s, dict)]

    return []


def _validate_scene(scene: dict, where: str, seen_ids: set[str]) -> None:
    scene_id = scene.get("id")
    if not isinstance(scene_id, str) or not scene_id.strip():
        raise ValidationError(f"{where}.id مفقود أو فارغ.")
    if scene_id in seen_ids:
        raise ValidationError(f"معرّف المشهد مكرّر: {scene_id}")
    seen_ids.add(scene_id)

    lines = scene.get("lines")
    if lines is not None and not isinstance(lines, list):
        raise ValidationError(f"{where}.lines يجب أن يكون مصفوفة.")

    elements = scene.get("elements")
    if elements is not None:
        if not isinstance(elements, list):
            raise ValidationError(f"{where}.elements يجب أن يكون مصفوفة.")
        for index, element in enumerate(elements):
            if not isinstance(element, dict) or "id" not in element:
                raise ValidationError(f"{where}.elements[{index}] يحتاج الحقل id.")
            # المجموعة (v1.0.17 §2) حاوية لا ترسم شيئاً، فلا `alias` لها — أعضاؤها
            # هم من يحملون الصور ويشيرون إليها بـ `groupId`. اشتراط alias عليها
            # كان يرفض حفظ كل قصة تستخدم المجموعات، وقصّة `birds` منها فعلاً.
            if element.get("type") != "group" and "alias" not in element:
                raise ValidationError(f"{where}.elements[{index}] يحتاج الحقلين id و alias.")


def validate_story_json(payload: Any) -> dict:
    """يتحقّق من الحدّ الأدنى الذي يحتاجه المحرّك ليقلع دون استثناء."""
    if not isinstance(payload, dict):
        raise ValidationError("بيانات القصة يجب أن تكون كائناً.")

    root_scenes = payload.get("scenes")
    nested = payload.get("story")

    # فهرس المشاهد في الجذر: إمّا معرّفات نصية، أو مشاهد كاملة (محتوى قديم).
    if root_scenes is not None and not isinstance(root_scenes, list):
        raise ValidationError("الحقل scenes يجب أن يكون مصفوفة.")

    if isinstance(nested, dict):
        nested_scenes = nested.get("scenes")
        if nested_scenes is not None and not isinstance(nested_scenes, list):
            raise ValidationError("الحقل story.scenes يجب أن يكون مصفوفة.")

    scenes = extract_scene_objects(payload)
    if not scenes:
        # قصة جديدة فارغة مقبولة — الاستوديو ينشئها ثم يملؤها.
        return payload

    where_prefix = "story.scenes" if isinstance(nested, dict) and isinstance(nested.get("scenes"), list) else "scenes"
    seen_ids: set[str] = set()
    for index, scene in enumerate(scenes):
        _validate_scene(scene, f"{where_prefix}[{index}]", seen_ids)

    return payload


def validate_layout_json(payload: Any) -> dict:
    """
    التخطيط يقبل الفراغ عمداً.

    هذه ليست تفصيلة: قصّة جديدة تُنشأ بلا مفتاح `puzzle` إطلاقاً، وافتراض
    وجوده هو ما جمّد كل قصة جديدة سابقاً. كل حقل هنا اختياري بالتصميم.
    """
    if payload in (None, ""):
        return {}
    if not isinstance(payload, dict):
        raise ValidationError("بيانات التخطيط يجب أن تكون كائناً.")

    puzzle = payload.get("puzzle")
    if puzzle is not None and not isinstance(puzzle, dict):
        raise ValidationError("الحقل puzzle — إن وُجد — يجب أن يكون كائناً.")

    return payload
