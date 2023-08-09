from expects import expect, equal, contain


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
