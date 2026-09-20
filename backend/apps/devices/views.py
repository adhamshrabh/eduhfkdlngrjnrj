"""نقاط نهاية الأجهزة والبطاقات."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request

from apps.accounts.permissions import IsOwnerOrAdmin
from apps.accounts.response import ok

from .models import Device, DeviceButton, DeviceCard
from .serializers import DeviceButtonSerializer, DeviceCardSerializer, DeviceSerializer


class DeviceViewSet(viewsets.ModelViewSet):
    """
    GET    /api/devices/                  أجهزة المعلّمة
    POST   /api/devices/                  إضافة قارئ
    PATCH  /api/devices/{id}/             تعديل الاسم أو العنوان
    DELETE /api/devices/{id}/             حذف ناعم
    GET    /api/devices/{id}/bindings/    جدول الترجمة الجاهز للتشغيل
    """

    serializer_class = DeviceSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]

    def get_queryset(self):
        user = self.request.user
        if not (user and user.is_authenticated):
            return Device.objects.none()
        # الجهاز عتاد في غرفة بعينها — لا يُشارَك كما تُشارَك قصّة منشورة.
        # المديرة ترى كل شيء لأنها من تُشخّص حين لا يعمل القارئ.
        qs = Device.objects.prefetch_related("cards")
        return qs if user.is_admin_role else qs.filter(owner=user)

    def list(self, request: Request, *args, **kwargs):
        return ok({"results": self.get_serializer(self.get_queryset(), many=True).data})

    def retrieve(self, request: Request, *args, **kwargs):
        return ok(self.get_serializer(self.get_object()).data)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def create(self, request: Request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return ok(serializer.data, "تم إضافة الجهاز.", 201)

    def update(self, request: Request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object(), data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return ok(serializer.data, "تم الحفظ.")

    def destroy(self, request: Request, *args, **kwargs):
        self.get_object().delete()  # حذف ناعم
        return ok(message="تم حذف الجهاز.")

    @action(detail=True, methods=["get"])
    def bindings(self, request: Request, pk: str | None = None):
        """
        جدول `uid → label` وحده، بلا أي حقل آخر.

        منفصل عن `retrieve` عمداً: هذا ما تقرؤه **صفحة العرض** عند بدء
        الحصّة، وهي أضيق مستهلك في المنصّة — تحتاج الترجمة ولا تحتاج اسم
        الجهاز ولا مالكته ولا طوابعه. إبقاؤه صغيراً يعني أن انقطاع الشبكة
        وسط حصّة يجد استجابةً واحدة صغيرة في الذاكرة المؤقّتة، لا وثيقة.
        """
        device = self.get_object()
        return ok(
            {
                "bindings": {c.uid: c.label for c in device.cards.all()},
                # الأزرار بجوارها لا في نقطةٍ ثانية: صفحة العرض تقرأ هذا مرّة
                # عند بدء الحصّة، وطلبٌ ثانٍ يعني عطلاً ثانياً محتملاً وسطها.
                "buttons": {b.index: b.role for b in device.buttons.all()},
            }
        )


class DeviceCardViewSet(viewsets.ModelViewSet):
    """
    GET    /api/devices/{device_pk}/cards/        بطاقات الجهاز
    POST   /api/devices/{device_pk}/cards/        ربط بطاقة بمعنى
    PATCH  /api/devices/{device_pk}/cards/{id}/   إعادة تسمية المعنى
    DELETE /api/devices/{device_pk}/cards/{id}/   فكّ الارتباط
    """

    serializer_class = DeviceCardSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]

    def _get_device(self) -> Device:
        device = Device.objects.filter(pk=self.kwargs["device_pk"]).first()
        if device is None:
            raise NotFound("الجهاز غير موجود.")
        self.check_object_permissions(self.request, device)
        return device

    def get_queryset(self):
        user = self.request.user
        if not (user and user.is_authenticated):
            return DeviceCard.objects.none()
        return DeviceCard.objects.filter(device__pk=self.kwargs["device_pk"])

    def list(self, request: Request, *args, **kwargs):
        self._get_device()
        return ok(self.get_serializer(self.get_queryset(), many=True).data)

    def create(self, request: Request, *args, **kwargs):
        device = self._get_device()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # ── إعادة المسح تُحدِّث ولا تُضاعف — والمحذوفة تُحيا ──────────────
        #
        # المعلّمة تمسح البطاقة نفسها مرّتين حتماً: مرّة لتربطها، ومرّة
        # لتتأكّد أنها ربطت الصحيحة. رفض الثانية برسالة «مستخدمة بالفعل»
        # يجعل التصحيح عقوبة.
        #
        # ⚠️ و`all_objects` لا `objects`: القيد `uniq_device_card_uid` قيدٌ
        # في قاعدة البيانات، والحذف الناعم لا يحرّره — فبطاقةٌ فُكّ ارتباطها
        # تبقى محتجزةً للأبد بصفٍّ لا يراه أي استعلام عادي. النتيجة المقيسة:
        # `IntegrityError` وصفحة HTML بدل الغلاف، فتقرأ المعلّمة «استجابة غير
        # مفهومة من الخادم» عن بطاقة فكّت ارتباطها هي قبل دقيقة.
        #
        # وهو العطل نفسه الذي وقع في `slug` القصّة ووُثّق في
        # `apps/stories/views.py`. والحلّ نفسه — إحياءٌ لا رفض: من فكّت
        # الارتباط ثم أعادت المسح تطلب حرفياً إعادة الربط.
        uid = serializer.validated_data["uid"]
        label = serializer.validated_data["label"]

        existing = DeviceCard.all_objects.filter(device=device, uid=uid).first()
        if existing is not None:
            revived = existing.deleted_at is not None
            existing.label = label
            existing.deleted_at = None
            existing.save(update_fields=["label", "deleted_at", "updated_at"])
            return ok(
                self.get_serializer(existing).data,
                "تم ربط البطاقة." if revived else "حُدِّث معنى البطاقة.",
            )

        card = serializer.save(device=device)
        return ok(self.get_serializer(card).data, "تم ربط البطاقة.", 201)

    def update(self, request: Request, *args, **kwargs):
        self._get_device()
        card = self.get_object()
        label = (request.data.get("label") or "").strip()
        if not label:
            raise ValidationError({"label": "المعنى مطلوب."})
        card.label = label
        card.save(update_fields=["label", "updated_at"])
        return ok(self.get_serializer(card).data, "تمت إعادة التسمية.")

    def destroy(self, request: Request, *args, **kwargs):
        self._get_device()
        self.get_object().delete()
        return ok(message="فُكّ ارتباط البطاقة.")


class DeviceButtonViewSet(viewsets.ModelViewSet):
    """
    GET    /api/devices/{device_pk}/buttons/        أزرار الجهاز
    POST   /api/devices/{device_pk}/buttons/        ربط زرّ بدور
    DELETE /api/devices/{device_pk}/buttons/{id}/   فكّ الارتباط

    لا `PATCH`: إعادة التسمية هنا **هي** إعادة الضغط. المعلّمة تضغط الزرّ
    وتختار دوره، وإن أخطأت ضغطته ثانيةً واختارت غيره — فـ`create` يُحدِّث.
    """

    serializer_class = DeviceButtonSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]

    def _get_device(self) -> Device:
        device = Device.objects.filter(pk=self.kwargs["device_pk"]).first()
        if device is None:
            raise NotFound("الجهاز غير موجود.")
        self.check_object_permissions(self.request, device)
        return device

    def get_queryset(self):
        user = self.request.user
        if not (user and user.is_authenticated):
            return DeviceButton.objects.none()
        return DeviceButton.objects.filter(device__pk=self.kwargs["device_pk"])

    def list(self, request: Request, *args, **kwargs):
        self._get_device()
        return ok(self.get_serializer(self.get_queryset(), many=True).data)

    def create(self, request: Request, *args, **kwargs):
        device = self._get_device()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        index = serializer.validated_data["index"]
        role = serializer.validated_data["role"]

        # ── دورٌ واحد لكل زرّ، وزرٌّ واحد لكل دور ────────────────────────
        #
        # الثاني لا يحرسه قيدٌ في قاعدة البيانات لأنه ليس خطأً في البيانات بل
        # في المعنى: زرّان يقولان «فوق» يجعلان أحدهما ميتاً بلا رسالة. فمن
        # أسندت «فوق» إلى زرٍّ آخر تكون قد **نقلته**، لا أنشأت ثانياً.
        DeviceButton.objects.filter(device=device, role=role).exclude(index=index).delete()

        # ⚠️ `all_objects` لا `objects`: القيد `uniq_device_button_index` قيدٌ
        # في قاعدة البيانات، والحذف الناعم لا يحرّره — فزرٌّ فُكّ ارتباطه يبقى
        # محتجزاً للأبد. الدرس نفسه المدفوع في `DeviceCard` و`slug` القصّة.
        existing = DeviceButton.all_objects.filter(device=device, index=index).first()
        if existing is not None:
            existing.role = role
            existing.deleted_at = None
            existing.save(update_fields=["role", "deleted_at", "updated_at"])
            return ok(self.get_serializer(existing).data, "تم ربط الزرّ.")

        button = serializer.save(device=device)
        return ok(self.get_serializer(button).data, "تم ربط الزرّ.", 201)

    def destroy(self, request: Request, *args, **kwargs):
        self._get_device()
        self.get_object().delete()
        return ok(message="فُكّ ارتباط الزرّ.")
