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
