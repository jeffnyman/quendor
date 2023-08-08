from invoke import task


@task
def clean(c):
    print("\n *** Cleaning ***")

    c.run(
        "poetry run python -c \"import pathlib; [p.unlink() for p in pathlib.Path('.').rglob('*.py[co]') if not str(p).startswith('.venv')]\""
    )
    c.run(
        "poetry run python -c \"import pathlib; [p.rmdir() for p in pathlib.Path('.').rglob('__pycache__') if not str(p).startswith('.venv')]\""
    )
    c.run(
        "poetry run python -c \"import shutil; shutil.rmtree('./.pytest_cache', ignore_errors=True)\""
    )
    c.run(
        "poetry run python -c \"import shutil; shutil.rmtree('./.mypy_cache', ignore_errors=True)\""
    )


@task
def formatting(c):
    print("\n*** Formatting (with black) ***")
    c.run("poetry run black src tests")


@task
def linting(c):
    print("\n*** Linting (with flake8) ***")
    c.run("poetry run flake8 --count src tests")


@task
def typing(c):
    print("\n*** Typing (with mypy) ***")
    c.run("poetry run mypy src tests")


@task
def testing(c):
    print("\n*** Testing (with pytest) ***")
    c.run("poetry run pytest")


@task(formatting, linting, typing, testing)
def check(_):
    print("\n CODE QUALITY CHECKS COMPLETED\n")
