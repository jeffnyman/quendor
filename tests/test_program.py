from expects import expect, equal, be_a


def test_get_data_from_program(zork1_z3) -> None:
    """Reads binary data from zcode program."""

    from quendor.program import Program

    program = Program(zork1_z3)

    expect(program._data).to(be_a(bytes))
    expect(program._format.name).to(equal("ZCODE"))


def test_read_valid_blorb(zork1_blorb) -> None:
    """Reads binary data from blorb program."""

    from quendor.program import Program

    program = Program(zork1_blorb)

    expect(program._data).to(be_a(bytes))
    expect(program._format.name).to(equal("BLORB"))
    expect(len(program.blorbs)).to(equal(1))


def test_read_valid_zcode_and_resource(zenspeak_program, zenspeak_resource) -> None:
    """Reads binary data from blorb program."""

    from quendor.startup import setup_quendor

    cli = {"program": zenspeak_program, "resource-file": zenspeak_resource}

    program = setup_quendor(cli)

    expect(program._data).to(be_a(bytes))
    expect(len(program.blorbs)).to(equal(1))


def test_zcode_and_blorb_byte_equivalency(zork1_z1, zork1_blorb) -> None:
    """Reads the same data whether blorbed or unblorbed."""

    from quendor.program import Program

    program = Program(zork1_z1)
    zcode_data = program._data

    program = Program(zork1_blorb)
    blorb_data = program._data

    expect(zcode_data).to(equal(blorb_data))
