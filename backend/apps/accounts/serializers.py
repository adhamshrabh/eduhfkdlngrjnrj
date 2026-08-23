"""مُسلسِلات الحسابات."""
from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "role_display", "is_active", "date_joined"]
        read_only_fields = ["id", "date_joined", "role_display"]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "password", "is_active"]

    def create(self, validated_data: dict):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_old_password(self, value: str) -> str:
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("كلمة المرور الحالية غير صحيحة.")
        return value


class LoginSerializer(TokenObtainPairSerializer):
    """يضيف بيانات المستخدم إلى ردّ تسجيل الدخول لتوفير طلب إضافي."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["full_name"] = user.full_name
        return token

    def validate(self, attrs: dict) -> dict:
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
