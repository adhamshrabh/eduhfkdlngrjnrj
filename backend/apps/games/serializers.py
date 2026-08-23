from rest_framework import serializers

from .models import GameSession


class GameSessionSerializer(serializers.ModelSerializer):
    classroom_name = serializers.CharField(source="classroom.name", read_only=True)
    completion_percent = serializers.IntegerField(read_only=True)

    class Meta:
        model = GameSession
        fields = [
            "id", "classroom", "classroom_name", "game_id", "game_title",
            "duration_seconds", "completed_items", "total_items",
            "completion_percent", "started_by", "created_at",
        ]
        read_only_fields = ["id", "started_by", "classroom_name", "completion_percent", "created_at"]
