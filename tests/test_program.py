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
        equal(["Zork I: The Great Underground Empire", 1024, 768, "", ""])
    )
