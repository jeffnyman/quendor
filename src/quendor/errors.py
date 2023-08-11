class UnableToAccessProgramError(Exception):
    """Raise for a zcode program file that cannot be opened or read from."""


class UnableToLocateProgramError(Exception):
    """Raise for a zcode program file that cannot be located."""


class UnableToSupportGlulxProgramError(Exception):
    """Raise when a program file is determined to be Glulx."""
