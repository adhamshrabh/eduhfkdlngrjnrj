"""مساعد لبناء الاستجابة الموحّدة."""
from typing import Any

from rest_framework.response import Response


def ok(data: Any = None, message: str = "", status: int = 200) -> Response:
    return Response({"data": data, "error": None, "message": message}, status=status)


def fail(error: Any, message: str, status: int = 400) -> Response:
    return Response({"data": None, "error": error, "message": message}, status=status)
