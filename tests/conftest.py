from pathlib import Path

import pytest


@pytest.fixture()
def zork1_z3(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "zork1.z3"
