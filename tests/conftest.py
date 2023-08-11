from pathlib import Path

import pytest


@pytest.fixture()
def zork1_z3(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "zork1.z3"


@pytest.fixture()
def glulx_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "adventure.ulx"


@pytest.fixture()
def aif_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "resource.aif"
