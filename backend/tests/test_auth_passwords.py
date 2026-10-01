"""Password hashing and policy. No database and no HTTP."""

from __future__ import annotations

import pytest

from app.services.passwords import (
    ARGON2_MEMORY_COST_KIB,
    ARGON2_PARALLELISM,
    ARGON2_TIME_COST,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    hash_password,
    password_needs_rehash,
    password_policy_errors,
    verify_password,
)

PASSWORD = "Passw0rd123"


def test_a_password_hashes_successfully() -> None:
    stored = hash_password(PASSWORD)

    assert stored
    assert stored != PASSWORD
    # The PHC string must be complete, or another process could not verify it.
    assert stored.startswith("$argon2id$")
    for part in ("m=", "t=", "p=", "v="):
        assert part in stored


def test_the_hash_is_not_the_plaintext() -> None:
    stored = hash_password(PASSWORD)

    assert PASSWORD not in stored
    assert stored.count(PASSWORD) == 0


def test_the_stored_hash_records_the_chosen_cost() -> None:
    """Parameters travel inside the hash, so they can be raised later."""

    stored = hash_password(PASSWORD)

    assert f"m={ARGON2_MEMORY_COST_KIB}" in stored
    assert f"t={ARGON2_TIME_COST}" in stored
    assert f"p={ARGON2_PARALLELISM}" in stored


def test_the_correct_password_verifies() -> None:
    assert verify_password(PASSWORD, hash_password(PASSWORD)) is True


def test_a_wrong_password_fails() -> None:
    assert verify_password("Wr0ngPassw0rd", hash_password(PASSWORD)) is False


def test_a_different_hash_of_the_same_password_verifies() -> None:
    """Salt is random, so two hashes of one password differ but both verify."""

    first = hash_password(PASSWORD)
    second = hash_password(PASSWORD)

    assert first != second
    assert verify_password(PASSWORD, first) is True
    assert verify_password(PASSWORD, second) is True


@pytest.mark.parametrize(
    "stored",
    [
        "",
        "not-a-hash",
        "$argon2id$broken",
        "$argon2i$v=19$m=19456,t=2,p=1$onlyonesalt",
        "$2b$12$abcdefghijklmnopqrstuv",
        "x" * 500,
    ],
)
def test_a_malformed_hash_fails_safely(stored: str) -> None:
    """A corrupt row is a failed verification, never a 500 and never a match."""

    assert verify_password(PASSWORD, stored) is False


def test_a_hash_from_another_algorithm_still_verifies_correctly() -> None:
    """A stored Argon2i hash must not be accepted as if it were Argon2id's.

    argon2-cffi will verify a hash of another variant, which is deliberate: it is
    how a future migration re-hashes on login. The check that matters is that
    the *password* still has to be right.
    """

    from argon2 import PasswordHasher, Type

    legacy = PasswordHasher(
        time_cost=1, memory_cost=8, parallelism=1, type=Type.I
    ).hash(PASSWORD)

    assert verify_password("Wr0ngPassw0rd", legacy) is False


def test_needs_rehash_is_false_for_a_current_hash() -> None:
    assert password_needs_rehash(hash_password(PASSWORD)) is False


def test_needs_rehash_is_true_for_a_corrupt_hash() -> None:
    assert password_needs_rehash("not-a-hash") is True


# --- policy -----------------------------------------------------------------


@pytest.mark.parametrize(
    "password", ["Passw0rd123", "abcdefg1", "1234567a", "a1" + "b" * 126]
)
def test_a_compliant_password_has_no_errors(password: str) -> None:
    assert password_policy_errors(password) == []


def test_a_short_password_is_rejected() -> None:
    assert any("at least" in problem for problem in password_policy_errors("Ab1"))


def test_a_password_with_no_letter_is_rejected() -> None:
    assert any("letter" in problem for problem in password_policy_errors("12345678"))


def test_a_password_with_no_digit_is_rejected() -> None:
    assert any("number" in problem for problem in password_policy_errors("abcdefgh"))


def test_an_over_long_password_is_rejected() -> None:
    too_long = "a1" + "b" * PASSWORD_MAX_LENGTH
    assert any("at most" in problem for problem in password_policy_errors(too_long))


def test_every_broken_rule_is_reported_not_just_the_first() -> None:
    """The client renders one message per rule, so all of them are returned.

    An empty string breaks three of the four rules at once, so it is the case
    that proves the function reports rather than short-circuits.
    """

    problems = password_policy_errors("")
    assert len(problems) == 3
    assert any("at least" in p for p in problems)
    assert any("letter" in p for p in problems)
    assert any("number" in p for p in problems)


def test_the_policy_matches_the_mobile_checklist() -> None:
    """Parity with `src/lib/passwordRules.ts`, which asserts the same numbers."""

    assert PASSWORD_MIN_LENGTH == 8
    assert PASSWORD_MAX_LENGTH == 128


def test_unicode_letters_and_digits_satisfy_the_policy() -> None:
    """The client matches \\p{L} and \\p{Nd}; `str` methods must agree.

    A password the checklist calls valid but the server rejects is the worst kind
    of mismatch, so a Devanagari or Arabic character must count as a letter here
    exactly as it does on the phone. Each sample is at least eight characters so
    the length rule is not what is being tested.
    """

    assert password_policy_errors("पासवर्ड१२") == []  # Devanagari + Devanagari digits
    assert password_policy_errors("كلمة1234") == []  # Arabic + ASCII digits
    assert password_policy_errors("Пароль12") == []  # Cyrillic + ASCII digits
