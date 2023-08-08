from expects import expect, equal


def test_package_version() -> None:
    """Current version is exposed on the package."""

    from quendor import __version__

    expect(__version__).to(equal("0.1.0"))
