"""نقطة نهاية واحدة تستقبل نتائج كل الألعاب — لا مسار خاص بكل لعبة."""
from django.db.models import Avg, Count, Sum
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request

from apps.accounts.response import ok

from .models import GameSession
from .serializers import GameSessionSerializer


class GameSessionViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet
):
    serializer_class = GameSessionSerializer
    filterset_fields = ["classroom", "game_id"]

    def get_queryset(self):
        qs = GameSession.objects.select_related("classroom")
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
        serializer.save(started_by=request.user)
        return ok(serializer.data, "تم تسجيل الجلسة.", 201)

    @action(detail=False, methods=["get"])
    def stats(self, request: Request):
        """أكثر الألعاب استخداماً — يظهر في لوحة المديرة."""
        rows = (
            self.get_queryset()
            .values("game_id", "game_title")
            .annotate(sessions=Count("id"), total_minutes=Sum("duration_seconds"), avg_items=Avg("completed_items"))
            .order_by("-sessions")
        )
        data = [
            {
                "game_id": r["game_id"],
                "game_title": r["game_title"],
                "sessions": r["sessions"],
                "total_minutes": round((r["total_minutes"] or 0) / 60),
                "avg_items": round(r["avg_items"] or 0, 1),
            }
            for r in rows
        ]
        return ok(data)
