import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from analytics import main


class Response:
    def __init__(self, status_code, payload, claim_role="subadmin"):
        self.status_code = status_code
        self.payload = payload
        self.claim_role = claim_role

    def raise_for_status(self):
        if self.status_code >= 400:
            raise main.httpx.HTTPStatusError("mock response error", request=None, response=None)

    def json(self):
        if isinstance(self.payload, dict) and self.payload.get("id") == "synthetic-user":
            return {**self.payload, "app_metadata": {"role": self.claim_role}}
        return self.payload


class FakeClient:
    def __init__(self, role_rows=None, user_status=200, role_status=200, claim_role="subadmin"):
        self.role_rows = role_rows if role_rows is not None else [{
            "user_type": "subadmin", "role": "subadmin", "is_active": True,
        }]
        self.user_status = user_status
        self.role_status = role_status
        self.claim_role = claim_role
        self.requests = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, url, headers):
        self.requests.append(("GET", url, headers))
        return Response(self.user_status, {"id": "synthetic-user"}, self.claim_role)

    def post(self, url, headers, json):
        self.requests.append(("POST", url, headers, json))
        return Response(self.role_status, self.role_rows)


class AnalyticsApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()

    def test_health_reports_service_without_exposing_configuration(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertNotIn("SUPABASE_ANON_KEY", response.text)

    def test_forecast_requires_bearer_staff_session(self):
        response = self.client.post("/forecast", json={"daily_visitors": [2, 3]})
        self.assertEqual(response.status_code, 401)

    def test_book_recommendations_require_visitor_authentication(self):
        response = self.client.post('/recommendations/books', json={'books': [], 'searches': []})
        self.assertEqual(response.status_code, 401)

    def test_book_recommendations_use_history_and_exclude_unavailable_or_active_books(self):
        main.app.dependency_overrides[main.require_active_visitor] = lambda: 'visitor'
        books = [
            {'id': 'past', 'title': 'Ocean fish', 'category': 'Marine science', 'available': True, 'borrowed': True, 'active': True},
            {'id': 'related', 'title': 'Ocean wildlife', 'category': 'Marine science', 'available': True},
            {'id': 'other', 'title': 'Space travel', 'category': 'Astronomy', 'available': True, 'popularity': 100},
            {'id': 'unavailable', 'title': 'Ocean life', 'category': 'Marine science', 'available': False},
        ]
        response = self.client.post('/recommendations/books', json={'books': books, 'searches': ['ocean']})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['source'], 'ai')
        self.assertEqual(response.json()['bookIds'][0], 'related')
        self.assertNotIn('past', response.json()['bookIds'])
        self.assertNotIn('unavailable', response.json()['bookIds'])
        response = self.client.post('/recommendations/books', json={'books': books[1:], 'searches': []})
        self.assertEqual(response.json()['source'], 'popular')
        self.assertEqual(response.json()['bookIds'][0], 'other')

    def test_recommendation_authorization_rejects_inactive_and_staff_accounts(self):
        for rows in [[{'user_type': 'visitor', 'is_active': False}], [{'user_type': 'subadmin', 'is_active': True}]]:
            with self.subTest(rows=rows), patch.dict(os.environ, {'SUPABASE_URL': 'https://example.invalid', 'SUPABASE_ANON_KEY': 'public-test-key'}), patch.object(main.httpx, 'Client', return_value=FakeClient(role_rows=rows)):
                with self.assertRaises(HTTPException) as error:
                    main.require_active_visitor(HTTPAuthorizationCredentials(scheme='Bearer', credentials='synthetic'))
                self.assertEqual(error.exception.status_code, 403)

    def test_book_recommendations_return_distinct_titles_across_branches(self):
        main.app.dependency_overrides[main.require_active_visitor] = lambda: 'visitor'
        books = [
            {'id': 'a', 'title': 'The Sea', 'author': 'A Writer', 'available': True, 'popularity': 20},
            {'id': 'b', 'title': ' the  sea ', 'author': 'a writer', 'available': True, 'popularity': 19},
            {'id': 'c', 'title': 'Stars', 'author': 'Another', 'available': True, 'popularity': 18},
            {'id': 'd', 'title': 'The Sea', 'author': 'Different Author', 'available': True, 'popularity': 17},
            {'id': 'e', 'title': 'Forest', 'author': 'Another', 'available': True, 'popularity': 16},
        ]
        response = self.client.post('/recommendations/books', json={'books': books, 'searches': []})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['bookIds'], ['a', 'c', 'd', 'e'])

    def test_forecast_rejects_invalid_request(self):
        main.app.dependency_overrides[main.require_active_staff] = lambda: "subadmin"
        response = self.client.post(
            "/forecast?timeframe=invalid",
            headers={"Authorization": "Bearer synthetic"},
            json={"daily_visitors": [], "horizon_days": 500},
        )
        self.assertEqual(response.status_code, 422)

    def test_forecast_accepts_selected_week_and_year(self):
        main.app.dependency_overrides[main.require_active_staff] = lambda: "subadmin"
        with patch.object(main, "generate_gemini_analytics", return_value=main.GeminiAnalytics()):
            for timeframe, days in [("weekly", 7), ("annual", 366), ("custom", 7)]:
                with self.subTest(timeframe=timeframe):
                    response = self.client.post(
                        f"/forecast?timeframe={timeframe}",
                        json={"daily_visitors": [1] * days, "categories": [{"category": "Fiction", "weekly_demand": [2]}], "horizon_days": 7, "forecast_start_date": "2026-02-01"},
                    )
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()["timeframe"], timeframe)
                    self.assertEqual(len(response.json()["forecasts"]), 7)

    def test_staff_authorization_accepts_active_aal2_role_from_supabase_rpc(self):
        fake_client = FakeClient()
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.invalid", "SUPABASE_ANON_KEY": "public-test-key"}), \
             patch.object(main.httpx, "Client", return_value=fake_client):
            role = main.require_active_staff(HTTPAuthorizationCredentials(scheme="Bearer", credentials="synthetic-token"))
        self.assertEqual(role, "subadmin")
        self.assertEqual(fake_client.requests[0][2]["Authorization"], "Bearer synthetic-token")
        self.assertEqual(fake_client.requests[1][1], "https://example.invalid/rest/v1/rpc/get_current_user_role")

    def test_staff_authorization_rejects_visitor_and_inactive_profiles(self):
        for row in [
            {"user_type": "visitor", "role": "visitor", "is_active": True},
            {"user_type": "subadmin", "role": "subadmin", "is_active": False},
        ]:
            with self.subTest(row=row), \
                 patch.dict(os.environ, {"SUPABASE_URL": "https://example.invalid", "SUPABASE_ANON_KEY": "public-test-key"}), \
                 patch.object(main.httpx, "Client", return_value=FakeClient(role_rows=[row])):
                with self.assertRaises(HTTPException) as error:
                    main.require_active_staff(HTTPAuthorizationCredentials(scheme="Bearer", credentials="synthetic-token"))
                self.assertEqual(error.exception.status_code, 403)

    def test_supabase_auth_failure_is_rejected(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.invalid", "SUPABASE_ANON_KEY": "public-test-key"}), \
             patch.object(main.httpx, "Client", return_value=FakeClient(user_status=401)):
            with self.assertRaises(HTTPException) as error:
                main.require_active_staff(HTTPAuthorizationCredentials(scheme="Bearer", credentials="expired-token"))
        self.assertEqual(error.exception.status_code, 401)

    def test_staff_authorization_rejects_non_tls_remote_endpoint(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "http://supabase.example", "SUPABASE_ANON_KEY": "public-test-key"}):
            with self.assertRaises(HTTPException) as error:
                main.require_active_staff(HTTPAuthorizationCredentials(scheme="Bearer", credentials="synthetic-token"))
        self.assertEqual(error.exception.status_code, 503)

    def test_missing_invalid_or_mismatched_role_claim_is_rejected(self):
        for claim_role, rpc_rows in [
            (None, [{"user_type": "subadmin", "role": "subadmin", "is_active": True}]),
            ("visitor", [{"user_type": "visitor", "role": "visitor", "is_active": True}]),
            ("superadmin", [{"user_type": "subadmin", "role": "subadmin", "is_active": True}]),
        ]:
            with self.subTest(claim_role=claim_role), \
                 patch.dict(os.environ, {"SUPABASE_URL": "https://example.invalid", "SUPABASE_ANON_KEY": "public-test-key"}), \
                 patch.object(main.httpx, "Client", return_value=FakeClient(role_rows=rpc_rows, claim_role=claim_role)):
                with self.assertRaises(HTTPException) as error:
                    main.require_active_staff(HTTPAuthorizationCredentials(scheme="Bearer", credentials="synthetic-token"))
                self.assertEqual(error.exception.status_code, 403)

    def test_forecast_returns_numerical_fallback_when_gemini_is_unavailable(self):
        main.app.dependency_overrides[main.require_active_staff] = lambda: "subadmin"
        with patch.object(main, "generate_gemini_analytics", side_effect=HTTPException(status_code=503, detail="unavailable")):
            response = self.client.post(
                "/forecast?timeframe=7d",
                headers={"Authorization": "Bearer synthetic-token"},
                json={"daily_visitors": [4, 5, 7], "horizon_days": 2},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["analyticsSource"], "fallback")
        self.assertEqual(len(response.json()["forecasts"]), 2)


if __name__ == "__main__":
    unittest.main()
