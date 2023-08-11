import os
import logging
from pathlib import Path

from quendor.errors import (
    UnableToAccessProgramError,
    UnableToLocateProgramError,
    UnableToSupportGlulxProgramError,
)


class Program:
    def __init__(self, program: str) -> None:
        self._program: str = program
        self._file: Path
        self._data: bytes = b""

        self._locate()
        self._read_data()
        self._read_format()

    def _read_format(self) -> None:
        # Reading the first four bytes is enough to get the format
        # for any valid program file.

        format_id = self._data[0:4]

        self._check_for_glulx(format_id)

    def _read_data(self) -> None:
        try:
            self._data = self._file.read_bytes()
        except OSError:
            raise UnableToAccessProgramError(
                f"\nUnable to access the program: {self._file.name}"
                f"\nFile location: {self._file.parent}"
            )

    def _check_for_glulx(self, format_id: bytes) -> None:
        if self._decode_bytes(format_id) == "GLUL":
            raise UnableToSupportGlulxProgramError(
                f"\nQuendor cannot interpret Glulx files: {self._file.name}"
                f"\nThe program has a format of 'GLUL'."
            )

    def _decode_bytes(self, id_value: bytes) -> str:
        return id_value.decode("latin-1").upper()

    def _locate(self) -> None:
        paths = [
            Path.cwd(),
            Path.cwd() / "zcode",
            Path.home() / "zcode",
            Path(os.path.expandvars("$ZCODE_PATH")),
            Path(os.path.expandvars("$QUENDOR_PATH")),
        ]

        paths = [Path(path) for path in paths]

        for path in paths:
            logging.debug(f"Checking: {Path(path).joinpath(self._program)}")

            file_path = path.joinpath(self._program)

            if file_path.is_file():
                self._file = file_path
                return

        checked_paths = "\n\t".join([a.as_posix() for a in paths])

        raise UnableToLocateProgramError(
            f"\nUnable to locate the program: {self._program}"
            f"\n\nChecked in:\n\t{checked_paths}"
        )
