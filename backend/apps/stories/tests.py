"""
اختبارات شبكة الأمان البنيوية في `validators.py`.

هذه أول اختبارات في الباك إند، وسببها المباشر عطل حقيقي: المُتحقِّق كان يشترط
`alias` على كل عنصر، فيرفض حفظ أي قصّة تستخدم المجموعات (v1.0.17) — وقصّة
`birds` المستوردة كانت مرفوضة فعلاً رغم أنها صالحة بحسب العقد.

الاختبارات تُثبّت الحدّ الفاصل الذي يجب أن يبقى: العقد المرجعي هو
`SchemaValidator.ts`، وما هنا يمنع فقط ما يُعطب المحرّك وقت العرض.
"""

from django.test import SimpleTestCase, TestCase
from rest_framework.exceptions import ValidationError

from .models import Story
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


class CompatVisibilityTests(TestCase):
    """
    مسارات `/content/` تقرأ رمز JWT.

    الحارس هنا يمنع ارتداداً بعينه: هذه دوالّ Django عادية لا DRF، وميدلوير
    Django يقرأ الهوية من الجلسة وحدها. فكان شرط «المعلّمة ترى قصصها» كوداً
    ميّتاً لا يعمل أبداً — لا معاينة لمسوّدة، ولا ظهور لها في أي فهرس، وكل
    قصّة جديدة مسوّدة بالتعريف.
    """

    def setUp(self):
        from apps.accounts.models import User

        self.teacher = User.objects.create_user(email="t@x.local", password="pw12345678", full_name="م")
        self.other = User.objects.create_user(email="o@x.local", password="pw12345678", full_name="ن")
        self.draft = Story.objects.create(
            slug="draft1", title="مسوّدة", owner=self.teacher, is_published=False,
            story_json={"id": "draft1", "title": "مسوّدة", "story": {"scenes": []}},
        )
        Story.objects.create(
            slug="pub1", title="منشورة", owner=self.teacher, is_published=True,
            story_json={"id": "pub1", "title": "منشورة", "story": {"scenes": []}},
        )

    def _bearer(self, user):
        from rest_framework_simplejwt.tokens import RefreshToken

        return {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}

    def test_guest_cannot_read_a_draft(self):
        self.assertEqual(self.client.get("/content/stories/draft1/story.json").status_code, 404)

    def test_guest_can_read_a_published_story(self):
        """العرض على شاشة الصف قد يجري بلا جلسة — هذا مقصود."""
        self.assertEqual(self.client.get("/content/stories/pub1/story.json").status_code, 200)

    def test_owner_can_read_their_own_draft(self):
        res = self.client.get("/content/stories/draft1/story.json", **self._bearer(self.teacher))
        self.assertEqual(res.status_code, 200)

    def test_another_teacher_cannot_read_someone_elses_draft(self):
        res = self.client.get("/content/stories/draft1/story.json", **self._bearer(self.other))
        self.assertEqual(res.status_code, 404)

    def test_index_hides_drafts_from_guests_and_shows_them_to_the_owner(self):
        guest = self.client.get("/content/stories/index.json").json()["stories"]
        self.assertNotIn("draft1", guest)
        self.assertIn("pub1", guest)

        owner = self.client.get("/content/stories/index.json", **self._bearer(self.teacher)).json()["stories"]
        self.assertIn("draft1", owner)

    def test_a_broken_token_degrades_to_guest_rather_than_erroring(self):
        """انتهاء جلسة أثناء الحصّة يجب ألّا يُسقط قصّة منشورة."""
        res = self.client.get("/content/stories/pub1/story.json", HTTP_AUTHORIZATION="Bearer not-a-token")
        self.assertEqual(res.status_code, 200)

    # ── الكوكي: الطريق الوحيد الذي تسلكه الصور ──────────────────────────
    #
    # PixiJS يحمّل الصور داخل Web Worker، وللعامل نطاق عام مستقلّ لا يرى أي
    # اعتراض على `fetch` في الخيط الرئيسي — فتخرج طلباته بلا ترويسة مهما
    # فعل تطبيق الويب. الأثر المقيس: `story.json` ينجح ثم تفشل **كل** صورة
    # بـ 404 في مسوّدة، فيُعرض مشهد فارغ بلا رسالة.

    def _cookie(self, user):
        from rest_framework_simplejwt.tokens import RefreshToken

        return str(RefreshToken.for_user(user).access_token)

    def test_owner_reads_a_draft_by_cookie_alone(self):
        """بلا ترويسة إطلاقاً — تماماً كما يطلب العامل الصور."""
        self.client.cookies["edu_content"] = self._cookie(self.teacher)
        res = self.client.get("/content/stories/draft1/story.json")
        self.assertEqual(res.status_code, 200)

    def test_no_cookie_still_hides_a_draft(self):
        self.assertEqual(self.client.get("/content/stories/draft1/story.json").status_code, 404)

    def test_another_teachers_cookie_does_not_open_a_draft(self):
        self.client.cookies["edu_content"] = self._cookie(self.other)
        self.assertEqual(self.client.get("/content/stories/draft1/story.json").status_code, 404)

    def test_a_broken_cookie_degrades_to_guest(self):
        self.client.cookies["edu_content"] = "garbage"
        self.assertEqual(self.client.get("/content/stories/pub1/story.json").status_code, 200)


