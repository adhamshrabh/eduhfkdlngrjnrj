from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ClassroomLogViewSet, ClassroomViewSet

router = DefaultRouter()
router.register("logs", ClassroomLogViewSet, basename="classroom-log")
router.register("", ClassroomViewSet, basename="classroom")

urlpatterns = [path("", include(router.urls))]
