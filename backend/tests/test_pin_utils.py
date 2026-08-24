"""A share PIN is hashed with a KDF, and the old format still verifies.

The compatibility half is the part worth guarding: share PINs exist in deployed
databases, and ``check_pin`` cannot rewrite them, so dropping the legacy format
would lock owners out of their own live share links.
"""

import hashlib

from app.services.pin_utils import ALGORITHM, ITERATIONS, check_pin, hash_pin, needs_rehash


def _legacy_hash(pin: str, salt: str = "0123456789abcdef") -> str:
    """The pre-KDF format: one round of salted SHA-256."""
    return f"{salt}:{hashlib.sha256(f'{salt}:{pin}'.encode()).hexdigest()}"


class TestTheCurrentFormat:
    def test_is_self_describing(self):
        algorithm, iterations, salt, digest = hash_pin("1234").split("$")
        assert algorithm == ALGORITHM
        assert int(iterations) == ITERATIONS
        assert len(salt) == 32
        assert len(digest) == 64

    def test_salts_every_hash(self):
        assert hash_pin("1234") != hash_pin("1234")

    def test_accepts_the_right_pin(self):
        assert check_pin("5678", hash_pin("5678")) is True

    def test_rejects_the_wrong_pin(self):
        assert check_pin("9999", hash_pin("5678")) is False


class TestTheLegacyFormat:
    """Deployed rows predate the KDF and must keep working."""

    def test_still_accepts_the_right_pin(self):
        assert check_pin("5678", _legacy_hash("5678")) is True

    def test_still_rejects_the_wrong_pin(self):
        assert check_pin("9999", _legacy_hash("5678")) is False


class TestMalformedInputIsRefused:
    def test_not_a_hash_at_all(self):
        assert check_pin("1234", "not-a-valid-hash") is False

    def test_empty(self):
        assert check_pin("1234", "") is False

    def test_current_format_with_a_junk_cost(self):
        assert check_pin("1234", f"{ALGORITHM}$abc$deadbeef$cafe") is False

    def test_current_format_truncated(self):
        assert check_pin("1234", f"{ALGORITHM}$1000") is False


class TestRehashDetection:
    def test_a_fresh_hash_is_current(self):
        assert needs_rehash(hash_pin("1234")) is False

    def test_a_legacy_hash_needs_upgrading(self):
        assert needs_rehash(_legacy_hash("1234")) is True

    def test_a_weaker_cost_needs_upgrading(self):
        salt = "0" * 32
        weak = hashlib.pbkdf2_hmac("sha256", b"1234", salt.encode(), 1000).hex()
        assert needs_rehash(f"{ALGORITHM}$1000${salt}${weak}") is True

    def test_a_stronger_cost_is_left_alone(self):
        # Raising ITERATIONS must not make already-stronger hashes churn.
        salt = "0" * 32
        strong = hashlib.pbkdf2_hmac("sha256", b"1234", salt.encode(), ITERATIONS * 2).hex()
        assert needs_rehash(f"{ALGORITHM}${ITERATIONS * 2}${salt}${strong}") is False

    def test_garbage_needs_upgrading(self):
        assert needs_rehash("not-a-hash") is True


class TestTheCostIsRealTheHashIsNot:
    """A four-digit PIN is not strong; the KDF only makes sweeping it slow."""

    def test_a_weaker_cost_still_verifies_so_old_links_keep_working(self):
        salt = "0" * 32
        weak = hashlib.pbkdf2_hmac("sha256", b"4321", salt.encode(), 1000).hex()
        stored = f"{ALGORITHM}$1000${salt}${weak}"
        assert check_pin("4321", stored) is True
        assert needs_rehash(stored) is True
