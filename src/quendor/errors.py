class UnableToAccessProgramError(Exception):
    """Raise for a zcode program file that cannot be opened or read from."""


class UnableToDetermineProgramFormatError(Exception):
    """Raise when a program is not zcode or blorb."""


class UnableToLocateProgramError(Exception):
    """Raise for a zcode program file that cannot be located."""


class UnableToLocateResourceError(Exception):
    """Raise for a resource file that cannot be located."""


class UnableToLocateExecChunkError(Exception):
    """Raise when a blorb does not contain an Exec resource."""


class UnableToLocateRIdxChunkError(Exception):
    """Raise when a blorb does not contain a RIdx resource."""


class UnableToMatchIFhdError(Exception):
    """Raise for an IFhd mismatch between zcode and blorb resource."""


class UnableToSupportGlulxProgramError(Exception):
    """Raise when a program file is determined to be Glulx."""


class UnableToSupportNonIfrsResource(Exception):
    """Raise when an IFF file is not an IFRS type."""


class UnsupportedBlorbFormatError(Exception):
    """Raise for a blorb format that cannot be interpreted."""
