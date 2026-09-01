"""The version this process is running, read from the one file that declares it.

A self-hoster reporting a problem has to be able to say which version they are on, and
until this existed there was no way to ask: no tag, no changelog, no endpoint, and an
image tagged `selfhost` that means "whatever the checkout was". The number itself lived
in ``pyproject.toml`` and reached nothing at runtime.

It is read from ``pyproject.toml`` rather than copied into a constant here, because a
constant beside the file that already declares the version is a second copy, and the
copy that is wrong is always the one nobody is looking at. ``Dockerfile.prod`` does
``COPY . .``, so the file is in the image.
"""

import tomllib
from functools import lru_cache
from pathlib import Path

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"

# What a build that cannot read its own metadata reports. Not an exception: the version
# is a support convenience, and no request is worth failing over it.
UNKNOWN = "unknown"


@lru_cache(maxsize=1)
def version() -> str:
    try:
        with PYPROJECT.open("rb") as fh:
            return tomllib.load(fh)["project"]["version"]
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        return UNKNOWN
