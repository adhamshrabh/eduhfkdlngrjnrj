from django.contrib import admin

from .models import GameSession


@admin.register(GameSession)
class GameSessionAdmin(admin.ModelAdmin):
    list_display = ["game_title", "game_id", "classroom", "duration_seconds", "completion_percent", "created_at"]
    list_filter = ["game_id", "classroom"]
    date_hierarchy = "created_at"
