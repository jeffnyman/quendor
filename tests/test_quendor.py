from expects import expect, equal, contain

import pytest


def test_package_version() -> None:
    """Current version is exposed on the package."""

    from quendor import __version__

    expect(__version__).to(equal("0.1.0"))


def test_startup_banner(capsys) -> None:
    """Provides a minimal banner on startup."""

    from quendor import __version__
    from quendor.__main__ import main

    main()

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
