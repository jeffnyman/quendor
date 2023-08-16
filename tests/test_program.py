from expects import expect, equal, be_a


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

    from quendor.startup import setup_quendor

    cli = {"program": zenspeak_program, "resource-file": zenspeak_resource}

    program = setup_quendor(cli)

    expect(program.data).to(be_a(bytes))
    expect(len(program.blorbs)).to(equal(1))


def test_zcode_and_blorb_byte_equivalency(zork1_z1, zork1_blorb) -> None:
    """Reads the same data whether blorbed or unblorbed."""

    from quendor.program import Program

    program = Program(zork1_z1)
    zcode_data = program.data

    program = Program(zork1_blorb)
    blorb_data = program.data

    expect(zcode_data).to(equal(blorb_data))


def test_program_configuration_with_filled_in_defaults(zork1_z3) -> None:
    """Uses program-specific and default values to provide a full configuration."""

    from quendor.program import Program
    from quendor.startup import read_config

    program = Program(zork1_z3)
    program_config = read_config(program)

    expect(program_config).to(
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


def test_program_configuration_with_filled_in_defaults_with_blorb(arthur_zcode) -> None:
    """Includes program-specific blorb as part of full configuration."""

    from quendor.program import Program
    from quendor.startup import read_config

    program = Program(arthur_zcode)
    program_config = read_config(program)

    expect(program_config).to(
        equal(
            {
                "title": "Arthur: The Quest for Excalibur",
                "width": "640",
                "height": "400",
                "blorb": "arthur.blb",
                "terpnum": "",
            }
        )
    )


def test_get_program_configuration_missing_blorb(arthur_zcode) -> None:
    """Raises an exception if a blorb from the configuration cannot be located."""

    import pytest
    from quendor.program import Program
    from quendor.startup import read_config, read_blorb_config
    from quendor.errors import UnableToLocateResourceError

    program = Program(arthur_zcode)
    program_config = read_config(program)
    program_config = {
        "title": "Arthur: The Quest for Excalibur",
        "width": "640",
        "height": "400",
        "blorb": "arthur1.blb",
        "terpnum": "",
    }

    program.blorbs = []

    with pytest.raises(UnableToLocateResourceError):
        read_blorb_config(program_config, program.blorbs)