class BuriedSlugTests(TestCase):
    """
    معرّف يشغله صفّ محذوف حذفاً ناعماً.

    `slug` فريد على مستوى الجدول كلّه والحذف الناعم لا يحرّره، فيبقى المعرّف
    محجوزاً بصفّ لا يراه أي استعلام. الاستوديو يفحص التوفّر عبر قائمة تستبعد
    المحذوف، فيظنّه متاحاً — ثم يفشل الإنشاء ويعود الحفظ بـ 404 يتحدّث عن
    صلاحيات بينما السبب معرّف مدفون. حدث فعلاً مع قصّة اسمها `tree`.
    """

    def setUp(self):
        from apps.accounts.models import User

        self.teacher = User.objects.create_user(email="t2@x.local", password="pw12345678", full_name="م")
        self.other = User.objects.create_user(email="o2@x.local", password="pw12345678", full_name="ن")

    def _login(self, user):
        from rest_framework_simplejwt.tokens import RefreshToken

        self.client.credentials = None
        return {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}

    def _bury(self, slug, owner):
        story = Story.objects.create(slug=slug, title="قديمة", owner=owner, story_json={"id": slug})
        story.delete()  # حذف ناعم
        return story

    def test_creating_over_own_buried_slug_revives_it(self):
        buried = self._bury("tree", self.teacher)
        res = self.client.post(
            "/api/stories/",
            {"slug": "tree", "title": "tree", "story_json": {"id": "tree", "title": "tree"}},
            content_type="application/json",
            **self._login(self.teacher),
        )
        self.assertEqual(res.status_code, 201)
        revived = Story.objects.get(slug="tree")  # مرئية للاستعلام العادي الآن
        self.assertEqual(revived.pk, buried.pk)
        self.assertIsNone(revived.deleted_at)
        self.assertEqual(revived.title, "tree")

    def test_the_revived_story_can_then_be_saved(self):
        """الحفظ بعد الإنشاء هو ما كان يفشل بـ 404 — الحارس الحقيقي."""
        self._bury("tree", self.teacher)
        self.client.post(
            "/api/stories/",
            {"slug": "tree", "title": "tree", "story_json": {"id": "tree"}},
            content_type="application/json",
            **self._login(self.teacher),
        )
        res = self.client.patch(
            "/api/stories/tree/",
            {"story_json": {"id": "tree", "story": {"scenes": [{"id": "scene01"}]}}},
            content_type="application/json",
            **self._login(self.teacher),
        )
        self.assertEqual(res.status_code, 200)

    def test_someone_elses_buried_slug_is_refused_by_name_not_by_permission(self):
        self._bury("tree", self.other)
        res = self.client.post(
            "/api/stories/",
            {"slug": "tree", "title": "tree", "story_json": {"id": "tree"}},
            content_type="application/json",
            **self._login(self.teacher),
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("محجوز", str(res.json()))

    def test_a_free_slug_still_creates_normally(self):
        res = self.client.post(
            "/api/stories/",
            {"slug": "brandnew", "title": "جديدة", "story_json": {"id": "brandnew"}},
            content_type="application/json",
            **self._login(self.teacher),
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Story.objects.filter(slug="brandnew").exists())
