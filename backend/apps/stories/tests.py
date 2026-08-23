"""
اختبارات شبكة الأمان البنيوية في `validators.py`.

هذه أول اختبارات في الباك إند، وسببها المباشر عطل حقيقي: المُتحقِّق كان يشترط
`alias` على كل عنصر، فيرفض حفظ أي قصّة تستخدم المجموعات (v1.0.17) — وقصّة
`birds` المستوردة كانت مرفوضة فعلاً رغم أنها صالحة بحسب العقد.

الاختبارات تُثبّت الحدّ الفاصل الذي يجب أن يبقى: العقد المرجعي هو
`SchemaValidator.ts`، وما هنا يمنع فقط ما يُعطب المحرّك وقت العرض.
"""

from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from .validators import extract_scene_objects, validate_layout_json, validate_story_json


def _nested(scenes: list[dict]) -> dict:
    """قصّة بالبنية الحقيقية — المشاهد تحت `story.scenes` لا في الجذر."""
    return {
        "schemaVersion": "1.0",
        "id": "t",
        "scenes": [s["id"] for s in scenes],
        "story": {"kind": "story", "scenes": scenes},
    }


class ExtractSceneObjectsTests(SimpleTestCase):
    def test_reads_nested_scenes(self):
        payload = _nested([{"id": "s1"}, {"id": "s2"}])
        self.assertEqual(len(extract_scene_objects(payload)), 2)

    def test_reads_legacy_root_scenes(self):
        self.assertEqual(len(extract_scene_objects({"scenes": [{"id": "s1"}]})), 1)

    def test_root_string_index_is_not_scenes(self):
        """مصفوفة معرّفات نصية فهرس لا مشاهد — الخلط بينهما كان أصل عطل سابق."""
        self.assertEqual(extract_scene_objects({"scenes": ["s1", "s2"]}), [])

    def test_non_dict_payload(self):
        self.assertEqual(extract_scene_objects("nope"), [])


class GroupElementTests(SimpleTestCase):
    """v1.0.17: المجموعة حاوية لا ترسم شيئاً، فلا `alias` لها."""

    def test_group_without_alias_is_accepted(self):
        payload = _nested([
            {
                "id": "s1",
                "elements": [
                    {"id": "body_1", "alias": "body", "type": "object", "groupId": "g1"},
                    {"id": "g1", "type": "group", "delay": 0.2},
                ],
            }
        ])
        self.assertIs(validate_story_json(payload), payload)

    def test_plain_element_still_needs_alias(self):
        payload = _nested([{"id": "s1", "elements": [{"id": "e1", "type": "object"}]}])
        with self.assertRaises(ValidationError):
            validate_story_json(payload)

    def test_element_without_id_is_rejected(self):
        payload = _nested([{"id": "s1", "elements": [{"type": "group"}]}])
        with self.assertRaises(ValidationError):
            validate_story_json(payload)


class StoryStructureTests(SimpleTestCase):
    def test_empty_new_story_is_accepted(self):
        """الاستوديو ينشئ القصّة فارغة ثم يملؤها — الرفض هنا يجمّد الإنشاء."""
        self.assertIsNotNone(validate_story_json({"schemaVersion": "1.0", "id": "new"}))

    def test_duplicate_scene_id_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_story_json(_nested([{"id": "s1"}, {"id": "s1"}]))

    def test_scene_without_id_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_story_json({"story": {"scenes": [{"background": "bg"}]}})

    def test_lines_must_be_a_list(self):
        with self.assertRaises(ValidationError):
            validate_story_json(_nested([{"id": "s1", "lines": "hello"}]))

    def test_elements_must_be_a_list(self):
        with self.assertRaises(ValidationError):
            validate_story_json(_nested([{"id": "s1", "elements": {}}]))

    def test_payload_must_be_an_object(self):
        with self.assertRaises(ValidationError):
            validate_story_json([])


class LayoutTests(SimpleTestCase):
    def test_empty_layout_is_accepted(self):
        """قصّة جديدة تُنشأ بلا مفتاح `puzzle` — افتراض وجوده جمّدها سابقاً."""
        self.assertEqual(validate_layout_json(None), {})
        self.assertEqual(validate_layout_json(""), {})

    def test_puzzle_must_be_an_object_when_present(self):
        with self.assertRaises(ValidationError):
            validate_layout_json({"puzzle": []})
