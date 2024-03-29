import logging
import os
from pathlib import Path
from typing import Dict

from quendor.errors import (
    UnableToLocateResourceError,
    UnableToLocateRIdxChunkError,
    UnableToLocateExecChunkError,
    UnableToMatchIFhdError,
    UnsupportedBlorbFormatError,
)


class Blorb:
    def __init__(self, data: bytes, zcode_data: bytes = b"") -> None:
        self._data: bytes = data
        self._zcode_data: bytes = zcode_data
        self._resource_index: Dict[bytes, dict] = {}
        self._release: int = 0

        self._read_data()

        if zcode_data:
            self._verify_zcode_data()

        self._read_release_number()

    @staticmethod
    def locate(resource: str) -> Path:
        paths = [
            Path.cwd(),
            Path.cwd() / "zcode",
            Path.home() / "zcode",
            Path(os.path.expandvars("$ZCODE_PATH")),
            Path(os.path.expandvars("$QUENDOR_PATH")),
        ]

        paths = [Path(path) for path in paths]

        for path in paths:
            logging.info(f"Checking: {Path(path).joinpath(resource)}")

            file_path = path.joinpath(resource)

            if file_path.is_file():
                return file_path

        checked_paths = "\n\t".join([a.as_posix() for a in paths])

        raise UnableToLocateResourceError(
            f"\nUnable to locate the resource: {resource}"
            f"\n\nChecked in:\n\t{checked_paths}"
        )

    def read_exec_chunk(self, number: int = 0) -> bytes:
        # There should at most one chunk with usage 'Exec'. Its content is an
        # executable.

        try:
            exec_start = self._resource_index[b"Exec"][number]
        except KeyError:
            raise UnableToLocateExecChunkError(
                "\nThe blorb file does not contain an executable chunk of data."
            )

        # The chunk type describes its format. The format is taken from the
        # Babel format agreement. Since Quendor is only supporting zcode
        # programs, any other Babel format is invalid.

        chunk_type = self._data[int(exec_start, 16) : int(exec_start, 16) + 4]

        if chunk_type.decode("latin-1") != "ZCOD":
            raise UnsupportedBlorbFormatError(
                f"\nThe blorb file does not have a zcode executable."
                f"\nExecutable format found was: {chunk_type.decode('latin-1')}."
            )

        size = self._get_chunk_size(exec_start)

        # A resource file that provides an executable chunk contains all
        # that's needed to run the excutable. An interpreter can begin
        # interpreting when provided this kind of resource. Thus the data
        # returned will be exactly the zcode data that would have been
        # prseent in an unblorbed program.

        return self._data[int(exec_start, 16) + 8 : int(exec_start, 16) + 8 + size]

    def _verify_zcode_data(self) -> None:
        # The IFhd is a program identifier chunk which indicates which
        # zcode program the resources are associated with. The format for
        # the information chunk is:

        # 4 bytes		'IFhd'	chunk ID
        # 4 bytes		13		chunk length
        # 1 word		...		release number ($2 in header)
        # 6 bytes		...		serial number ($12 in header)
        # 1 word		...		checksum ($1C in header)
        # 3 bytes		...		PC

        offset = self._locate_chunk(b"IFhd")

        # Infocom games will likely have an offset whereas many, if not
        # most, Inform games will not. Since the chunk is optional, if
        # it doesn't exist, the data and resource will be assumed to be
        # valid.

        if offset == 0:
            return

        # STAGE 1: Get "game identifier" information from the resource.

        offset += 8

        resource_release = self._read_release(self._data, offset)

        offset += 2

        resource_serial = self._read_serial(self._data, offset)

        offset += 6

        resource_checksum = self._read_checksum(self._data, offset)

        # STAGE 2: Get "game identifier" information from the zcode
        # data in the resource.

        # The release number is 0x2 in the header.

        zcode_release = self._read_release(self._zcode_data, 2)

        # The serial number is 0x12 in the header.

        zcode_serial = self._read_serial(self._zcode_data, 0x12)

        # The checksum is 0x1C in the header.

        zcode_checksum = self._read_checksum(self._zcode_data, 0x1C)

        mismatch_details = []

        if resource_release != zcode_release:
            mismatch_details.append(
                "Release mismatch: "
                f"resource was {resource_release}, zcode was {zcode_release}"
            )
        if resource_serial != zcode_serial:
            mismatch_details.append(
                "Serial mismatch: "
                f"resource was {resource_serial!r}, zcode was {zcode_serial!r}"
            )
        if resource_checksum != zcode_checksum:
            mismatch_details.append(
                "Checksum mismatch: "
                f"resource was {resource_checksum}, zcode was {zcode_checksum}"
            )

        if mismatch_details:
            error_message = (
                "\nQuendor found mismatches between zcode and resource data:\n\n"
                + "\n".join(mismatch_details)
            )
            raise UnableToMatchIFhdError(error_message)

    @staticmethod
    def _read_release(data: bytes, offset: int) -> int:
        return int.from_bytes(data[offset : offset + 2], byteorder="big")

    @staticmethod
    def _read_serial(data: bytes, offset: int) -> bytes:
        return data[offset : offset + 6]

    @staticmethod
    def _read_checksum(data: bytes, offset: int) -> int:
        return int.from_bytes(data[offset : offset + 2], byteorder="big")

    def _read_release_number(self) -> None:
        # The RelN chunk is used to tell the interpreter the release
        # number of the resource file. This chunk is optional and if
        # it's not present, the interpreter should assume a release
        # number of 0. This is only meaningulf in zcode resource files.
        # The format for the release chunk is:

        # 4 bytes   'RelN'   chunk ID
        # 4 bytes   2        chunk length
        # 2 bytes   num      release number

        offset = self._locate_chunk(b"RelN")

        logging.debug(f"\tRelN Offset: {offset}")

        if offset:
            offset += 8

            self._release = int.from_bytes(
                self._data[offset : offset + 2], byteorder="big"
            )

    def _read_data(self) -> None:
        logging.debug("(Blorb Handling)")

        # The first chunk in the FORM must be a resource index (chunk type
        # 'RIdx'.) This lists all the resources stored in the IFRS FORM.

        offset = self._locate_chunk(b"RIdx")

        if offset == 0:
            raise UnableToLocateRIdxChunkError(
                "\nQuendor did not find an RIdx chunk in the blorb."
            )

        # Need to set the offset to the point where the number
        # of resources are stored.

        offset += 8

        resource_count = self._get_resource_count(offset)

        # Need to set the offset to the start of the resource
        # index entries.

        offset += 4

        self._get_resources(offset, resource_count)

    def _get_resources(self, offset: int, resource_count: int) -> None:
        # There is one index entry for each resource. Each index entry
        # is 12 bytes long.

        for resource in range(resource_count):
            logging.debug("\tResources:")

            # The usage field tells what kind of resource is being described.

            usage = self._get_usage(offset, resource)
            logging.debug(f"\t\tUsage: {usage!r}")

            # The number field tells which resource is being described. This
            # is from the context of the running program. For exmaple, if a
            # @draw_picture is called with an arwgument of 3, the interpreter
            # needs to find the index entry whose usage is 'Pict' and whose
            # number is 3. Any code chunks, which are usage 'Exec', should
            # havew 0 for the number.

            number = self._get_number(offset, resource)
            logging.debug(f"\t\tNumber: {number}")

            # The start field tells where the resource chunk begins.

            start = self._get_start(offset, resource)
            logging.debug(f"\t\tStart: {hex(start)}")

            # Ensure the 'usage' key exists in the resource index before
            # trying to store anything under that key.

            if usage not in self._resource_index:
                self._resource_index[usage] = {}

            self._resource_index[usage][number] = hex(start)

            logging.debug(f"\tResource Index: {self._resource_index}")

    def _get_resource_count(self, offset: int) -> int:
        count = int.from_bytes(
            self._data[offset : offset + 4],
            byteorder="big",
        )

        logging.debug(f"\tResource Count: {count}")

        return count

    def _get_usage(self, offset: int, resource: int) -> bytes:
        return self._data[offset + (resource * 12) : offset + (resource * 12) + 4]

    def _get_number(self, offset: int, resource: int) -> int:
        return int.from_bytes(
            self._data[offset + (resource * 12) + 4 : offset + (resource * 12) + 8],
            byteorder="big",
        )

    def _get_start(self, offset: int, resource: int) -> int:
        return int.from_bytes(
            self._data[offset + (resource * 12) + 8 : offset + (resource * 12) + 12],
            byteorder="big",
        )

    def _get_chunk_size(self, offset: str) -> int:
        return int.from_bytes(
            self._data[int(offset, 16) + 4 : int(offset, 16) + 8], byteorder="big"
        )

    def _locate_chunk(self, chunk_name: bytes) -> int:
        logging.debug(f"\tSearching for chunk name: {str(chunk_name)}")

        chunk_id: bytes = b""

        # Every IFF file has a 12 byte header. By this point, Quendor
        # already knows it has a FORM. This refers to the group ID and
        # is the first four bytes of the header. Quendor also knows that
        # it has an IFRS type. This refers to the type ID and is the last
        # four bytes of the header. The middle four bytes are the byte
        # count of the file itself and not needed. So the logic here
        # starts by moving past the header.

        position: int = 12

        while (chunk_id != chunk_name) and (position < len(self._data)):
            # After the header, all data is organized into chunks. A chunk
            # consists of an ID, a value indicating how many bytes are in the
            # chunk, and then all the actual data bytes. In the IFRS type, the
            # first chunk should always be a resource index chunk.
            chunk_id = self._data[position : position + 4]

            chunk_length = int.from_bytes(
                self._data[position + 4 : position + 8],
                byteorder="big",
            )

            # If a chunk has an odd length, it must be followed by a single
            # padding byte whose value is zero. This allows all chunks to be
            # aligned on even byte boundaries.

            if chunk_length % 2 == 1:
                chunk_length += 1

            logging.debug(f"\tChunk ID: {str(chunk_id)}")
            logging.debug(f"\tChunk length: {chunk_length}")

            if chunk_id == chunk_name:
                logging.debug(f"\tFound chunk ID: {str(chunk_id)}")
                break

            # If the chunk has not been found, the position has to be
            # incremented to the next chunk.

            position += chunk_length + 8

            logging.debug(f"\tUpdated chunk position: {position}")

        # If the chunk wasn't found, zero is returned. This is never a valid
        # offset for a chunk so can be used for error checking.
        if chunk_id != chunk_name:
            return 0

        logging.debug(f"\t{chunk_name!r} Offset: {position}")

        return position
