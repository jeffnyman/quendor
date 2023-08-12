import logging

from quendor.errors import UnableToLocateRIdxChunkError


class Blorb:
    def __init__(self, data: bytes) -> None:
        self._data: bytes = data

        self._read_data()

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

    def _get_resource_count(self, offset: int) -> int:
        count = int.from_bytes(
            self._data[offset : offset + 4],
            byteorder="big",
        )

        logging.debug(f"\tResource Count: {count}")

        return count

    def _get_usage(self, offset: int, resource: int) -> bytes:
        return self._data[offset + (resource * 12) : offset + (resource * 12) + 4]

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
