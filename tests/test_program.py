from expects import expect, equal, be_a

import pytest


def test_get_data_from_program(zork1_z3) -> None:
    """Reads binary data from zcode program."""

    from quendor.program import Program

    program = Program(zork1_z3)

    expect(program.data).to(be_a(bytes))
    expect(program._format.name).to(equal("ZCODE"))


def test_read_valid_blorb(zork1_blorb) -> None:
    """Reads binary data from blorb program."""

    from quendor.program import Program

    program = Program(zork1_blorb)

    expect(program.data).to(be_a(bytes))
    expect(program._format.name).to(equal("BLORB"))
    expect(len(program.blorbs)).to(equal(1))


def test_read_valid_zcode_and_resource(zenspeak_program, zenspeak_resource) -> None:
    """Reads binary data from blorb program."""

    from quendor.app import App

    cli = {"program-file": zenspeak_program, "resource-file": zenspeak_resource}

    terp = App(cli)
    terp._setup_quendor()

    expect(terp.program.data).to(be_a(bytes))
    expect(len(terp.program.blorbs)).to(equal(1))


def test_zcode_and_blorb_byte_equivalency(zork1_z1, zork1_blorb) -> None:
    """Reads the same data whether blorbed or unblorbed."""

    from quendor.program import Program

    program = Program(zork1_z1)
    zcode_data = program.data

    program = Program(zork1_blorb)
    blorb_data = program.data

    expect(zcode_data).to(equal(blorb_data))


def test_program_configuration_with_filled_in_defaults(
    zork1_z3, quendor_config_file
) -> None:
    """Uses program-specific and default values to provide a full configuration."""

    from quendor.app import App
    from quendor.config import Config

    cli = {"program-file": zork1_z3, "resource-file": ""}

    terp = App(cli)
    terp._setup_quendor()

    config = Config(terp.program.data)
    config._file = quendor_config_file

    config.read()
    config.set_program_id()

    default_config = config.get_values(config.get_defaults())
    terp._program_config = config.get_values(config.get_program_id())

    for key in terp._program_config:
        if terp._program_config[key] == "":
            terp._program_config[key] = default_config[key]

    expect(terp._program_config).to(
        equal(
            {
                "title": "Zork I: The Great Underground Empire",
                "width": "1024",
                "height": "768",
                "blorb": "",
                "terpnum": "",
            }
        )
    )


def test_program_configuration_with_filled_in_defaults_with_blorb(
    arthur_zcode, quendor_config_file
) -> None:
    """Includes program-specific blorb as part of full configuration."""

    from quendor.app import App
    from quendor.config import Config

    cli = {"program-file": arthur_zcode, "resource-file": ""}

    terp = App(cli)
    terp._setup_quendor()

    config = Config(terp.program.data)
    config._file = quendor_config_file

    config.read()
    config.set_program_id()

    default_config = config.get_values(config.get_defaults())
    terp._program_config = config.get_values(config.get_program_id())

    for key in terp._program_config:
        if terp._program_config[key] == "":
            terp._program_config[key] = default_config[key]

    expect(terp._program_config).to(
        equal(
            {
                "title": "Arthur: The Quest for Excalibur",
                "width": "1024",
                "height": "768",
                "blorb": "arthur.blb",
                "terpnum": "",
            }
        )
    )


def test_get_program_configuration_missing_blorb(arthur_zcode) -> None:
    """Raises an exception if a blorb from the configuration cannot be located."""

    from quendor.app import App
    from quendor.errors import UnableToLocateResourceError

    cli = {"program-file": arthur_zcode, "resource-file": ""}

    terp = App(cli)
    terp._setup_quendor()
    terp._read_config()

    terp._program_config = {
        "title": "Arthur: The Quest for Excalibur",
        "width": "640",
        "height": "400",
        "blorb": "arthur1.blb",
        "terpnum": "",
    }

    terp.program.blorbs = []

    with pytest.raises(UnableToLocateResourceError):
        terp._read_blorb_config()


def test_blorb_configuration_in_blorbs_list(
    arthur_zcode, quendor_config_file, arthur_resource
) -> None:
    """Puts program-specific blorb in configuration in blorb list."""

    from quendor.app import App
    from quendor.blorb import Blorb
    from quendor.config import Config
    from pathlib import Path

    cli = {"program-file": arthur_zcode, "resource-file": ""}

    terp = App(cli)
    terp._setup_quendor()

    config = Config(terp.program.data)
    config._file = quendor_config_file

    config.read()
    config.set_program_id()

    default_config = config.get_values(config.get_defaults())
    terp._program_config = config.get_values(config.get_program_id())

    for key in terp._program_config:
        if terp._program_config[key] == "":
            terp._program_config[key] = default_config[key]

    resource_file = arthur_resource
    terp.program.blorbs.append(Blorb(Path(resource_file).read_bytes()))

    expect(len(terp.program.blorbs)).to(equal(1))


def test_handle_duplicate_blorb_resources(
    arthur_zcode, arthur_resource, quendor_config_file
) -> None:
    """Makes sure only one valid blorb resource is included."""

    from quendor.app import App
    from quendor.blorb import Blorb
    from quendor.config import Config
    from pathlib import Path

    cli = {"program-file": arthur_zcode, "resource-file": arthur_resource}

    terp = App(cli)
    terp._setup_quendor()

    config = Config(terp.program.data)
    config._file = quendor_config_file

    config.read()
    config.set_program_id()

    default_config = config.get_values(config.get_defaults())
    terp._program_config = config.get_values(config.get_program_id())

    for key in terp._program_config:
        if terp._program_config[key] == "":
            terp._program_config[key] = default_config[key]

    resource_file = arthur_resource
    terp.program.blorbs.append(Blorb(Path(resource_file).read_bytes()))

    expect(len(terp.program.blorbs)).to(equal(2))

    terp._check_blorb_list()

    expect(len(terp.program.blorbs)).to(equal(1))
