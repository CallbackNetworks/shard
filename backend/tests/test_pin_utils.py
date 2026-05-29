from app.services.pin_utils import check_pin, hash_pin


def test_hash_pin_format():
    result = hash_pin("1234")
    assert ":" in result
    salt, h = result.split(":", 1)
    assert len(salt) == 32  # 16 bytes hex
    assert len(h) == 64  # sha256 hex


def test_hash_pin_different_salts():
    h1 = hash_pin("1234")
    h2 = hash_pin("1234")
    assert h1 != h2  # random salt means different outputs


def test_check_pin_correct():
    stored = hash_pin("5678")
    assert check_pin("5678", stored) is True


def test_check_pin_wrong():
    stored = hash_pin("5678")
    assert check_pin("9999", stored) is False


def test_check_pin_malformed_stored():
    assert check_pin("1234", "not-a-valid-hash") is False


def test_check_pin_empty_stored():
    assert check_pin("1234", "") is False
