"""نقاط نهاية الحسابات."""
from django.contrib.auth import get_user_model
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .permissions import IsAdmin
from .response import ok
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    UserCreateSerializer,
    UserSerializer,
)

User = get_user_model()


class LoginView(TokenObtainPairView):
    """POST /api/auth/login/ — يُرجع access + refresh + بيانات المستخدم."""

    permission_classes = [AllowAny]
    serializer_class = LoginSerializer


class MeView(APIView):
    """GET /api/auth/me/ — المستخدم الحالي."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request):
        return ok(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    """POST /api/auth/change-password/"""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        return ok(message="تم تغيير كلمة المرور.")


class UserViewSet(viewsets.ModelViewSet):
    """إدارة المستخدمين — للمديرة فقط."""

    queryset = User.objects.all()
    permission_classes = [IsAdmin]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["role", "is_active"]
    search_fields = ["full_name", "email"]

    def get_serializer_class(self):
        return UserCreateSerializer if self.action == "create" else UserSerializer

    def list(self, request: Request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        data = self.get_serializer(page, many=True).data
        return ok({"results": data, "count": self.paginator.page.paginator.count})

    def retrieve(self, request: Request, *args, **kwargs):
        return ok(self.get_serializer(self.get_object()).data)

    def create(self, request: Request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return ok(serializer.data, "تم إنشاء الحساب.", status=201)

    def update(self, request: Request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return ok(serializer.data, "تم التحديث.")

    def destroy(self, request: Request, *args, **kwargs):
        """تعطيل بدل الحذف — لا نفقد ارتباط المعلّمة بقصصها وصفوفها."""
        user = self.get_object()
        user.is_active = False
        user.save(update_fields=["is_active"])
        return ok(message="تم تعطيل الحساب.")

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request: Request, pk: str | None = None):
        user = self.get_object()
        new_password = request.data.get("new_password", "")
        if len(new_password) < 8:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"new_password": "كلمة المرور يجب ألّا تقل عن 8 محارف."})
        user.set_password(new_password)
        user.save(update_fields=["password"])
        return ok(message="تم تعيين كلمة مرور جديدة.")
