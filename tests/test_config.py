from expects import expect, contain, be_false, be_true


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


def test_read_quendor_file(monkeypatch, zork1_z3, quendor_config) -> None:
    """Read a configuration file."""

    from unittest.mock import mock_open, patch
    from quendor.config import Config
    from quendor.program import Program

    program = Program(zork1_z3)

    def mock_is_file(_) -> bool:
        return True

    monkeypatch.setattr("quendor.config.Path.is_file", mock_is_file)

    config_mock = mock_open(read_data=quendor_config)

    with patch("quendor.config.open", config_mock):
        config = Config(program.data)
        config.read()

    expect(config._contents).to(contain(quendor_config))
    expect(hasattr(config, "_file")).to(be_true)
