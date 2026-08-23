from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import GameSessionViewSet

router = DefaultRouter()
router.register("sessions", GameSessionViewSet, basename="game-session")

urlpatterns = [path("", include(router.urls))]
