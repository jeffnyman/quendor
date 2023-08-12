from expects import equal, expect, contain

import pytest


def test_locate_resource_index_chunk(zork1_blorb_bytes) -> None:
    """Locates the resource index chunk in a blorb."""

    from quendor.blorb import Blorb

    blorb = Blorb(zork1_blorb_bytes)

    position = blorb._locate_chunk(b"RIdx")

    expect(position).to(equal(12))


def test_invalid_blorb_missing_resource_index_chunk(invalid_zblorb_bytes) -> None:
    """Tests the absence of the resource index chunk in a blorb with IFRS."""

    from quendor.blorb import Blorb
    from quendor.errors import UnableToLocateRIdxChunkError

    with pytest.raises(UnableToLocateRIdxChunkError) as exc_info:
        Blorb(invalid_zblorb_bytes)

    error_text = "Quendor did not find an RIdx chunk in the blorb."

    expect(str(exc_info.value)).to(contain(error_text))
