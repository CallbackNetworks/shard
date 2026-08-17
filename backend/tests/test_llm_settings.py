"""Tests for app.services.llm_settings: DB-override resolution and best-effort
model verification (ADR-0096, ADR-0097)."""

from unittest.mock import MagicMock, patch

from app.services import llm_settings


class TestEffectiveConfig:
    def test_db_override_beats_env_for_every_field(self, db):
        with patch.dict(
            "os.environ",
            {"LLM_PROVIDER": "openai", "LLM_MODEL": "env-model", "LLM_API_KEY": "env-key", "LLM_BASE_URL": "env-url"},
            clear=False,
        ):
            llm_settings.update(
                db, {"provider": "claude", "model": "db-model", "api_key": "db-key", "base_url": "db-url"}
            )
            config = llm_settings.get_effective_llm_config(db)
            assert config == {"provider": "claude", "model": "db-model", "api_key": "db-key", "base_url": "db-url"}

    def test_empty_string_override_falls_back_to_env_for_every_field(self, db):
        with patch.dict(
            "os.environ",
            {"LLM_PROVIDER": "openai", "LLM_MODEL": "env-model", "LLM_API_KEY": "env-key", "LLM_BASE_URL": "env-url"},
            clear=False,
        ):
            llm_settings.update(
                db, {"provider": "claude", "model": "db-model", "api_key": "db-key", "base_url": "db-url"}
            )
            llm_settings.update(db, {"provider": "", "model": "", "api_key": "", "base_url": ""})
            config = llm_settings.get_effective_llm_config(db)
            assert config == {"provider": "openai", "model": "env-model", "api_key": "env-key", "base_url": "env-url"}

    def test_base_url_is_not_a_credential(self, db):
        llm_settings.update(db, {"base_url": "https://gateway.example/v1"})
        body = llm_settings.read(db)
        assert body["llm_base_url"] == "https://gateway.example/v1"


class TestModelCheck:
    def test_no_check_when_model_not_part_of_the_write(self, db):
        result = llm_settings.update(db, {"provider": "claude"})
        assert "model_check" not in result

    def test_unchecked_when_no_api_key_is_configured(self, db):
        result = llm_settings.update(db, {"provider": "claude", "model": "claude-sonnet-4-6"})
        assert result["model_check"] == {"checked": False, "ok": None, "detail": None}

    def test_unchecked_when_the_provider_is_stub(self, db):
        result = llm_settings.update(db, {"provider": "stub", "model": "whatever", "api_key": "x"})
        assert result["model_check"] == {"checked": False, "ok": None, "detail": None}

    def test_unchecked_when_the_sdk_package_is_not_installed(self, db):
        """The dev/prod image does not install anthropic/openai by default (ADR-0096) —
        that must degrade to "unverified", never crash the write."""
        with patch.dict("sys.modules", {"anthropic": None}):
            result = llm_settings.update(db, {"provider": "claude", "model": "claude-sonnet-4-6", "api_key": "sk-x"})
        assert result["model_check"]["checked"] is False
        assert result["model_check"]["ok"] is None
        assert "could not verify" in result["model_check"]["detail"]

    def test_ok_true_when_the_model_is_in_the_providers_list(self, db):
        mock_openai = MagicMock()
        model = MagicMock()
        model.id = "gpt-5"
        mock_openai.OpenAI.return_value.models.list.return_value = [model]
        with patch.dict("sys.modules", {"openai": mock_openai}):
            result = llm_settings.update(db, {"provider": "openai", "model": "gpt-5", "api_key": "sk-x"})
        assert result["model_check"] == {"checked": True, "ok": True, "detail": None}

    def test_ok_false_when_the_model_is_not_in_the_providers_list(self, db):
        mock_openai = MagicMock()
        model = MagicMock()
        model.id = "gpt-5"
        mock_openai.OpenAI.return_value.models.list.return_value = [model]
        with patch.dict("sys.modules", {"openai": mock_openai}):
            result = llm_settings.update(db, {"provider": "openai", "model": "gpt-nope", "api_key": "sk-x"})
        assert result["model_check"]["checked"] is True
        assert result["model_check"]["ok"] is False
        assert "gpt-nope" in result["model_check"]["detail"]

    def test_a_provider_error_degrades_to_unchecked_not_a_failed_save(self, db):
        mock_openai = MagicMock()
        mock_openai.OpenAI.return_value.models.list.side_effect = RuntimeError("connection refused")
        with patch.dict("sys.modules", {"openai": mock_openai}):
            result = llm_settings.update(db, {"provider": "openai", "model": "gpt-5", "api_key": "sk-x"})
        assert result["model_check"]["checked"] is False
        assert result["llm_provider"] == "openai"
        assert result["llm_model"] == "gpt-5"

    def test_verification_uses_the_configured_base_url(self, db):
        mock_openai = MagicMock()
        mock_openai.OpenAI.return_value.models.list.return_value = []
        with patch.dict("sys.modules", {"openai": mock_openai}):
            llm_settings.update(
                db,
                {
                    "provider": "openai",
                    "model": "local-model",
                    "api_key": "sk-x",
                    "base_url": "https://gateway.example/v1",
                },
            )
        mock_openai.OpenAI.assert_called_with(api_key="sk-x", base_url="https://gateway.example/v1")
