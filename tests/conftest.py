from pathlib import Path

import pytest


@pytest.fixture()
def zork1_z3(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "zork1.z3"


@pytest.fixture()
def zork1_blorb(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "zork1.zblorb"


@pytest.fixture()
def zork1_blorb_bytes(zork1_blorb: Path) -> bytes:
    return Path(zork1_blorb).read_bytes()


@pytest.fixture()
def glulx_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "adventure.ulx"


@pytest.fixture()
def aif_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "resource.aif"


@pytest.fixture()
def invalid_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "invalid.z1"
