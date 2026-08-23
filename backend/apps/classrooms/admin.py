from django.contrib import admin

from .models import Classroom, ClassroomLog


@admin.register(Classroom)
class ClassroomAdmin(admin.ModelAdmin):
    list_display = ["name", "age_group", "children_count", "teacher", "created_at"]
    list_filter = ["teacher", "age_group"]
    search_fields = ["name"]


@admin.register(ClassroomLog)
class ClassroomLogAdmin(admin.ModelAdmin):
    list_display = ["classroom", "activity_type", "story", "game_id", "happened_on", "duration_minutes"]
    list_filter = ["activity_type", "classroom", "happened_on"]
    date_hierarchy = "happened_on"
