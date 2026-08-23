"""نقاط نهاية القصص والأصول — البديل الكامل لوسيط `/__editor/*`."""

import base64
import binascii
import re

from django.core.files.base import ContentFile
from django.db import transaction
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.permissions import IsAuthenticated

from apps.accounts.permissions import IsOwnerOrAdmin
from apps.accounts.response import ok

from .models import Story, StoryAsset
from .serializers import (
    StoryAssetSerializer,
    StoryDetailSerializer,
    StoryListSerializer,
    StoryWriteSerializer,
)

SAFE_NAME = re.compile(r"[^\w.\-؀-ۿ]+")


def _safe_filename(name: str) -> str:
    """يسمح بالعربية والأرقام والشرطات فقط — ويمنع أي محاولة اجتياز مسار."""
    cleaned = SAFE_NAME.sub("_", (name or "asset").strip()).lstrip(".")
    return cleaned[:120] or "asset"


class StoryViewSet(viewsets.ModelViewSet):
    """
    GET    /api/stories/                 قائمة القصص
    POST   /api/stories/                 إنشاء قصة
    GET    /api/stories/{slug}/          قراءة قصة كاملة
    PATCH  /api/stories/{slug}/          حفظ (مع فحص النسخة)
    DELETE /api/stories/{slug}/          حذف ناعم
    GET    /api/stories/{slug}/validate/ فحص سلامة مراجع الأصول
    """

    lookup_field = "slug"
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["is_published", "owner"]
    # يبحث بالعنوان والوصف معاً — كافٍ لمكتبة قصص روضة، لا حاجة لفهرسة
    # نص كامل (full-text search) بهذا الحجم من المحتوى.
    search_fields = ["title", "description"]

    def get_queryset(self):
        user = self.request.user
        # دفاع مضاعف: الصلاحية تمنع الزائر، وهذا يضمن ألّا يتسرّب صفّ واحد
        # حتى لو أُسيء ضبط الصلاحيات مستقبلاً.
        if not (user and user.is_authenticated):
            return Story.objects.none()

        qs = Story.objects.select_related("owner").prefetch_related("assets")
        # المعلّمة ترى قصصها + كل ما هو منشور؛ المديرة ترى كل شيء.
        if not user.is_admin_role:
            from django.db.models import Q

            qs = qs.filter(Q(owner=user) | Q(is_published=True))
        return qs

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return StoryWriteSerializer
        if self.action == "list":
            return StoryListSerializer
        return StoryDetailSerializer

    def list(self, request: Request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return ok({"results": self.get_serializer(page, many=True).data, "count": self.paginator.page.paginator.count})

    def retrieve(self, request: Request, *args, **kwargs):
        return ok(self.get_serializer(self.get_object()).data)

    def create(self, request: Request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        story = serializer.save(owner=request.user)
        return ok(StoryDetailSerializer(story, context=self.get_serializer_context()).data, "تم إنشاء القصة.", 201)

    def update(self, request: Request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        story = self.get_object()

        # فحص النسخة: يمنع معلّمتين من الكتابة فوق بعضهما بصمت.
        # العميل يرسل النسخة التي قرأها؛ إن تقدّمت النسخة على الخادم رُفض الحفظ.
        client_version = request.data.get("version")
        if client_version is not None and int(client_version) != story.version:
            raise ValidationError(
                {
                    "version": (
                        f"القصة عُدّلت من مكان آخر (نسختك {client_version}، "
                        f"النسخة الحالية {story.version}). أعيدي التحميل قبل الحفظ."
                    )
                }
            )

        serializer = self.get_serializer(story, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            story = serializer.save()
            Story.objects.filter(pk=story.pk).update(version=story.version + 1)
            story.refresh_from_db()
        return ok(StoryDetailSerializer(story, context=self.get_serializer_context()).data, "تم الحفظ.")

    def destroy(self, request: Request, *args, **kwargs):
        story = self.get_object()
        story.delete()  # حذف ناعم
        return ok(message="تم حذف القصة.")

    @action(detail=True, methods=["get"])
    def validate(self, request: Request, slug: str | None = None):
        """
        يقارن الأسماء المستعارة التي تشير إليها القصة بالأصول المرفوعة فعلاً.

        هذا يُمسك أشهر عطل عند المعلّمة: مشهد يشير إلى صورة حُذفت أو أُعيدت
        تسميتها، فيظهر فارغاً أثناء العرض أمام الصف دون رسالة خطأ.
        """
        story = self.get_object()
        available = set(story.assets.values_list("alias", flat=True))
        referenced: set[str] = set()

        def walk(node) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if key in ("alias", "background", "showObject", "showCharacter") and isinstance(value, str):
                        referenced.add(value)
                    walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(story.story_json)
        missing = sorted(referenced - available)
        unused = sorted(available - referenced)
        return ok(
            {"missing": missing, "unused": unused, "ok": not missing},
            "كل المراجع سليمة." if not missing else f"{len(missing)} مرجع مفقود.",
        )


class StoryAssetViewSet(viewsets.ModelViewSet):
    """
    POST   /api/stories/{story_slug}/assets/            رفع أصل (ملف أو base64)
    PATCH  /api/stories/{story_slug}/assets/{asset_id}/ إعادة تسمية الاسم المستعار
    DELETE /api/stories/{story_slug}/assets/{asset_id}/ حذف ناعم
    """

    serializer_class = StoryAssetSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    lookup_field = "asset_id"

    def _get_story(self) -> Story:
        story = Story.objects.filter(slug=self.kwargs["story_slug"]).first()
        if story is None:
            from rest_framework.exceptions import NotFound

            raise NotFound("القصة غير موجودة.")
        self.check_object_permissions(self.request, story)
        return story

    def get_queryset(self):
        user = self.request.user
        if not (user and user.is_authenticated):
            return StoryAsset.objects.none()
        return StoryAsset.objects.filter(story__slug=self.kwargs["story_slug"])

    def list(self, request: Request, *args, **kwargs):
        return ok(self.get_serializer(self.get_queryset(), many=True).data)

    def create(self, request: Request, *args, **kwargs):
        story = self._get_story()
        alias = (request.data.get("alias") or "").strip()
        if not alias:
            raise ValidationError({"alias": "الاسم المستعار مطلوب."})
        if StoryAsset.objects.filter(story=story, alias=alias).exists():
            raise ValidationError({"alias": f"الاسم المستعار «{alias}» مستخدم في هذه القصة."})

        kind = request.data.get("kind") or StoryAsset.Kind.IMAGE
        upload = request.FILES.get("file")

        if upload is None:
            # مسار base64 — يقابل /__editor/upload-base64 القديم
            raw = request.data.get("data_url") or request.data.get("base64") or ""
            if not raw:
                raise ValidationError({"file": "أرسلي ملفاً أو حقل data_url."})
            if "," in raw:
                raw = raw.split(",", 1)[1]
            try:
                content = base64.b64decode(raw, validate=True)
            except (binascii.Error, ValueError):
                raise ValidationError({"data_url": "ترميز base64 غير صالح."})
            filename = _safe_filename(request.data.get("filename") or f"{alias}.png")
            upload = ContentFile(content, name=filename)
        else:
            upload.name = _safe_filename(upload.name)

        asset = StoryAsset.objects.create(
            story=story,
            asset_id=StoryAsset.next_asset_id(story),
            alias=alias,
            kind=kind,
            file=upload,
            original_name=getattr(upload, "name", ""),
            size_bytes=getattr(upload, "size", 0) or 0,
            # المسار الذي ستكتبه القصة في story.json — يبقى ثابتاً حتى لو
            # أُعيدت تسمية الاسم المستعار لاحقاً.
            content_path=f"assets/{kind}/{getattr(upload, 'name', alias)}",
        )
        return ok(self.get_serializer(asset).data, "تم رفع الأصل.", 201)

    def update(self, request: Request, *args, **kwargs):
        self._get_story()
        asset = self.get_object()
        alias = (request.data.get("alias") or "").strip()
        if not alias:
            raise ValidationError({"alias": "الاسم المستعار مطلوب."})
        if StoryAsset.objects.filter(story=asset.story, alias=alias).exclude(pk=asset.pk).exists():
            raise ValidationError({"alias": f"الاسم المستعار «{alias}» مستخدم بالفعل."})
        asset.alias = alias
        asset.save(update_fields=["alias", "updated_at"])
        return ok(self.get_serializer(asset).data, "تمت إعادة التسمية.")

    def destroy(self, request: Request, *args, **kwargs):
        self._get_story()
        asset = self.get_object()
        asset.delete()  # حذف ناعم — الملف يبقى على القرص، والمرجع يمكن استرجاعه
        return ok(message="تم حذف الأصل.")
