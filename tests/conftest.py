from pathlib import Path

import pytest


@pytest.fixture()
def zork1_z1(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "zork1.z1"


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
def zenspeak_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "zenspeak.z5"


@pytest.fixture()
def zenspeak_resource(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "zenspeak.blb"


@pytest.fixture()
def zenspeak_blorb_bytes(zenspeak_resource) -> bytes:
    return Path(zenspeak_resource).read_bytes()


@pytest.fixture()
def shogun_zcode(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "shogun.z6"


@pytest.fixture()
def shogun_resource(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "shogun.blb"


@pytest.fixture()
def arthur_zcode(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "arthur.z6"


@pytest.fixture()
def arthur_resource(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "arthur.blb"


@pytest.fixture()
def glulx_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "adventure.ulx"


@pytest.fixture()
def aif_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "resource.aif"


@pytest.fixture()
def invalid_program(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "invalid.z1"


@pytest.fixture()
def invalid_zblorb(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / "invalid.zblorb"


@pytest.fixture()
def invalid_zblorb_bytes(invalid_zblorb: Path) -> bytes:
    return Path(invalid_zblorb).read_bytes()


@pytest.fixture()
def airport_blorb_bytes(pytestconfig) -> bytes:
    program = pytestconfig.rootdir / "tests" / "fixtures" / "airport.gblorb"

    return Path(program).read_bytes()


@pytest.fixture()
def quendor_config_file(pytestconfig) -> Path:
    return pytestconfig.rootdir / "tests" / "fixtures" / ".quendor"


@pytest.fixture()
def quendor_config() -> str:
    return """
    width: 1024
    height: 768

    title: Unknown Program

    %%

    id: 88.840726
    title: Zork I: The Great Underground Empire

    %%

    id: 41.890504 74.890714
    title: Arthur: The Quest for Excalibur
    blorb: arthur.blb
    """
