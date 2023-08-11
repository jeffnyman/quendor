class UnableToAccessProgramError(Exception):
    """Raise for a zcode program file that cannot be opened or read from."""


class UnableToDetermineProgramFormatError(Exception):
    """Raise when a program is not zcode or blorb."""


class UnableToLocateProgramError(Exception):
    """Raise for a zcode program file that cannot be located."""


class UnableToSupportGlulxProgramError(Exception):
    """Raise when a program file is determined to be Glulx."""


class UnableToSupportNonIfrsResource(Exception):
    """Raise when an IFF file is not an IFRS type."""
