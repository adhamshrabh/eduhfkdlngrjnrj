"""
اختبارات الأجهذة والبطاقات.

المحور هنا ليس CRUD — بل **الملكية عبر الأب**. `DeviceCard` لا يحمل `owner`،
وهو الشكل نفسه الذي جعل حذف أي صورة يُرفض لكل معلّمة قبل أن يُصلَح
(`IsOwnerOrAdmin._owner_id`). فالاختبار الأهمّ في هذا الملف هو أن المالكة
تستطيع حذف بطاقتها.
"""

from django.test import TestCase
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User

from .models import Device, DeviceButton, DeviceCard


class DeviceApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(email="d1@x.local", password="pw12345678", full_name="م")
        self.other = User.objects.create_user(email="d2@x.local", password="pw12345678", full_name="ن")
        self.device = Device.objects.create(name="قارئ الصف", url="ws://192.168.1.42:81", owner=self.teacher)

    def _auth(self, user):
        return {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}

    # ── الملكية عبر الأب — العطل الذي سبق وقوعه في الأصول ────────────────

    def test_owner_can_delete_her_own_card(self):
        """
        البطاقة لا تحمل `owner`؛ مالكها مالك جهازها. بدون خاصيّة `owner_id`
        على النموذج يعود الفحص None ويُرفض الحذف — وهو عطل يبدو رسالةَ
        صلاحيات صحيحة بينما الملكية قائمة.
        """
        card = DeviceCard.objects.create(device=self.device, uid="786qaaa", label="تفاحة")
        res = self.client.delete(f"/api/devices/{self.device.pk}/cards/{card.pk}/", **self._auth(self.teacher))
        self.assertEqual(res.status_code, 200)
        self.assertFalse(DeviceCard.objects.filter(pk=card.pk).exists())

    def test_another_teacher_cannot_touch_the_cards(self):
        card = DeviceCard.objects.create(device=self.device, uid="786qaaa", label="تفاحة")
        res = self.client.delete(f"/api/devices/{self.device.pk}/cards/{card.pk}/", **self._auth(self.other))
        self.assertIn(res.status_code, (403, 404))
        self.assertTrue(DeviceCard.objects.filter(pk=card.pk).exists())

    def test_a_device_is_not_shared_the_way_a_published_story_is(self):
        """قارئ عتادٌ في غرفة بعينها — لا معنى لظهوره عند معلّمة أخرى."""
        res = self.client.get("/api/devices/", **self._auth(self.other))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["data"]["results"], [])

    # ── الالتقاط ─────────────────────────────────────────────────────────

    def test_binding_a_card(self):
        res = self.client.post(
            f"/api/devices/{self.device.pk}/cards/",
            {"uid": "786qaaa", "label": "تفاحة"},
            content_type="application/json",
            **self._auth(self.teacher),
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(DeviceCard.objects.get(uid="786qaaa").label, "تفاحة")

    def test_rescanning_the_same_card_updates_instead_of_failing(self):
        """
        المعلّمة تمسح البطاقة مرّتين حتماً — مرّة لتربطها ومرّة لتتأكّد.
        رفض الثانية يجعل التصحيح عقوبة، والقيد الفريد كان سيردّ 500.
        """
        for label in ("تفاحة", "موزة"):
            res = self.client.post(
                f"/api/devices/{self.device.pk}/cards/",
                {"uid": "786qaaa", "label": label},
                content_type="application/json",
                **self._auth(self.teacher),
            )
            self.assertIn(res.status_code, (200, 201))

        self.assertEqual(DeviceCard.objects.filter(device=self.device, uid="786qaaa").count(), 1)
        self.assertEqual(DeviceCard.objects.get(uid="786qaaa").label, "موزة")

    def test_a_card_with_no_meaning_is_refused(self):
        """بطاقة بلا معنى تُمسح ولا تفعل شيئاً — عطل صامت أمام صفّ."""
        res = self.client.post(
            f"/api/devices/{self.device.pk}/cards/",
            {"uid": "786qaaa", "label": "   "},
            content_type="application/json",
            **self._auth(self.teacher),
        )
        self.assertEqual(res.status_code, 400)


    def test_rebinding_a_card_that_was_unbound_revives_it(self):
        """
        ⚠️ عطل قِيس فعلياً: المعلّمة تفكّ ارتباط بطاقة ثم تمسحها من جديد.

        الحذف ناعم، والقيد `uniq_device_card_uid` قيدٌ في قاعدة البيانات لا
        يحرّره الحذف الناعم — فالصفّ يحتجز الرقم للأبد وهو غير مرئي لأي
        استعلام. الإدراج يصطدم به فيرمي `IntegrityError`، ويردّ الخادم صفحة
        HTML بدل الغلاف، فتقرأ المعلّمة «استجابة غير مفهومة من الخادم» عن
        بطاقة فكّت ارتباطها هي قبل دقيقة.
        """
        card = DeviceCard.objects.create(device=self.device, uid="87BEC17A", label="nest")
        card.delete()  # فكّ الارتباط — حذف ناعم

        res = self.client.post(
            f"/api/devices/{self.device.pk}/cards/",
            {"uid": "87BEC17A", "label": "nest"},
            content_type="application/json",
            **self._auth(self.teacher),
        )

        self.assertEqual(res.status_code, 200)
        # صفّ واحد أُحيي، لا صفّ ثانٍ.
        self.assertEqual(DeviceCard.all_objects.filter(device=self.device, uid="87BEC17A").count(), 1)
        revived = DeviceCard.objects.get(uid="87BEC17A")
        self.assertIsNone(revived.deleted_at)
        self.assertEqual(revived.pk, card.pk)

    def test_reviving_can_give_the_card_a_new_meaning(self):
        """البطاقة نفسها قد تُعاد لصورة أخرى — الإحياء لا يُعيد المعنى القديم."""
        card = DeviceCard.objects.create(device=self.device, uid="87BEC17A", label="nest")
        card.delete()

        self.client.post(
            f"/api/devices/{self.device.pk}/cards/",
            {"uid": "87BEC17A", "label": "تفاحة"},
            content_type="application/json",
            **self._auth(self.teacher),
        )

        self.assertEqual(DeviceCard.objects.get(uid="87BEC17A").label, "تفاحة")

    def test_a_revived_card_reappears_in_the_bindings_table(self):
        """لا معنى لإحياءٍ لا يصل صفحة العرض."""
        DeviceCard.objects.create(device=self.device, uid="87BEC17A", label="nest").delete()
        self.client.post(
            f"/api/devices/{self.device.pk}/cards/",
            {"uid": "87BEC17A", "label": "nest"},
            content_type="application/json",
            **self._auth(self.teacher),
        )

        res = self.client.get(f"/api/devices/{self.device.pk}/bindings/", **self._auth(self.teacher))
        self.assertEqual(res.json()["data"]["bindings"], {"87BEC17A": "nest"})

    # ── جدول التشغيل ─────────────────────────────────────────────────────

    def test_bindings_returns_only_the_translation_table(self):
        """ما تقرؤه صفحة العرض: ترجمة فقط، بلا اسم جهاز ولا مالكة."""
        DeviceCard.objects.create(device=self.device, uid="786qaaa", label="تفاحة")
        DeviceCard.objects.create(device=self.device, uid="991zbbb", label="موزة")

        res = self.client.get(f"/api/devices/{self.device.pk}/bindings/", **self._auth(self.teacher))

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["data"]["bindings"], {"786qaaa": "تفاحة", "991zbbb": "موزة"})


