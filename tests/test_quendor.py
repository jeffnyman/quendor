def test_package_version() -> None:
    from quendor import __version__

    assert __version__ == "0.1.0"
