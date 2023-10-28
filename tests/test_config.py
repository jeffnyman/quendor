from expects import expect, contain, be_none, be_true


def test_missing_quendor_file(monkeypatch, caplog, zork1_z3) -> None:
    """Generates a warning if a configuration file is not found."""

    from quendor.config import Config
    from quendor.program import Program

    program = Program(zork1_z3)

    def mock_is_file(_) -> bool:
        return False

    monkeypatch.setattr("quendor.config.Path.is_file", mock_is_file)

    config = Config(program.data)

    config.locate()

    expect(caplog.text).to(contain("Unable to locate a .quendor config file"))
    expect(config._file).to(be_none)


def test_read_quendor_file(zork1_z3, quendor_config_file) -> None:
    """Read a configuration file."""

    from quendor.config import Config
    from quendor.program import Program

    program = Program(zork1_z3)

    config = Config(program.data)
    config._file = quendor_config_file

    config.read()

    quendor_config_text = quendor_config_file.read_text(encoding="utf-8")

    expect(config._contents).to(contain(quendor_config_text))
    expect(hasattr(config, "_file")).to(be_true)


def test_get_defaults(zork1_z3, quendor_config) -> None:
    """Reads the defaults from the configuration file."""

    from quendor.config import Config
    from quendor.program import Program

    program = Program(zork1_z3)
    config = Config(program.data)

    config._contents = quendor_config

    defaults = config.get_defaults()

    expected_defaults = """
        width: 1024
        height: 768

        title: Unknown Program

        %%
        """

    expected_defaults = "\n".join(
        line.lstrip() for line in expected_defaults.split("\n")
    )
    defaults = "\n".join(line.lstrip() for line in defaults.split("\n"))

    expect(defaults).to(contain(expected_defaults))


def test_set_program_id_for_config(zork1_z3) -> None:
    """Sets the program id for the config based on program data."""

    from quendor.config import Config
    from quendor.program import Program

    program = Program(zork1_z3)
    config = Config(program.data)

    config.set_program_id()

    expect(config._identifier).to(contain("88.840726"))


def test_get_program_based_on_id(zork1_z3, quendor_config) -> None:
    """Reads the defaults from the configuration file."""

    from quendor.config import Config
    from quendor.program import Program

    program = Program(zork1_z3)
    config = Config(program.data)

    config._contents = quendor_config

    program_id = config.get_program_id()

    expected_program = """
        id: 88.840726
        title: Zork I: The Great Underground Empire
        """

    expected_program = expected_program.strip()
    expected_program = "\n".join(line.lstrip() for line in expected_program.split("\n"))

    program_id = program_id.strip()
    program_id = "\n".join(line.lstrip() for line in program_id.split("\n"))

    expect(program_id).to(contain(expected_program))
