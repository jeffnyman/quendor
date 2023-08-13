from expects import expect, equal, contain

import pytest


def test_package_version() -> None:
    """Current version is exposed on the package."""

    from quendor import __version__

    expect(__version__).to(equal("0.1.0"))


def test_load_program(capsys, zork1_z3) -> None:
    """Loads a zcode program."""

    from quendor import __version__
    from quendor.__main__ import main

    main([str(zork1_z3)])

    captured = capsys.readouterr()
    result = captured.out

    banner_text = f"Quendor Z-Machine Interpreter (version: {__version__})"
    expect(result).to(contain(banner_text))


def test_load_program_with_resource(
    capsys, zenspeak_program, zenspeak_resource
) -> None:
    """Loads a zcode program and a resource."""

    from quendor import __version__
    from quendor.__main__ import main

    main([str(zenspeak_program), str(zenspeak_resource)])

    captured = capsys.readouterr()
    result = captured.out

    banner_text = f"Quendor Z-Machine Interpreter (version: {__version__})"
    expect(result).to(contain(banner_text))


def test_bad_python_version(monkeypatch, capsys) -> None:
    """Checks if Python version requirement is met."""

    import sys
    from quendor.startup import check_python_version

    monkeypatch.setattr(sys, "version_info", (3, 7, 9))

    with pytest.raises(SystemExit):
        check_python_version()

    captured = capsys.readouterr()
    result = captured.err

    error_text = "Quendor requires Python 3.8.2 or later."
    expect(result).to(contain(error_text))


def test_version_display(capsys) -> None:
    """Reports its version."""

    from quendor.cli import process_arguments

    with pytest.raises(SystemExit):
        process_arguments(["-v"])

    captured = capsys.readouterr()
    result = captured.out

    verison_text = "Version: 0.1.0"
    expect(result).to(contain(verison_text))


def test_handle_invalid_log_level(capsys) -> None:
    """Indicates when an invalid log level is specified."""

    from quendor.__main__ import main

    with pytest.raises(SystemExit):
        main(["--log", "LOTS"])

    captured = capsys.readouterr()
    result = captured.err

    error_text = "invalid choice: 'LOTS'"
    expect(result).to(contain(error_text))


def test_handle_invalid_arguments(capsys) -> None:
    """Indicates when an invalid argument is provided."""

    from quendor.__main__ import main

    with pytest.raises(SystemExit):
        main(["program.z3", "--invalid"])

    captured = capsys.readouterr()
    result = captured.err

    error_text = "unrecognized arguments: --invalid"
    expect(result).to(contain(error_text))


def test_generate_logs(caplog) -> None:
    """Displays logs based on log levels."""

    import logging
    from quendor.startup import setup_logging, display_arguments

    with caplog.at_level(logging.DEBUG):
        setup_logging("DEBUG")
        display_arguments({"log": "DEBUG"})

    expect(caplog.text).to(contain("Argument count", "Parsed arguments"))


def test_no_program_provided(capsys) -> None:
    """Indicates when a program has not been provided."""

    from quendor.__main__ import main

    with pytest.raises(SystemExit):
        main()

    captured = capsys.readouterr()
    result = captured.err

    error_text = "the following arguments are required: program"
    expect(result).to(contain(error_text))


def test_unable_to_locate_program() -> None:
    """Raises an exception when a program can't be located."""

    from quendor.__main__ import main
    from quendor.errors import UnableToLocateProgramError

    with pytest.raises(UnableToLocateProgramError) as exc_info:
        main(["program.z3"])

    error_text = "Unable to locate the program: program.z3"
    expect(str(exc_info.value)).to(contain(error_text))


def test_unable_to_locate_resource(zenspeak_program) -> None:
    """Raises an exception when a resource can't be located."""

    from quendor.__main__ import main
    from quendor.errors import UnableToLocateResourceError

    with pytest.raises(UnableToLocateResourceError) as exc_info:
        main([str(zenspeak_program), "invalid.blb"])

    error_text = "Unable to locate the resource: invalid.blb"
    expect(str(exc_info.value)).to(contain(error_text))


def test_unable_to_access_program(tmp_path, zork1_z3) -> None:
    """Raises an exception when a program can't be accessed."""

    import shutil
    from quendor.program import Program
    from quendor.errors import UnableToAccessProgramError

    program = Program(zork1_z3)

    inaccessible = tmp_path / "inaccessible"
    program._file = inaccessible

    inaccessible.mkdir()

    error_text = f"Unable to access the program: {inaccessible.name}"

    with pytest.raises(UnableToAccessProgramError, match=error_text):
        program._read_data()

    shutil.rmtree(inaccessible)


def test_unable_to_interpret_glulx(glulx_program) -> None:
    """Raises an exception when a program is in the Glulx format."""

    from quendor.errors import UnableToSupportGlulxProgramError
    from quendor.program import Program

    with pytest.raises(UnableToSupportGlulxProgramError) as exc_info:
        Program(glulx_program)

    error_text = "Quendor cannot interpret Glulx files:"

    expect(str(exc_info.value)).to(contain(error_text))


def test_unable_to_read_non_ifrs_resource(aif_program) -> None:
    """Raises an exception if an IFF form resource is not an IFRS type."""

    from quendor.errors import UnableToSupportNonIfrsResource
    from quendor.program import Program

    with pytest.raises(UnableToSupportNonIfrsResource) as exc_info:
        Program(aif_program)

    error_text = "Quendor did not find an IFRS format type"

    expect(str(exc_info.value)).to(contain(error_text))


def test_unable_to_determine_format(invalid_program) -> None:
    """Raises an exception if a program format is not zcode or blorb."""

    from quendor.errors import UnableToDetermineProgramFormatError
    from quendor.program import Program

    with pytest.raises(UnableToDetermineProgramFormatError) as exc_info:
        Program(invalid_program)

    error_text = "Quendor cannot determine the file format"

    expect(str(exc_info.value)).to(contain(error_text))
