import os
import logging
from enum import Enum
from pathlib import Path

from quendor.errors import (
    UnableToAccessProgramError,
    UnableToDetermineProgramFormatError,
    UnableToLocateProgramError,
    UnableToSupportGlulxProgramError,
    UnableToSupportNonIfrsResource,
)


FORMAT = Enum("Format", "UNKNOWN BLORB ZCODE")


class Program:
    def __init__(self, program: str) -> None:
        self._program: str = program
        self._file: Path
        self._data: bytes = b""
        self._format: FORMAT = FORMAT.UNKNOWN

        self._locate()
        self._read_data()
        self._read_format()

    def details(self) -> None:
        logging.info(f"{self._file.stem} ({self._file.suffix.lstrip('.')})")
        logging.info(f"Program location: {self._file.parent}")
        logging.info(f"Program format: {self._format.name}")

    def _read_format(self) -> None:
        # Reading the first four bytes is enough to get the format
        # for any valid program file.

        format_id = self._data[0:4]

        self._check_for_glulx(format_id)
        self._check_for_blorb(format_id)
        self._check_for_zcode(format_id)

        if self._format.name == "UNKNOWN":
            raise UnableToDetermineProgramFormatError(
                f"\nQuendor cannot determine the file format of {self._file.name}"
            )

    def _read_data(self) -> None:
        try:
            self._data = self._file.read_bytes()
        except OSError:
            raise UnableToAccessProgramError(
                f"\nUnable to access the program: {self._file.name}"
                f"\nFile location: {self._file.parent}"
            )

    def _check_for_zcode(self, format_id: bytes) -> None:
        # If the program is an unblorbed zcode program then the first
        # byte will indicate a Z-Machine version. Thus if the format ID
        # is a version number, it can be assumed the program file is a
        # zcode program.

        if format_id[0] >= 1 and format_id[0] <= 8:
            self._format = FORMAT.ZCODE

    def _check_for_blorb(self, format_id: bytes) -> None:
        # If the file is a blorb file then the first four bytes will
        # indicate a group ID. In that case it's necessary to determine
        # if the file is an IFF file and, if so, see if the file has an
        # interactive fiction type.

        if self._decode_bytes(format_id) == "FORM":
            ifrs_id = self._data[8:12]

            if self._decode_bytes(ifrs_id) != "IFRS":
                raise UnableToSupportNonIfrsResource(
                    f"\nQuendor did not find an IFRS format type in {self._file.name!r}"
                    f"\nFormat found was: {ifrs_id!r}"
                )

            self._format = FORMAT.BLORB

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
