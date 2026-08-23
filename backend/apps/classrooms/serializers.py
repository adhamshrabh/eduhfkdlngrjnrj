from rest_framework import serializers

from .models import Classroom, ClassroomLog


class ClassroomSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True)
    log_count = serializers.SerializerMethodField()

    class Meta:
        model = Classroom
        fields = ["id", "name", "age_group", "children_count", "teacher", "teacher_name", "log_count", "created_at"]
        read_only_fields = ["id", "teacher_name", "log_count", "created_at"]

    def get_log_count(self, obj: Classroom) -> int:
        return obj.logs.count()


class ClassroomLogSerializer(serializers.ModelSerializer):
    classroom_name = serializers.CharField(source="classroom.name", read_only=True)
    story_title = serializers.CharField(source="story.title", read_only=True, default="")
    activity_display = serializers.CharField(source="get_activity_type_display", read_only=True)

    class Meta:
        model = ClassroomLog
        fields = [
            "id", "classroom", "classroom_name", "activity_type", "activity_display",
            "story", "story_title", "game_id", "happened_on", "duration_minutes",
            "notes", "recorded_by", "created_at",
        ]
        read_only_fields = ["id", "recorded_by", "classroom_name", "story_title", "activity_display", "created_at"]
