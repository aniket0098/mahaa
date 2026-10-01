"""Password hashing and the password policy.

Argon2id via ``argon2-cffi``, which is the reference-binding Python
implementation and is actively maintained.

**Parameters** — ``m=19456 KiB (19 MiB), t=2, p=1`` — are the OWASP Password
Storage Cheat Sheet's *minimum* Argon2id configuration. They were measured on the
development machine, not assumed:

    m=19456, t=2, p=1  ->  ~75 ms per hash/verify
    m=65536, t=3, p=2  -> ~189 ms  (the 64 MiB alternative)
    m=32768, t=3, p=1  -> ~175 ms

The 19 MiB setting is chosen over the stronger 64 MiB one because the target is a
Render **Free** instance: 64 MiB per concurrent hash, times a handful of
simultaneous sign-ins, is a real risk of memory exhaustion on a small shared
container, and Argon2's memory cost is per-hash. 19 MiB keeps the cost at the
documented secure floor while leaving headroom. The parameters are recorded in
the PHC-encoded hash itself, so raising them later re-hashes on next login
without a migration.

Argon2id specifically (not Argon2i/Argon2d) because it is the hybrid variant
recommended for password hashing: it resists both side-channel and GPU-cracking
attacks.
"""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type

#: OWASP minimum Argon2id cost. See the module docstring for the measurements.
ARGON2_MEMORY_COST_KIB = 19456
ARGON2_TIME_COST = 2
ARGON2_PARALLELISM = 1
ARGON2_HASH_LENGTH = 32
ARGON2_SALT_LENGTH = 16

#: Mirrors ``src/lib/passwordRules.ts`` on the mobile client (min 8, max 128, at
#: least one letter, at least one digit). The client and the server must agree:
#: if the server were laxer, the app would promise a password the API rejects,
#: and if it were stricter, it would reject one the checklist said was fine.
#: The server stays authoritative — this is where the rule is actually enforced.
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128

_hasher = PasswordHasher(
    time_cost=ARGON2_TIME_COST,
    memory_cost=ARGON2_MEMORY_COST_KIB,
    parallelism=ARGON2_PARALLELISM,
    hash_len=ARGON2_HASH_LENGTH,
    salt_len=ARGON2_SALT_LENGTH,
    type=Type.ID,
)


def password_policy_errors(password: str) -> list[str]:
    """Every rule the password breaks, phrased for the person choosing it.

    Returns a list rather than raising so the schema can attach one message per
    broken rule to the ``password`` field, which is what the client renders
    inline next to the input.
    """

    problems: list[str] = []
    if len(password) < PASSWORD_MIN_LENGTH:
        problems.append(f"Password must be at least {PASSWORD_MIN_LENGTH} characters.")
    if len(password) > PASSWORD_MAX_LENGTH:
        # Argon2 itself has no such limit; this one is about not spending server
        # CPU and memory hashing an unbounded input.
        problems.append(f"Password must be at most {PASSWORD_MAX_LENGTH} characters.")
    # `str.isalpha` and the digit test mirror the client's Unicode-aware \p{L}
    # and \p{Nd} checks, so the checklist can never promise a password the
    # server will reject.
    if not any(character.isalpha() for character in password):
        problems.append("Password must include at least one letter.")
    if not any(character.isdigit() for character in password):
        problems.append("Password must include at least one number.")
    return problems


def hash_password(password: str) -> str:
    """Hash a password for storage.

    The returned value is the complete PHC string, e.g.::

        $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>

    The parameters travel *inside* the hash, which is why raising the cost later
    is a re-hash on next login rather than a migration. The plaintext is never
    stored, logged, or returned.
    """

    return _hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    """Check a password against a stored hash. Never raises.

    A malformed, truncated, or empty stored hash is a *failed verification*, not
    an exception: a corrupt row must not turn a sign-in attempt into a 500, and
    it must not be reported as a match either.
    """

    if not stored_hash:
        return False
    try:
        _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def password_needs_rehash(stored_hash: str) -> bool:
    """True when a stored hash was made with weaker parameters than current.

    Lets a future phase upgrade hashes transparently on the next successful
    sign-in instead of forcing everyone to change their password.
    """

    try:
        return _hasher.check_needs_rehash(stored_hash)
    except (InvalidHashError, VerificationError):
        return True
