from expects import expect, contain, be_false


def test_missing_quendor_file(monkeypatch, caplog, zork1_z3) -> None:
    """Generates a warning if a configuration file is not found."""

    from quendor.config import Config
    from quendor.program import Program

    program = Program(zork1_z3)

    def mock_is_file(_) -> bool:
        return False

    monkeypatch.setattr("quendor.config.Path.is_file", mock_is_file)

    config = Config(program.data)

    config._locate()

    expect(caplog.text).to(contain("Unable to locate a .quendor config file"))
    expect(hasattr(config, "_file")).to(be_false)
