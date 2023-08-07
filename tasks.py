from invoke import task


@task
def formatting(c):
    print("\n*** Formatting (with black) ***")
    c.run("poetry run black src")


@task
def linting(c):
    print("\n*** Linting (with flake8) ***")
    c.run("poetry run flake8 --count src")


@task
def typing(c):
    print("\n*** Typing (with mypy) ***")
    c.run("poetry run mypy src")


@task(formatting, linting, typing)
def check(_):
    print("\n CODE QUALITY CHECKS COMPLETED\n")