class DeviceButtonApiTests(TestCase):
    """
    أزرار الصندوق (v1.0.24).

    ما يميّزها عن البطاقة: المعنى **مفردات مغلقة** يفهمها المحرّك، والموضع
    يُقاس بالضغط لا يُفترَض من اللحام.
    """

    def setUp(self):
        self.teacher = User.objects.create_user(email="b1@x.local", password="pw12345678", full_name="م")
        self.other = User.objects.create_user(email="b2@x.local", password="pw12345678", full_name="ن")
        self.device = Device.objects.create(name="صندوق الصف", owner=self.teacher)

    def _auth(self, user):
        return {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}

    def _bind(self, index, role, user=None):
        return self.client.post(
            f"/api/devices/{self.device.pk}/buttons/",
            data={"index": index, "role": role},
            content_type="application/json",
            **self._auth(user or self.teacher),
        )

    def test_pressing_and_naming_binds_a_button(self):
        res = self._bind(1, "up")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(DeviceButton.objects.get(device=self.device, index=1).role, "up")

    def test_a_role_outside_the_vocabulary_is_refused(self):
        """حقلٌ حرّ كان يسمح بـ«أعلى» فلا يتحرّك شيء ولا يقول أحد لماذا."""
        self.assertEqual(self._bind(1, "أعلى").status_code, 400)
        self.assertEqual(self._bind(1, "diagonal").status_code, 400)

    def test_position_starts_at_one(self):
        self.assertEqual(self._bind(0, "up").status_code, 400)

    def test_pressing_the_same_button_again_updates_instead_of_duplicating(self):
        """المعلّمة تضغط الزرّ مرّتين حتماً: مرّة لتربطه ومرّة لتتأكّد."""
        self._bind(2, "down")
        res = self._bind(2, "left")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(DeviceButton.objects.filter(device=self.device, index=2).count(), 1)
        self.assertEqual(DeviceButton.objects.get(device=self.device, index=2).role, "left")

    def test_a_role_moves_rather_than_duplicating(self):
        """زرّان يقولان «فوق» يجعلان أحدهما ميتاً بلا رسالة."""
        self._bind(1, "up")
        self._bind(3, "up")
        roles = list(DeviceButton.objects.filter(device=self.device).values_list("index", "role"))
        self.assertEqual(roles, [(3, "up")])

    def test_an_unbound_button_can_be_bound_again(self):
        """⚠️ الحذف الناعم لا يحرّر قيد قاعدة البيانات — الدرس نفسه المدفوع
        في البطاقات وفي `slug` القصّة."""
        res = self._bind(4, "right")
        button_id = res.json()["data"]["id"]
        self.client.delete(
            f"/api/devices/{self.device.pk}/buttons/{button_id}/", **self._auth(self.teacher)
        )
        again = self._bind(4, "right")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(DeviceButton.objects.filter(device=self.device, index=4).count(), 1)

    def test_owner_can_unbind_her_own_button(self):
        """الزرّ لا يحمل `owner`؛ مالكه مالك جهازه — خاصيّة `owner_id`."""
        button = DeviceButton.objects.create(device=self.device, index=5, role="select")
        res = self.client.delete(
            f"/api/devices/{self.device.pk}/buttons/{button.pk}/", **self._auth(self.teacher)
        )
        self.assertEqual(res.status_code, 200)
        self.assertFalse(DeviceButton.objects.filter(pk=button.pk).exists())

    def test_another_teacher_cannot_bind_buttons(self):
        self.assertIn(self._bind(1, "up", user=self.other).status_code, (403, 404))

    def test_bindings_carries_the_buttons_beside_the_cards(self):
        """طلبٌ ثانٍ وسط حصّة يعني عطلاً ثانياً محتملاً — فالاثنان معاً."""
        DeviceCard.objects.create(device=self.device, uid="AA11", label="تفاحة")
        DeviceButton.objects.create(device=self.device, index=1, role="up")
        res = self.client.get(f"/api/devices/{self.device.pk}/bindings/", **self._auth(self.teacher))
        data = res.json()["data"]
        self.assertEqual(data["bindings"], {"AA11": "تفاحة"})
        self.assertEqual(data["buttons"], {"1": "up"})

    def test_the_device_listing_exposes_its_buttons(self):
        """صفحة العرض تقرأ `/api/devices/` مرّة — فالأزرار فيها."""
        DeviceButton.objects.create(device=self.device, index=2, role="down")
        res = self.client.get("/api/devices/", **self._auth(self.teacher))
        device = res.json()["data"]["results"][0]
        self.assertEqual(device["buttons"], [{"id": device["buttons"][0]["id"], "index": 2, "role": "down",
                                              "updated_at": device["buttons"][0]["updated_at"]}])
