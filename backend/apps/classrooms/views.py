"""نقاط نهاية الصفوف ودفتر الصف."""
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.request import Request

from apps.accounts.response import ok

from .models import Classroom, ClassroomLog
from .serializers import ClassroomLogSerializer, ClassroomSerializer


class ClassroomViewSet(viewsets.ModelViewSet):
    serializer_class = ClassroomSerializer

    def get_queryset(self):
        qs = Classroom.objects.select_related("teacher")
        user = self.request.user
        if user.is_authenticated and not user.is_admin_role:
            qs = qs.filter(teacher=user)
        return qs

    def perform_create(self, serializer):
        # المعلّمة لا تستطيع إنشاء صف باسم معلّمة أخرى.
        user = self.request.user
        teacher = serializer.validated_data.get("teacher")
        serializer.save(teacher=teacher if user.is_admin_role and teacher else user)

    def list(self, request: Request, *args, **kwargs):
        return ok(self.get_serializer(self.filter_queryset(self.get_queryset()), many=True).data)

    def retrieve(self, request: Request, *args, **kwargs):
        return ok(self.get_serializer(self.get_object()).data)

    def create(self, request: Request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return ok(serializer.data, "تم إنشاء الصف.", 201)

    def destroy(self, request: Request, *args, **kwargs):
        self.get_object().delete()
        return ok(message="تم حذف الصف.")

    @action(detail=True, methods=["get"])
    def summary(self, request: Request, pk: str | None = None):
        """ملخّص آخر أسبوع — ما يظهر في لوحة المعلّمة."""
        classroom = self.get_object()
        since = timezone.localdate() - timedelta(days=7)
        logs = classroom.logs.filter(happened_on__gte=since)
        by_type = {row["activity_type"]: row["n"] for row in logs.values("activity_type").annotate(n=Count("id"))}
        return ok(
            {
                "classroom": classroom.name,
                "since": since,
                "total_sessions": logs.count(),
                "total_minutes": sum(logs.values_list("duration_minutes", flat=True)),
                "by_type": by_type,
                "recent": ClassroomLogSerializer(logs[:10], many=True).data,
            }
        )


class ClassroomLogViewSet(viewsets.ModelViewSet):
    serializer_class = ClassroomLogSerializer
    filterset_fields = ["classroom", "activity_type", "happened_on"]

    def get_queryset(self):
        qs = ClassroomLog.objects.select_related("classroom", "story")
        user = self.request.user
        if user.is_authenticated and not user.is_admin_role:
            qs = qs.filter(classroom__teacher=user)
        return qs

    def list(self, request: Request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return ok({"results": self.get_serializer(page, many=True).data, "count": self.paginator.page.paginator.count})

    def create(self, request: Request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(recorded_by=request.user)
        return ok(serializer.data, "تم التسجيل في الدفتر.", 201)

    def destroy(self, request: Request, *args, **kwargs):
        self.get_object().delete()
        return ok(message="تم الحذف.")
