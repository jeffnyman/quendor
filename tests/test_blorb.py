from expects import equal, expect, contain

import pytest


def test_locate_resource_index_chunk(zork1_blorb_bytes) -> None:
    """Locates the resource index chunk in a blorb."""

    from quendor.blorb import Blorb

    blorb = Blorb(zork1_blorb_bytes)

    position = blorb._locate_chunk(b"RIdx")

    expect(position).to(equal(12))


def test_invalid_blorb_missing_resource_index_chunk(invalid_zblorb_bytes) -> None:
    """Raises an exception when a resource index chunk is not found in a blorb."""

    from quendor.blorb import Blorb
    from quendor.errors import UnableToLocateRIdxChunkError

    with pytest.raises(UnableToLocateRIdxChunkError) as exc_info:
        Blorb(invalid_zblorb_bytes)

    error_text = "Quendor did not find an RIdx chunk in the blorb."

    expect(str(exc_info.value)).to(contain(error_text))


def test_blorb_chunk_not_found(zork1_blorb_bytes) -> None:
    """Indicates a zero index for a chunk that is not found."""

    from quendor.blorb import Blorb

    blorb = Blorb(zork1_blorb_bytes)

    position = blorb._locate_chunk(b"RInvalid")

    expect(position).to(equal(0))


def test_get_blorb_resource_count(zork1_blorb_bytes) -> None:
    """Reads the resource count from a blorb."""

    from quendor.blorb import Blorb

    blorb = Blorb(zork1_blorb_bytes)
    position = blorb._locate_chunk(b"RIdx")

    resource_count = blorb._get_resource_count(position + 8)

    expect(resource_count).to(equal(2))


def test_get_blorb_resource_usage(zork1_blorb_bytes) -> None:
    """Reads the resource usage from a blorb."""

    from quendor.blorb import Blorb

    blorb = Blorb(zork1_blorb_bytes)
    position = blorb._locate_chunk(b"RIdx")

    resource_count = blorb._get_resource_count(position + 8)

    resources = []

    for resource in range(resource_count):
        usage = blorb._get_usage(position + 12, resource)
        resources.append(usage)

    expect(resources[0]).to(equal(b"Exec"))
    expect(resources[1]).to(equal(b"Pict"))


def test_get_blorb_resource_number(zork1_blorb_bytes) -> None:
    """Reads the resource number from a blorb."""

    from quendor.blorb import Blorb

    blorb = Blorb(zork1_blorb_bytes)
    position = blorb._locate_chunk(b"RIdx")

    resource_count = blorb._get_resource_count(position + 8)

    resources = []

    for resource in range(resource_count):
        number = blorb._get_number(position + 12, resource)
        resources.append(number)

    expect(resources[0]).to(equal(0))
    expect(resources[1]).to(equal(1))
